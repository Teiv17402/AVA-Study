// /api/telegram-reminder.js — Cron 20:00 VN (13:00 UTC) daily
// Gửi tin nhắn nhắc nhở qua Telegram theo 5 case prioritized
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";
const SITE_URL = "https://ava-study.vercel.app";
const LESSON_EXPIRY_MS = 24 * 60 * 60 * 1000;

async function sb(path, opts, key) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      'apikey': key, 'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(opts?.headers || {})
    }
  });
  const t = await r.text();
  let body = null;
  if (t) { try { body = JSON.parse(t); } catch (e) { body = t; } }
  return { status: r.status, body };
}

async function tgSend(token, chatId, text) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
}

/** Determine reminder content for a user. Returns { priority, message } or null. */
function buildReminderForUser(u, courses, pendingPayments) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().slice(0,10);
  const completed = u.completed || [];
  const unlockedAt = u.unlocked_at || {};
  const lastUpdate = u.last_update ? new Date(u.last_update) : null;
  const learnedToday = lastUpdate && lastUpdate >= today;
  const name = (u.display_name || u.email).split(' ')[0];

  // ==== Find next lesson + lessons sắp expire ====
  const sortedCourses = (courses || []).slice().sort((a, b) =>
    (a.display_order || 0) - (b.display_order || 0)
  );
  let nextLesson = null, expiringLessons = [], inProgressNoQuiz = [];
  for (const c of sortedCourses) {
    const lessons = (c.lessons || []);
    for (const l of lessons) {
      if (completed.includes(l.id)) continue;
      const unlockTime = unlockedAt[l.id];
      if (unlockTime) {
        const remainingMs = LESSON_EXPIRY_MS - (Date.now() - unlockTime);
        if (remainingMs > 0 && remainingMs < 6 * 60 * 60 * 1000) {
          // Sắp hết hạn trong 6h
          expiringLessons.push({ course: c, lesson: l, remainingHours: Math.ceil(remainingMs / 3600000) });
        }
      }
      if (!nextLesson) nextLesson = { course: c, lesson: l };
    }
  }

  // ==== CASE 1: Bài sắp hết hạn (PRIORITY 1 — most urgent) ====
  if (expiringLessons.length > 0) {
    const ex = expiringLessons[0];
    const url = `${SITE_URL}/course.html?id=${ex.course.id}#${ex.lesson.id}`;
    return {
      priority: 1, category: 'expiring',
      message: `⏰ <b>${name} ơi, bài học sắp khoá!</b>\n\n` +
        `📝 <b>${ex.lesson.title}</b>\n` +
        `📚 ${ex.course.title}\n\n` +
        `Còn <b>${ex.remainingHours} tiếng nữa</b> bài sẽ tự khoá. Làm ngay nhé!\n\n` +
        `<a href="${url}">▶ Học bài này ngay</a>`
    };
  }

  // ==== CASE 2: Streak sắp gãy (PRIORITY 2) ====
  if ((u.streak_days || 0) > 0 && !learnedToday) {
    const freezes = u.streak_freezes_available ?? 1;
    const url = `${SITE_URL}/dashboard.html`;
    const nextUrl = nextLesson
      ? `${SITE_URL}/course.html?id=${nextLesson.course.id}#${nextLesson.lesson.id}`
      : url;
    return {
      priority: 2, category: 'streak_warning',
      message: `🔥 <b>${name}, chuỗi ${u.streak_days} ngày của bạn sắp gãy!</b>\n\n` +
        `Hôm nay bạn chưa học bài nào.\n` +
        (freezes > 0
          ? `🧊 Bạn còn ${freezes} freeze tuần này — nếu không học, freeze sẽ tự dùng để giữ chuỗi.\n\n`
          : `⚠️ Bạn KHÔNG còn freeze — nếu không học, chuỗi sẽ về 0!\n\n`) +
        (nextLesson ? `📖 Bài tiếp: <b>${nextLesson.lesson.title}</b>\n\n` : '') +
        `<a href="${nextUrl}">▶ Học 5 phút thôi</a>`
    };
  }

  // ==== CASE 3: Pending payment > 24h ====
  const userPendings = (pendingPayments || []).filter(p => p.user_id === u.user_id);
  if (userPendings.length > 0) {
    const p = userPendings[0];
    const target = p.type === 'course' ? `khóa <b>${p.course_title}</b>` : `bài <b>${p.lesson_title}</b>`;
    const url = p.type === 'course'
      ? `${SITE_URL}/course.html?id=${p.course_id}`
      : `${SITE_URL}/course.html?id=${p.course_id}#${p.lesson_id}`;
    return {
      priority: 3, category: 'pending_payment',
      message: `💳 <b>${name}, đơn thanh toán của bạn đang chờ</b>\n\n` +
        `Bạn đã yêu cầu thanh toán ${target}\n` +
        `Số tiền: ${(p.amount || 0).toLocaleString('vi-VN')}đ\n` +
        `Nội dung CK: <code>${p.transfer_content}</code>\n\n` +
        `Nếu đã chuyển khoản, admin sẽ duyệt trong 1-2h. Nếu chưa, hoàn tất thanh toán nhé:\n\n` +
        `<a href="${url}">▶ Xem chi tiết đơn</a>`
    };
  }

  // ==== CASE 4: Có bài chưa làm quiz (đang dở) ====
  // Skip cho v1, integration phức tạp. Để Phase 2 sau.

  // ==== CASE 5: Chưa học hôm nay (general) ====
  if (!learnedToday && nextLesson) {
    const url = `${SITE_URL}/course.html?id=${nextLesson.course.id}#${nextLesson.lesson.id}`;
    return {
      priority: 5, category: 'general',
      message: `📚 <b>${name}, học bài nhé!</b>\n\n` +
        `Hôm nay bạn chưa học bài nào.\n\n` +
        `📖 Bài tiếp theo: <b>${nextLesson.lesson.title}</b>\n` +
        `📚 Khóa: ${nextLesson.course.title}\n\n` +
        `<a href="${url}">▶ Vào học (5 phút)</a>`
    };
  }

  return null; // Không có gì để nhắc
}

export default async function handler(req) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  if (!TOKEN || !SBKEY) return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });

  // Fetch all linked users + their progress + courses + pending payments
  const [usersRes, coursesRes, pendingRes] = await Promise.all([
    sb('user_progress?telegram_chat_id=not.is.null&select=*&role=neq.admin', {}, SBKEY),
    sb('courses?select=id,title,display_order,lessons', {}, SBKEY),
    sb(`payments?status=eq.pending&created_at=lte.${new Date(Date.now() - 24*3600*1000).toISOString()}&select=*`, {}, SBKEY)
  ]);

  if (usersRes.status !== 200 || !Array.isArray(usersRes.body)) {
    return new Response(JSON.stringify({ error: 'fetch users failed', usersRes }), { status: 500 });
  }

  const users = usersRes.body;
  const courses = (coursesRes.status === 200 && Array.isArray(coursesRes.body)) ? coursesRes.body : [];
  const pendingPayments = (pendingRes.status === 200 && Array.isArray(pendingRes.body)) ? pendingRes.body : [];

  const sent = [], skipped = [];
  for (const u of users) {
    // Skip nếu banned
    if ((u.banned_until || 0) > Date.now()) { skipped.push({ id: u.user_id, reason: 'banned' }); continue; }

    const reminder = buildReminderForUser(u, courses, pendingPayments);
    if (!reminder) { skipped.push({ id: u.user_id, reason: 'nothing_to_remind' }); continue; }

    const r = await tgSend(TOKEN, u.telegram_chat_id, reminder.message);
    const ok = r.ok;
    if (ok) {
      await sb(`user_progress?user_id=eq.${u.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ telegram_last_reminder: new Date().toISOString() })
      }, SBKEY);
      sent.push({
        id: u.user_id, email: u.email,
        chatId: u.telegram_chat_id,
        category: reminder.category,
        priority: reminder.priority
      });
    } else {
      const err = await r.text();
      skipped.push({ id: u.user_id, reason: 'telegram_failed', err: err.slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    totalLinked: users.length,
    sent: sent.length,
    skipped: skipped.length,
    sentDetails: sent,
    skippedDetails: skipped
  }), { headers: { 'Content-Type': 'application/json' } });
}
