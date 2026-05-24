// /api/abandoned-payment.js — Cron: tìm payment pending >24h chưa thanh toán → email nhắc + coupon
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";

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
  return 'COMEBACK' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function fmtVnd(n) { return (n || 0).toLocaleString('vi-VN') + 'đ'; }

export default async function handler(req) {
  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  const RESEND = process.env.RESEND_API_KEY;
  if (!SBKEY || !RESEND) return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });

  const NOW = Date.now();
  const TWENTY_FOUR_HRS = 24 * 60 * 60 * 1000;
  const FORTY_EIGHT_HRS = 48 * 60 * 60 * 1000;
  const cutoff24h = new Date(NOW - TWENTY_FOUR_HRS).toISOString();
  const cutoff48h = new Date(NOW - FORTY_EIGHT_HRS).toISOString();

  // Find pending payments tạo 24-48h trước (chưa email lần nào hoặc email cách đây >24h)
  const payRes = await sb(
    `payments?status=eq.pending&created_at=lte.${cutoff24h}&created_at=gte.${cutoff48h}`,
    {}, SBKEY
  );
  if (payRes.status !== 200 || !Array.isArray(payRes.body)) {
    return new Response(JSON.stringify({ error: 'fetch payments failed', payRes }), { status: 500 });
  }

  const sent = [];
  const skipped = [];

  for (const p of payRes.body) {
    // Skip if already reminded
    if (p.abandon_reminded_at && new Date(p.abandon_reminded_at).getTime() > NOW - TWENTY_FOUR_HRS) {
      skipped.push({ id: p.id, reason: 'recently_reminded' }); continue;
    }

    // Phase A: tôn trọng opt-out email_promotions (coupon = khuyến mãi)
    const userRes = await sb(`user_progress?user_id=eq.${p.user_id}&select=notification_prefs`, {}, SBKEY);
    const prefs = userRes.body?.[0]?.notification_prefs || {};
    if (prefs.email_promotions === false) {
      skipped.push({ id: p.id, email: p.user_email, reason: 'opted_out_promotions' }); continue;
    }

    // Generate 10% off coupon for this payment, valid 48h, max 1 use
    const couponCode = genCouponCode();
    const expiresAt = NOW + 48 * 60 * 60 * 1000;
    const couponData = {
      code: couponCode,
      discount_type: 'percent',
      discount_value: 10,
      applies_to: p.type === 'course' ? 'courses' : 'lessons',
      course_ids: p.type === 'course' ? [p.course_id] : [],
      lesson_ids: p.type === 'lesson' ? [p.lesson_id] : [],
      expires_at: expiresAt,
      max_uses: 1,
      used_count: 0,
      active: true
    };
    await sb('coupons', { method: 'POST', body: JSON.stringify(couponData) }, SBKEY);

    const target = p.type === 'course' ? p.course_title : p.lesson_title;
    const studyUrl = p.type === 'course'
      ? `https://ava-study.vercel.app/course.html?id=${p.course_id}`
      : `https://ava-study.vercel.app/course.html?id=${p.course_id}#${p.lesson_id}`;

    const subject = `⏰ Quên thanh toán "${target}"? Tặng bạn coupon -10%`;
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5">
<div style="background:#fff;padding:32px;border-radius:12px;border-top:4px solid #d4af6e">
<div style="text-align:center"><div style="font-size:56px">⏰</div>
<h2 style="color:#d4af6e;margin:8px 0">Bạn còn nhớ chứ?</h2>
<p style="color:#666;margin:0">Đơn hàng của bạn vẫn đang chờ thanh toán</p></div>

<div style="background:#fafafa;border-radius:8px;padding:16px;margin:20px 0">
<div style="color:#999;font-size:12px;text-transform:uppercase">Đơn hàng</div>
<div style="font-weight:700;font-size:16px;color:#333;margin:4px 0">${p.type === 'course' ? '👑 ' : '📖 '}${target}</div>
<div style="color:#666;font-size:13px">${fmtVnd(p.amount)} · Nội dung CK: <code>${p.transfer_content}</code></div>
</div>

<p style="color:#333;line-height:1.7">Đã 24h từ khi bạn tạo yêu cầu nhưng chưa thấy chuyển khoản. Có lẽ bạn đang phân vân? Tặng bạn coupon ưu đãi để quyết định dễ hơn:</p>

<div style="background:linear-gradient(135deg,rgba(212,175,110,0.15),rgba(212,175,110,0.05));border:2px dashed #d4af6e;border-radius:12px;padding:20px;margin:20px 0;text-align:center">
<div style="color:#666;font-size:13px">🎁 Coupon giảm <strong>10%</strong></div>
<div style="font-family:monospace;font-size:24px;font-weight:800;color:#d4af6e;margin:8px 0;letter-spacing:3px">${couponCode}</div>
<div style="color:#999;font-size:11px">Hết hạn sau 48h · Dùng 1 lần · Áp dụng cho đơn này</div>
</div>

<p style="text-align:center;margin:24px 0"><a href="${studyUrl}" style="background:#d4af6e;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">▶ Hoàn tất thanh toán</a></p>

<p style="color:#999;font-size:12px;text-align:center">Nếu bạn không muốn mua nữa, bỏ qua email này. Đơn pending sẽ tự hủy sau 7 ngày.</p>
</div>
<p style="text-align:center;color:#999;font-size:11px;margin-top:12px">AVA Study</p>
</body></html>`;

    const er = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AVA Study <onboarding@resend.dev>',
        to: [p.user_email], subject, html
      })
    });
    const ed = await er.json();

    if (er.status === 200) {
      await sb(`payments?id=eq.${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ abandon_reminded_at: new Date().toISOString() })
      }, SBKEY);
      sent.push({ id: p.id, email: p.user_email, target, coupon: couponCode, emailId: ed.id });
    } else {
      skipped.push({ id: p.id, reason: 'resend_failed', err: ed });
    }
  }

  return new Response(JSON.stringify({
    ok: true, total: payRes.body.length,
    sent: sent.length, skipped: skipped.length,
    sentDetails: sent, skippedDetails: skipped
  }), { headers: { 'Content-Type': 'application/json' } });
}
