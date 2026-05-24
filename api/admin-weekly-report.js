// /api/admin-weekly-report.js — Tổng kết tuần qua Gemini + email cho admin
// Triggered by Vercel Cron mỗi sáng thứ 2
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";

async function sb(path, key) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }
  });
  return await r.json();
}

async function geminiSummarize(stats, geminiKey) {
  const prompt = `Bạn là trợ lý phân tích doanh nghiệp cho admin platform học online tên AVA Study.
Dưới đây là số liệu tuần qua (${stats.fromDate} đến ${stats.toDate}):

DOANH THU:
- Tổng tuần: ${stats.revenue.toLocaleString('vi-VN')}đ (tuần trước: ${stats.prevRevenue.toLocaleString('vi-VN')}đ)
- Đơn duyệt: ${stats.approvedCount}
- Đơn chờ duyệt: ${stats.pendingCount}
- Đơn từ chối: ${stats.rejectedCount}

USERS:
- Tổng user: ${stats.totalUsers}
- User mới tuần này: ${stats.newUsersThisWeek}
- User đăng nhập gần đây: ${stats.activeUsersThisWeek}
- User at-risk (3+ ngày không vào sau khi đăng ký): ${stats.atRiskCount}
- User bị ban hiện tại: ${stats.bannedCount}

KHÓA HỌC:
- Tổng khóa: ${stats.totalCourses}
- Top khóa mua nhiều: ${stats.topCourses.map(c => `${c.title} (${c.count} đơn)`).join(', ') || 'không có'}
- Vi phạm timer tuần này: ${stats.violationsThisWeek}

Viết báo cáo bằng tiếng Việt, NGẮN GỌN (3-4 đoạn), tone chuyên nghiệp nhưng thân thiện. Cấu trúc:
1. Đoạn 1: Tổng quan doanh thu + so sánh tuần trước (% tăng/giảm)
2. Đoạn 2: Insights về user (mới, active, at-risk)
3. Đoạn 3: Suggest action items cụ thể (VD: "Nên gửi coupon cho 5 user pending", "Khóa X đang hot, marketing thêm")

KHÔNG dùng markdown, KHÔNG list, viết prose tự nhiên. Plain text. Dưới 200 từ.`;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
    })
  });
  const data = await r.json();
  if (!data.candidates || !data.candidates[0]) {
    return 'AI tóm tắt không khả dụng. Số liệu thô bên dưới.';
  }
  return data.candidates[0].content.parts[0].text;
}

function fmtVnd(n) { return (n || 0).toLocaleString('vi-VN') + 'đ'; }

export default async function handler(req) {
  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  const GEMINI = process.env.GEMINI_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lehoangviet.17042002@gmail.com';
  const RESEND = process.env.RESEND_API_KEY;

  if (!SBKEY || !GEMINI || !RESEND) {
    return new Response(JSON.stringify({ error: 'Missing env', hasSB: !!SBKEY, hasGemini: !!GEMINI, hasResend: !!RESEND }), { status: 500 });
  }

  // Compute date ranges
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Fetch data
  const [payments, users, courses, attempts] = await Promise.all([
    sb('payments?select=*', SBKEY),
    sb('user_progress?select=*', SBKEY),
    sb('courses?select=id,title,lessons', SBKEY),
    sb(`quiz_attempts_log?created_at=gte.${weekAgo.toISOString()}&select=*`, SBKEY)
  ]);

  const wkPayments = payments.filter(p => new Date(p.created_at) >= weekAgo);
  const prevWkPayments = payments.filter(p => {
    const d = new Date(p.created_at);
    return d >= twoWeeksAgo && d < weekAgo;
  });

  const revenue = wkPayments.filter(p => p.status === 'approved').reduce((s, p) => s + (p.amount || 0), 0);
  const prevRevenue = prevWkPayments.filter(p => p.status === 'approved').reduce((s, p) => s + (p.amount || 0), 0);

  // Top courses by purchase count
  const courseCount = {};
  wkPayments.filter(p => p.status === 'approved' && p.type === 'course').forEach(p => {
    courseCount[p.course_id] = (courseCount[p.course_id] || 0) + 1;
  });
  const topCourses = Object.entries(courseCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([cid, cnt]) => ({ title: courses.find(c => c.id === cid)?.title || cid, count: cnt }));

  const newUsersThisWeek = users.filter(u => u.created_at && new Date(u.created_at) >= weekAgo).length;
  const activeUsersThisWeek = users.filter(u => u.last_login && new Date(u.last_login) >= weekAgo).length;
  const bannedCount = users.filter(u => (u.banned_until || 0) > Date.now()).length;
  // At-risk: created >3 days ago but completed=0
  const atRiskCount = users.filter(u => {
    if (!u.created_at) return false;
    const ageDays = (Date.now() - new Date(u.created_at).getTime()) / (24 * 60 * 60 * 1000);
    const completed = (u.completed || []).length;
    return ageDays >= 3 && completed === 0 && u.role !== 'admin';
  }).length;

  const violationsThisWeek = users.reduce((s, u) => {
    const wkViols = (u.violations || []).filter(v => v.at >= weekAgo.getTime()).length;
    return s + wkViols;
  }, 0);

  // ===== CHEAT DETECTION =====
  const suspiciousAttempts = (attempts || []).filter(a => {
    // Score 100% in <5 seconds = suspicious
    if (a.score === 100 && (a.duration_ms || 0) < 5000) return true;
    // Score 100% in <15s with >5 questions answered
    if (a.score === 100 && (a.duration_ms || 0) < 15000 && (a.answers?.length || 0) > 5) return true;
    return false;
  });
  const suspiciousByUser = {};
  suspiciousAttempts.forEach(a => {
    if (!suspiciousByUser[a.user_id]) suspiciousByUser[a.user_id] = [];
    suspiciousByUser[a.user_id].push(a);
  });
  const cheatSuspects = Object.entries(suspiciousByUser).map(([uid, items]) => {
    const u = users.find(x => x.user_id === uid);
    return {
      email: u?.email || uid,
      name: u?.display_name || '',
      count: items.length,
      examples: items.slice(0, 3).map(a => `Quiz ${a.lesson_id}: ${a.score}% trong ${a.duration_ms}ms`)
    };
  }).sort((a, b) => b.count - a.count);

  const stats = {
    fromDate: weekAgo.toLocaleDateString('vi-VN'),
    toDate: now.toLocaleDateString('vi-VN'),
    revenue, prevRevenue,
    approvedCount: wkPayments.filter(p => p.status === 'approved').length,
    pendingCount: payments.filter(p => p.status === 'pending').length,
    rejectedCount: wkPayments.filter(p => p.status === 'rejected').length,
    totalUsers: users.filter(u => u.role !== 'admin').length,
    newUsersThisWeek, activeUsersThisWeek, atRiskCount, bannedCount,
    totalCourses: courses.length, topCourses,
    violationsThisWeek,
    cheatSuspectsCount: cheatSuspects.length,
    cheatSuspects: cheatSuspects.slice(0, 5)
  };

  // AI summary
  let aiSummary;
  try {
    aiSummary = await geminiSummarize(stats, GEMINI);
  } catch (e) {
    aiSummary = 'AI tóm tắt lỗi: ' + e.message;
  }

  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f7f7f7">
<div style="background:#1a1a1a;color:#fff;padding:24px;border-radius:12px 12px 0 0">
<h1 style="margin:0;color:#d4af6e">📊 Báo cáo tuần — AVA Study</h1>
<p style="margin:6px 0 0;color:#bbb">${stats.fromDate} → ${stats.toDate}</p>
</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px">
<h2 style="color:#d4af6e;margin-top:0">💼 Tóm tắt AI</h2>
<div style="line-height:1.7;color:#333;white-space:pre-wrap">${aiSummary.replace(/</g, '&lt;')}</div>
<hr style="margin:24px 0;border:none;border-top:1px solid #ddd"/>
<h2 style="color:#d4af6e">📈 Số liệu chi tiết</h2>
<table style="width:100%;border-collapse:collapse">
<tr><td style="padding:8px 0;color:#666">Doanh thu tuần</td><td style="text-align:right;font-weight:700;color:#d4af6e">${fmtVnd(revenue)}</td></tr>
<tr><td style="padding:8px 0;color:#666">Tuần trước</td><td style="text-align:right">${fmtVnd(prevRevenue)}</td></tr>
<tr><td style="padding:8px 0;color:#666">Đơn duyệt</td><td style="text-align:right">${stats.approvedCount}</td></tr>
<tr><td style="padding:8px 0;color:#666">Đơn chờ duyệt</td><td style="text-align:right;color:#f59e0b">${stats.pendingCount}</td></tr>
<tr><td style="padding:8px 0;color:#666">User mới</td><td style="text-align:right;color:#4ade80">${newUsersThisWeek}</td></tr>
<tr><td style="padding:8px 0;color:#666">User active</td><td style="text-align:right">${activeUsersThisWeek}/${stats.totalUsers}</td></tr>
<tr><td style="padding:8px 0;color:#666">At-risk users</td><td style="text-align:right;color:#ef4444">${atRiskCount}</td></tr>
<tr><td style="padding:8px 0;color:#666">Vi phạm timer</td><td style="text-align:right">${violationsThisWeek}</td></tr>
</table>
${topCourses.length > 0 ? `<h3 style="color:#d4af6e">🏆 Top khóa</h3><ol>${topCourses.map(c => '<li>' + c.title + ' (' + c.count + ' đơn)</li>').join('')}</ol>` : ''}
${cheatSuspects.length > 0 ? `<h3 style="color:#ef4444;margin-top:24px">🚨 Nghi vấn gian lận (${cheatSuspects.length} user)</h3>
<div style="background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:14px">
${cheatSuspects.slice(0,5).map(c => '<div style="margin:6px 0"><strong style="color:#ef4444">' + (c.name || c.email) + '</strong> — ' + c.count + ' lần đáng ngờ<div style="font-size:12px;color:#666;margin-left:14px">' + c.examples.join('<br>') + '</div></div>').join('')}
<p style="margin-top:10px;font-size:12px;color:#999">Pattern: score 100% trong &lt;5 giây hoặc &lt;15s với &gt;5 câu. Có thể là cheat qua DevTools hoặc bot.</p>
</div>` : ''}
<p style="margin-top:24px;text-align:center"><a href="https://ava-study.vercel.app/admin.html" style="background:#d4af6e;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Vào Admin Panel</a></p>
</div>
<p style="text-align:center;color:#999;font-size:12px;margin-top:16px">AVA Study — báo cáo tự động mỗi sáng thứ 2</p>
</body></html>`;

  // Send email via Resend
  const er = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'AVA Study <onboarding@resend.dev>',
      to: [ADMIN_EMAIL],
      subject: `📊 Báo cáo tuần AVA Study (${stats.fromDate} - ${stats.toDate})`,
      html
    })
  });
  const ed = await er.json();

  return new Response(JSON.stringify({
    ok: true, stats, emailStatus: er.status, emailResp: ed
  }), { headers: { 'Content-Type': 'application/json' } });
}
