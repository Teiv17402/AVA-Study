// /api/inactive-reminder.js — Cron daily 8PM VN time
// Find users inactive 3+ days → personalized email reminder
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";

async function sb(path, opts, key) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      'apikey': key, 'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
      ...(opts?.headers || {})
    }
  });
  const t = await r.text();
  let body = null;
  if (t) { try { body = JSON.parse(t); } catch (e) { body = t; } }
  return { status: r.status, body };
}

function fmtSubject(category) {
  return {
    'never_started': '👋 Sẵn sàng học chưa? Khóa đầu tiên đang đợi bạn',
    'no_completion': '📚 Chỉ còn vài phút nữa là xong bài đầu rồi',
    'stopped': '🎯 Đừng để chuỗi học bị gãy nhé!',
    'long_gone': '💔 Chúng tôi nhớ bạn — quay lại học tiếp nhé'
  }[category] || '📖 AVA Study — bài học đang đợi';
}

function tmpl(category, user, ctx) {
  const name = user.display_name || user.email.split('@')[0];
  const studyUrl = 'https://ava-study.vercel.app/home.html';

  const templates = {
    never_started: `
      <h2 style="color:#d4af6e">Xin chào ${name}!</h2>
      <p>Bạn đã đăng ký AVA Study được <strong>${ctx.daysAgo} ngày</strong> rồi nhưng chưa bắt đầu khóa nào.</p>
      <p>Bạn đầu tư thời gian để đăng ký — đừng để công sức đó lãng phí. Chỉ cần <strong>5 phút mỗi ngày</strong> là đã hình thành thói quen học rồi.</p>
      <p><strong>👉 Bài học đầu tiên đang đợi bạn:</strong></p>
    `,
    no_completion: `
      <h2 style="color:#d4af6e">Hi ${name}, bạn còn nhớ AVA chứ?</h2>
      <p>Bạn vừa bắt đầu khóa học cách đây <strong>${ctx.daysAgo} ngày</strong> mà chưa hoàn thành bài đầu tiên.</p>
      <p>Đa số học viên gặp khó khăn nhất ở 1-2 bài đầu. Nhưng nếu vượt qua được, các bài sau sẽ dễ dàng hơn rất nhiều.</p>
      <p><strong>👉 Quay lại học tiếp 5 phút nữa nào:</strong></p>
    `,
    stopped: `
      <h2 style="color:#d4af6e">${name} ơi, đừng dừng lại nhé!</h2>
      <p>Bạn đã hoàn thành <strong>${ctx.completed} bài</strong> rồi đó — không phải ai cũng làm được!</p>
      <p>Nhưng ${ctx.daysAgo} ngày qua bạn chưa quay lại. Học liên tục mỗi ngày 5-10 phút sẽ giúp bạn nhớ kiến thức tốt hơn nhiều.</p>
      <p><strong>👉 Bài tiếp theo đang đợi bạn:</strong></p>
    `,
    long_gone: `
      <h2 style="color:#d4af6e">${name}, chúng tôi nhớ bạn 💔</h2>
      <p>Đã <strong>${ctx.daysAgo} ngày</strong> bạn không quay lại AVA Study.</p>
      <p>Có vấn đề gì xảy ra không? Bài quá khó? Không đủ thời gian? Reply email này để chúng tôi giúp bạn nhé.</p>
      <p>Hoặc nếu sẵn sàng, quay lại học tiếp:</p>
    `
  };

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5">
<div style="background:#fff;padding:32px;border-radius:12px;border-top:4px solid #d4af6e">
${templates[category]}
<p style="text-align:center;margin:32px 0"><a href="${studyUrl}" style="background:#d4af6e;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">📖 Vào học ngay</a></p>
<p style="color:#999;font-size:12px;margin-top:24px">Nếu không muốn nhận email này, reply "STOP" để hủy.</p>
</div>
<p style="text-align:center;color:#999;font-size:11px;margin-top:12px">AVA Study — Học để xếp hạng</p>
</body></html>`;
}

export default async function handler(req) {
  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  const RESEND = process.env.RESEND_API_KEY;
  if (!SBKEY || !RESEND) {
    return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });
  }

  const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const NOW = new Date();

  // Fetch all users + their progress
  const res = await sb('user_progress?select=*&role=neq.admin', {}, SBKEY);
  if (res.status !== 200 || !Array.isArray(res.body)) {
    return new Response(JSON.stringify({ error: 'fetch failed', res }), { status: 500 });
  }
  const users = res.body;

  const sent = [];
  const skipped = [];
  
  for (const u of users) {
    // Skip if banned
    if ((u.banned_until || 0) > Date.now()) { skipped.push({ id: u.user_id, reason: 'banned' }); continue; }
    
    // Skip if reminder sent recently (within 5 days)
    if (u.last_reminder_at && new Date(u.last_reminder_at) > new Date(FIVE_DAYS_AGO)) {
      skipped.push({ id: u.user_id, reason: 'recent_reminder' }); continue;
    }

    const created = u.created_at ? new Date(u.created_at) : null;
    const lastLogin = u.last_login ? new Date(u.last_login) : created;
    if (!created) { skipped.push({ id: u.user_id, reason: 'no_created_at' }); continue; }

    const daysSinceCreated = Math.floor((NOW - created) / (24 * 60 * 60 * 1000));
    const daysSinceLogin = lastLogin ? Math.floor((NOW - lastLogin) / (24 * 60 * 60 * 1000)) : daysSinceCreated;
    const completedCount = (u.completed || []).length;

    // Categorize
    let category = null;
    if (completedCount === 0 && daysSinceCreated >= 3 && daysSinceCreated < 7) {
      category = u.last_login ? 'no_completion' : 'never_started';
    } else if (completedCount > 0 && daysSinceLogin >= 3 && daysSinceLogin < 14) {
      category = 'stopped';
    } else if (daysSinceLogin >= 14) {
      category = 'long_gone';
    }

    if (!category) { skipped.push({ id: u.user_id, reason: 'not_inactive' }); continue; }

    const ctx = { daysAgo: Math.max(daysSinceCreated, daysSinceLogin), completed: completedCount };
    const html = tmpl(category, u, ctx);
    const subject = fmtSubject(category);

    // Send email
    const er = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AVA Study <onboarding@resend.dev>',
        to: [u.email], subject, html
      })
    });
    const ed = await er.json();

    if (er.status === 200) {
      // Update last_reminder_at
      await sb(`user_progress?user_id=eq.${u.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_reminder_at: NOW.toISOString() })
      }, SBKEY);
      sent.push({ id: u.user_id, email: u.email, category, emailId: ed.id });
    } else {
      skipped.push({ id: u.user_id, reason: 'resend_failed', err: ed });
    }
  }

  return new Response(JSON.stringify({
    ok: true, totalUsers: users.length,
    sent: sent.length, skipped: skipped.length,
    sentDetails: sent, skippedDetails: skipped.slice(0, 10)
  }), { headers: { 'Content-Type': 'application/json' } });
}
