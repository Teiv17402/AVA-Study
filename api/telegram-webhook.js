// /api/telegram-webhook.js — Receive Telegram updates
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";

async function sb(path, opts, key) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      'apikey': key, 'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(opts?.headers || {})
    }
  });
  const t = await r.text();
  let body = null;
  if (t) { try { body = JSON.parse(t); } catch (e) { body = t; } }
  return { status: r.status, body };
}

async function tgSend(token, chatId, text, extra = {}) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra
    })
  });
}

function fmtVnd(n) { return (n || 0).toLocaleString('vi-VN') + 'đ'; }

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  if (!TOKEN || !SBKEY) return new Response('Missing env', { status: 500 });

  let update;
  try { update = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }

  const msg = update.message;
  if (!msg || !msg.text) return new Response('OK', { status: 200 });

  const chatId = msg.chat.id;
  const tgUsername = msg.from?.username || msg.from?.first_name || 'bạn';
  const text = msg.text.trim();

  // Handle commands
  if (text.startsWith('/start')) {
    const linkToken = text.replace(/^\/start\s*/, '').trim();
    if (!linkToken) {
      await tgSend(TOKEN, chatId,
        `👋 Xin chào ${tgUsername}!\n\n` +
        `Đây là <b>AVA Study Bot</b> — nhắc bạn học mỗi ngày 🎯\n\n` +
        `Để liên kết bot với tài khoản:\n` +
        `1. Vào <a href="https://ava-study.vercel.app/settings.html#notif">Cài đặt → Thông báo</a>\n` +
        `2. Bấm nút <b>"🔗 Liên kết Telegram"</b>\n` +
        `3. Mở Telegram lại — bot sẽ confirm ✓\n\n` +
        `Sau đó dùng /help để xem các lệnh.`
      );
      return new Response('OK');
    }

    // Lookup pending link
    const pending = await sb(
      `telegram_pending_links?token=eq.${encodeURIComponent(linkToken)}&select=*`, {}, SBKEY
    );
    if (pending.status !== 200 || !pending.body || pending.body.length === 0) {
      await tgSend(TOKEN, chatId,
        `❌ Mã liên kết không hợp lệ hoặc đã hết hạn (15 phút).\n\n` +
        `Vào lại <a href="https://ava-study.vercel.app/settings.html#notif">Cài đặt</a> → bấm "Liên kết Telegram" để tạo link mới.`
      );
      return new Response('OK');
    }

    const link = pending.body[0];
    if (new Date(link.expires_at) < new Date()) {
      await sb(`telegram_pending_links?token=eq.${encodeURIComponent(linkToken)}`, { method: 'DELETE' }, SBKEY);
      await tgSend(TOKEN, chatId,
        `⏰ Mã liên kết đã hết hạn. Vào Cài đặt → tạo link mới nhé.`
      );
      return new Response('OK');
    }

    // Save chat_id to user_progress
    const update = await sb(`user_progress?user_id=eq.${link.user_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        telegram_chat_id: chatId,
        telegram_username: tgUsername,
        telegram_linked_at: new Date().toISOString()
      })
    }, SBKEY);

    // Cleanup pending
    await sb(`telegram_pending_links?token=eq.${encodeURIComponent(linkToken)}`, { method: 'DELETE' }, SBKEY);

    // Fetch user info for confirmation
    const userRes = await sb(`user_progress?user_id=eq.${link.user_id}&select=email,display_name,streak_days,xp_total`, {}, SBKEY);
    const u = userRes.body?.[0];

    await tgSend(TOKEN, chatId,
      `✅ <b>Liên kết thành công!</b>\n\n` +
      `Tài khoản: ${u?.display_name || u?.email}\n` +
      `🔥 Streak: ${u?.streak_days || 0} ngày · ⭐ XP: ${u?.xp_total || 0}\n\n` +
      `Mỗi ngày 20:00 anh sẽ nhắc nếu bạn quên học. Bạn có thể dùng:\n` +
      `• /streak — xem chuỗi học hiện tại\n` +
      `• /next — gợi ý bài học tiếp theo\n` +
      `• /help — xem tất cả lệnh\n` +
      `• /stop — hủy liên kết`
    );
    return new Response('OK');
  }

  // Other commands require linked account
  const linkedRes = await sb(`user_progress?telegram_chat_id=eq.${chatId}&select=*`, {}, SBKEY);
  const linked = linkedRes.body?.[0];
  if (!linked) {
    await tgSend(TOKEN, chatId,
      `❌ Bạn chưa liên kết với tài khoản AVA Study.\n\n` +
      `Vào <a href="https://ava-study.vercel.app/settings.html#notif">Cài đặt → Thông báo</a> để liên kết.`
    );
    return new Response('OK');
  }

  if (text === '/streak' || text === '/streak@AVAxTSB_report_bot') {
    const days = linked.streak_days || 0;
    const freezes = linked.streak_freezes_available ?? 1;
    const longest = linked.streak_longest || 0;
    const xp = linked.xp_total || 0;
    const level = Math.floor(xp / 200) + 1;
    await tgSend(TOKEN, chatId,
      `📊 <b>Trạng thái học của ${linked.display_name || linked.email}</b>\n\n` +
      `🔥 Streak hiện tại: <b>${days} ngày</b>\n` +
      `🏆 Kỷ lục: ${longest} ngày\n` +
      `🧊 Freeze tuần này: ${freezes}\n` +
      `⭐ Level ${level} · ${xp} XP\n` +
      `📖 Bài hoàn thành: ${(linked.completed || []).length}\n\n` +
      `<a href="https://ava-study.vercel.app/dashboard.html">▶ Mở dashboard</a>`
    );
    return new Response('OK');
  }

  if (text === '/next' || text === '/next@AVAxTSB_report_bot') {
    const coursesRes = await sb(`courses?select=*&order=display_order.asc`, {}, SBKEY);
    const courses = coursesRes.body || [];
    const completed = linked.completed || [];
    let nextLesson = null;
    for (const c of courses) {
      const lessons = (c.lessons || []);
      for (const l of lessons) {
        if (!completed.includes(l.id)) {
          nextLesson = { course: c, lesson: l };
          break;
        }
      }
      if (nextLesson) break;
    }
    if (!nextLesson) {
      await tgSend(TOKEN, chatId, `🎉 Bạn đã hoàn thành tất cả khóa hiện có! Quá đỉnh.`);
      return new Response('OK');
    }
    const url = `https://ava-study.vercel.app/course.html?id=${nextLesson.course.id}#${nextLesson.lesson.id}`;
    await tgSend(TOKEN, chatId,
      `📖 <b>Bài tiếp theo của bạn:</b>\n\n` +
      `📚 Khóa: <b>${nextLesson.course.title}</b>\n` +
      `📝 Bài: <b>${nextLesson.lesson.title}</b>\n\n` +
      `<a href="${url}">▶ Vào học ngay</a>`
    );
    return new Response('OK');
  }

  if (text === '/stop' || text === '/stop@AVAxTSB_report_bot') {
    await sb(`user_progress?user_id=eq.${linked.user_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        telegram_chat_id: null,
        telegram_username: null,
        telegram_linked_at: null
      })
    }, SBKEY);
    await tgSend(TOKEN, chatId,
      `👋 Đã hủy liên kết. Bạn sẽ không nhận tin nhắn nhắc nữa.\n\n` +
      `Liên kết lại bất cứ lúc nào trong <a href="https://ava-study.vercel.app/settings.html#notif">Cài đặt</a>.`
    );
    return new Response('OK');
  }

  if (text === '/help' || text === '/help@AVAxTSB_report_bot' || text === '/start') {
    await tgSend(TOKEN, chatId,
      `<b>AVA Study Bot — Các lệnh:</b>\n\n` +
      `📊 /streak — Xem chuỗi học + level\n` +
      `📖 /next — Gợi ý bài tiếp theo\n` +
      `🛑 /stop — Hủy liên kết tài khoản\n` +
      `❓ /help — Xem lệnh\n\n` +
      `Tự động: mỗi ngày 20:00 anh sẽ nhắc nếu bạn quên học, nếu bài sắp hết hạn, hoặc có việc chưa xong.`
    );
    return new Response('OK');
  }

  // Unknown command
  await tgSend(TOKEN, chatId,
    `❓ Không hiểu lệnh "${text}". Gõ /help để xem các lệnh.`
  );
  return new Response('OK');
}
