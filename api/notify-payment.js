// /api/notify-payment.js — Send approval email to user when admin approves payment
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";
const SUPABASE_PUBLISHABLE = "sb_publishable_7Gf6atJXyVV1cjriMoHBaQ_-nvZUbNP";

async function verifyAdmin(userToken) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { 'Authorization': 'Bearer ' + userToken, 'apikey': SUPABASE_PUBLISHABLE }
  });
  if (r.status !== 200) return null;
  const u = await r.json();
  if (u.email !== 'lehoangviet.17042002@gmail.com') return null;
  return u;
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

function fmtVnd(n) { return (n || 0).toLocaleString('vi-VN') + 'đ'; }

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, msg: 'notify-payment alive' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  const RESEND = process.env.RESEND_API_KEY;
  if (!SBKEY || !RESEND) return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });

  const authHeader = req.headers.get('authorization') || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '');
  const admin = await verifyAdmin(userToken);
  if (!admin) return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403 });

  let body;
  try { body = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const { paymentId } = body;
  if (!paymentId) return new Response(JSON.stringify({ error: 'Missing paymentId' }), { status: 400 });

  // Fetch payment
  const pRes = await sb(`payments?id=eq.${paymentId}`, {}, SBKEY);
  if (pRes.status !== 200 || !pRes.body || pRes.body.length === 0) {
    return new Response(JSON.stringify({ error: 'Payment not found' }), { status: 404 });
  }
  const payment = pRes.body[0];

  // Build email content
  const isCourse = payment.type === 'course';
  const targetTitle = isCourse ? payment.course_title : payment.lesson_title;
  const targetType = isCourse ? 'khóa học' : 'bài học';
  const studyUrl = isCourse
    ? `https://ava-study.vercel.app/course.html?id=${payment.course_id}`
    : `https://ava-study.vercel.app/course.html?id=${payment.course_id}#${payment.lesson_id}`;

  const name = (payment.user_email || '').split('@')[0];
  const subject = `🎉 Đã nhận thanh toán ${targetType} "${targetTitle}"`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5">
<div style="background:#fff;padding:32px;border-radius:12px;border-top:4px solid #d4af6e">
<div style="text-align:center;margin-bottom:20px"><div style="font-size:48px">🎉</div></div>
<h2 style="color:#d4af6e;text-align:center;margin:0 0 10px">Cảm ơn bạn đã thanh toán!</h2>
<p style="text-align:center;color:#666;margin:0 0 24px">Chào ${name}, payment của bạn đã được duyệt thành công.</p>

<div style="background:linear-gradient(135deg,rgba(212,175,110,0.08),rgba(212,175,110,0.02));border:1px solid rgba(212,175,110,0.3);border-radius:10px;padding:18px;margin:20px 0">
  <div style="color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">Bạn vừa mua</div>
  <div style="font-weight:700;font-size:18px;color:#d4af6e;margin:4px 0 12px">${isCourse ? '👑' : '📖'} ${targetTitle}</div>
  <div style="color:#666;font-size:13px">${isCourse ? 'Khóa học VIP' : 'Bài học VIP'} · <strong style="color:#333">${fmtVnd(payment.amount)}</strong></div>
  <div style="color:#666;font-size:12px;margin-top:8px">Nội dung CK: <code style="background:#f5f5f5;padding:2px 6px;border-radius:3px">${payment.transfer_content}</code></div>
</div>

${isCourse ? '<p style="color:#666">Bạn có quyền truy cập <strong>toàn bộ bài học</strong> trong khóa này. Học mọi lúc, không giới hạn.</p>' : '<p style="color:#666">Bạn có quyền truy cập bài học này từ giờ.</p>'}

<p style="text-align:center;margin:28px 0"><a href="${studyUrl}" style="background:#d4af6e;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">▶ Vào học ngay</a></p>

<div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;color:#999;font-size:12px">
<p style="margin:0 0 6px"><strong>Cần hỗ trợ?</strong> Reply email này hoặc liên hệ admin.</p>
<p style="margin:0">Bạn cũng có thể xem lịch sử mua hàng trong tab tài khoản.</p>
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
      to: [payment.user_email], subject, html
    })
  });
  const ed = await er.json();

  return new Response(JSON.stringify({
    ok: er.status === 200,
    emailStatus: er.status,
    emailId: ed.id,
    err: ed.message || null,
    sent_to: payment.user_email,
    payment_id: payment.id
  }), { status: er.status === 200 ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
}
