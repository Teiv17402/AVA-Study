// /api/welcome-email.js — Send welcome email to new user on first login
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";
const SUPABASE_PUBLISHABLE = "sb_publishable_7Gf6atJXyVV1cjriMoHBaQ_-nvZUbNP";

async function verifyUser(userToken) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { 'Authorization': 'Bearer ' + userToken, 'apikey': SUPABASE_PUBLISHABLE }
  });
  if (r.status !== 200) return null;
  return await r.json();
}

async function sb(path, opts, key) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', ...(opts?.headers || {}) }
  });
  const t = await r.text();
  let body = null;
  if (t) { try { body = JSON.parse(t); } catch (e) { body = t; } }
  return { status: r.status, body };
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, msg: 'welcome-email alive' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  const RESEND = process.env.RESEND_API_KEY;
  if (!SBKEY || !RESEND) return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });

  const authHeader = req.headers.get('authorization') || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '');
  const user = await verifyUser(userToken);
  if (!user || !user.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // Check if welcome already sent (column welcome_sent_at)
  const progRes = await sb(`user_progress?user_id=eq.${user.id}&select=welcome_sent_at,email,display_name`, {}, SBKEY);
  if (progRes.status !== 200 || !progRes.body || progRes.body.length === 0) {
    return new Response(JSON.stringify({ error: 'User progress not found' }), { status: 404 });
  }
  const prog = progRes.body[0];
  if (prog.welcome_sent_at) {
    return new Response(JSON.stringify({ ok: true, msg: 'Already sent before, skipped' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Fetch available courses (non-VIP or with VIP info)
  const coursesRes = await sb('courses?select=id,title,description,level,is_vip,price,lessons&order=display_order', {}, SBKEY);
  const courses = (coursesRes.status === 200 && Array.isArray(coursesRes.body)) ? coursesRes.body : [];

  const name = prog.display_name || (prog.email || '').split('@')[0];
  const subject = `🎉 Chào mừng ${name} đến với AVA Study!`;

  const coursesHtml = courses.length === 0 ? '<p style="color:#999;font-style:italic">Admin đang xây dựng khóa học, sớm thôi!</p>' :
    courses.slice(0, 5).map(c => {
      const lessonCount = (c.lessons || []).length;
      const vipBadge = c.is_vip
        ? `<span style="background:#d4af6e;color:#000;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-left:6px">👑 VIP ${(c.price || 0).toLocaleString('vi-VN')}đ</span>`
        : '';
      return `<div style="background:#fafafa;border-left:3px solid #d4af6e;padding:12px 14px;margin:8px 0;border-radius:4px">
        <a href="https://ava-study.vercel.app/course.html?id=${c.id}" style="color:#d4af6e;font-weight:700;text-decoration:none;font-size:15px">${c.title}${vipBadge}</a>
        <div style="color:#666;font-size:12px;margin-top:4px">${c.level || 'Cơ bản'} · ${lessonCount} bài</div>
        ${c.description ? `<div style="color:#999;font-size:12px;margin-top:6px">${c.description.substring(0, 100)}${c.description.length > 100 ? '...' : ''}</div>` : ''}
      </div>`;
    }).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5">
<div style="background:#fff;padding:32px;border-radius:12px;border-top:4px solid #d4af6e">
<div style="text-align:center;margin-bottom:20px">
<div style="font-size:56px">🎉</div>
<h2 style="color:#d4af6e;margin:8px 0">Xin chào ${name}!</h2>
<p style="color:#666;margin:0">Cảm ơn bạn đã tham gia AVA Study</p>
</div>

<p style="color:#333;line-height:1.7">Chúc mừng bạn đã đăng ký thành công. AVA Study là nơi bạn học những kỹ năng mới, lên xếp hạng và <strong>nhận quà mỗi tháng</strong> nếu là top học viên.</p>

<h3 style="color:#d4af6e;margin-top:28px">📚 Khóa học có sẵn:</h3>
${coursesHtml}

<h3 style="color:#d4af6e;margin-top:28px">🚀 3 bước để bắt đầu:</h3>
<ol style="color:#333;line-height:1.8">
<li><strong>Chọn khóa</strong> bạn muốn học từ danh sách trên</li>
<li><strong>Xem video</strong> + làm <strong>quiz ≥90%</strong> để hoàn thành mỗi bài</li>
<li>Nếu lười, hệ thống sẽ <strong>khóa bài sau 24h</strong> — nên học liên tục!</li>
</ol>

<div style="background:rgba(212,175,110,0.08);border:1px dashed rgba(212,175,110,0.4);border-radius:8px;padding:14px;margin:20px 0">
<strong style="color:#d4af6e">💡 Mẹo:</strong> Top 3 học viên mỗi tháng được tặng quà. Xem <a href="https://ava-study.vercel.app/leaderboard.html" style="color:#d4af6e">bảng xếp hạng</a> để biết ai đang dẫn đầu.
</div>

<p style="text-align:center;margin:28px 0"><a href="https://ava-study.vercel.app/home.html" style="background:#d4af6e;color:#000;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:16px">📖 Bắt đầu học ngay</a></p>

<div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;color:#999;font-size:12px;text-align:center">
<p>Cần hỗ trợ? Reply email này.</p>
</div>
</div>
<p style="text-align:center;color:#999;font-size:11px;margin-top:12px">AVA Study — Học để xếp hạng 🏆</p>
</body></html>`;

  // Send email
  const er = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'AVA Study <onboarding@resend.dev>',
      to: [prog.email], subject, html
    })
  });
  const ed = await er.json();

  // Mark as sent (only if successful)
  if (er.status === 200) {
    await sb(`user_progress?user_id=eq.${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ welcome_sent_at: new Date().toISOString() })
    }, SBKEY);
  }

  return new Response(JSON.stringify({
    ok: er.status === 200,
    emailStatus: er.status,
    emailId: ed.id,
    err: ed.message || null,
    sent_to: prog.email
  }), { status: er.status === 200 ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
}
