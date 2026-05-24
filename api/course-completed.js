// /api/course-completed.js — Khi user hoàn thành 1 khóa: chúc mừng + upsell với coupon
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

function genCouponCode() {
  return 'BUF' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, msg: 'course-completed alive' }), {
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

  let body;
  try { body = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const { courseId } = body;
  if (!courseId) return new Response(JSON.stringify({ error: 'Missing courseId' }), { status: 400 });

  // Fetch user progress + the course user just completed + all courses
  const [progRes, coursesRes] = await Promise.all([
    sb(`user_progress?user_id=eq.${user.id}`, {}, SBKEY),
    sb('courses?select=*&order=display_order', {}, SBKEY)
  ]);
  if (progRes.status !== 200 || !progRes.body || progRes.body.length === 0) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  }
  const prog = progRes.body[0];
  const courses = (coursesRes.status === 200 && Array.isArray(coursesRes.body)) ? coursesRes.body : [];
  const currentCourse = courses.find(c => c.id === courseId);
  if (!currentCourse) return new Response(JSON.stringify({ error: 'Course not found' }), { status: 404 });

  // Verify user really completed all lessons in this course
  const completed = prog.completed || [];
  const lessonIds = (currentCourse.lessons || []).map(l => l.id);
  if (lessonIds.length === 0 || !lessonIds.every(id => completed.includes(id))) {
    return new Response(JSON.stringify({ ok: false, msg: 'Course not actually completed yet' }), { status: 200 });
  }

  // Check if milestone email already sent for this course (track in milestones_sent JSON)
  const milestonesSent = prog.milestones_sent || [];
  if (milestonesSent.includes(courseId)) {
    return new Response(JSON.stringify({ ok: true, msg: 'Milestone email already sent for this course' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Suggest next course: first one user hasn't started
  const courseProgress = c => {
    const ids = (c.lessons || []).map(l => l.id);
    if (ids.length === 0) return 0;
    return ids.filter(id => completed.includes(id)).length / ids.length;
  };
  const nextCourse = courses.find(c =>
    c.id !== courseId &&
    courseProgress(c) < 1 &&
    (c.lessons || []).length > 0
  );

  // Generate a personalized coupon for next course (if VIP)
  let couponCode = null;
  let couponDiscount = 20;
  if (nextCourse && nextCourse.is_vip) {
    couponCode = genCouponCode();
    // Create coupon: 20% off, applies to this specific course, expires in 7 days, max 1 use
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await sb('coupons', {
      method: 'POST',
      body: JSON.stringify({
        code: couponCode,
        discount_type: 'percent',
        discount_value: couponDiscount,
        applies_to: 'courses',
        course_ids: [nextCourse.id],
        lesson_ids: [],
        expires_at: expiresAt,
        max_uses: 1,
        used_count: 0,
        active: true
      })
    }, SBKEY);
  }

  const name = prog.display_name || (prog.email || '').split('@')[0];
  const subject = `🎉 Chúc mừng bạn hoàn thành "${currentCourse.title}"!`;

  const nextBlock = nextCourse ? `
<div style="background:linear-gradient(135deg,rgba(212,175,110,0.1),rgba(212,175,110,0.02));border:2px dashed rgba(212,175,110,0.4);border-radius:12px;padding:20px;margin:24px 0">
  <div style="color:#d4af6e;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px">🚀 Tiếp theo nên học</div>
  <h3 style="margin:8px 0;color:#333;font-size:18px">${nextCourse.title}</h3>
  <p style="color:#666;font-size:13px;margin:4px 0">${nextCourse.description || ''} · ${(nextCourse.lessons || []).length} bài</p>
  ${couponCode ? `
  <div style="background:#fff;border:1px solid #d4af6e;border-radius:8px;padding:14px;margin:14px 0;text-align:center">
    <div style="color:#666;font-size:12px">🎁 Ưu đãi dành riêng cho bạn — giảm ${couponDiscount}%</div>
    <div style="font-family:monospace;font-size:22px;font-weight:800;color:#d4af6e;margin:6px 0;letter-spacing:3px">${couponCode}</div>
    <div style="color:#999;font-size:11px">Áp dụng cho khóa "${nextCourse.title}" · Hết hạn sau 7 ngày · Dùng được 1 lần</div>
  </div>` : ''}
  <p style="text-align:center;margin:14px 0 0"><a href="https://ava-study.vercel.app/course.html?id=${nextCourse.id}" style="background:#d4af6e;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">→ Bắt đầu khóa tiếp</a></p>
</div>` : '<p style="color:#666;font-style:italic;text-align:center;margin:24px 0">Bạn đã hoàn thành tất cả khóa hiện có! Theo dõi để biết khóa mới ra mắt.</p>';

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5">
<div style="background:#fff;padding:32px;border-radius:12px;border-top:4px solid #d4af6e">
<div style="text-align:center;margin-bottom:24px">
<div style="font-size:64px">🎉</div>
<h2 style="color:#d4af6e;margin:8px 0;font-size:24px">Hoàn thành khóa!</h2>
<p style="color:#666;margin:4px 0">Chúc mừng ${name}, bạn vừa hoàn thành</p>
<div style="font-size:20px;font-weight:700;color:#333;margin:12px 0">📚 ${currentCourse.title}</div>
</div>

<p style="color:#333;line-height:1.7;text-align:center">Đây là một thành tựu rất đáng tự hào. Bạn đã xem hết <strong>${(currentCourse.lessons || []).length} bài</strong>, làm hết quiz và vượt qua điểm pass 90%. Không phải ai cũng làm được điều đó.</p>

<div style="background:#fafafa;border-radius:8px;padding:14px;margin:20px 0;text-align:center">
<div style="color:#666;font-size:12px">Điểm xếp hạng bạn vừa nhận</div>
<div style="font-size:24px;font-weight:800;color:#d4af6e;margin:4px 0">+100 điểm</div>
<div style="color:#999;font-size:11px">Cho việc hoàn thành khóa</div>
</div>

${nextBlock}

<p style="text-align:center;margin:24px 0"><a href="https://ava-study.vercel.app/leaderboard.html" style="color:#d4af6e;text-decoration:none;font-weight:600">🏆 Xem vị trí của bạn trên bảng xếp hạng</a></p>

<div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;color:#999;font-size:12px;text-align:center">
<p style="margin:0">Cảm ơn bạn đã học cùng AVA Study!</p>
</div>
</div>
<p style="text-align:center;color:#999;font-size:11px;margin-top:12px">AVA Study — Học để xếp hạng 🏆</p>
</body></html>`;

  const er = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'AVA Study <onboarding@resend.dev>',
      to: [prog.email], subject, html
    })
  });
  const ed = await er.json();

  // Mark milestone as sent
  if (er.status === 200) {
    const newMilestones = [...milestonesSent, courseId];
    await sb(`user_progress?user_id=eq.${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ milestones_sent: newMilestones })
    }, SBKEY);
  }

  return new Response(JSON.stringify({
    ok: er.status === 200,
    emailStatus: er.status,
    emailId: ed.id,
    err: ed.message || null,
    courseCompleted: currentCourse.title,
    nextSuggested: nextCourse?.title || null,
    coupon: couponCode
  }), { status: er.status === 200 ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
}
