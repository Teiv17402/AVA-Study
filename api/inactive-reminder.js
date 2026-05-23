// /api/inactive-reminder.js — v2: Personalized next lesson recommendation
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

/** Find next lesson user should learn — returns {course, lesson, progress} */
function findNextLesson(user, courses) {
  const completed = user.completed || [];
  const paidCourses = user.paid_courses || [];
  const paidLessons = user.paid_lessons || [];

  // Sort courses by order
  const sortedCourses = courses.slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

  for (const course of sortedCourses) {
    const lessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (lessons.length === 0) continue;

    // If course is VIP and user hasn't paid → suggest payment instead
    const courseLocked = course.is_vip && !paidCourses.includes(course.id);

    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i];
      if (completed.includes(lesson.id)) continue;  // skip done

      // If lesson is VIP and not paid → skip
      if (lesson.is_vip && !paidLessons.includes(lesson.id) && !paidCourses.includes(course.id)) continue;

      // If courseLocked and this lesson isn't already paid individually → suggest course purchase
      if (courseLocked) {
        return {
          course, lesson, lessonIdx: i, total: lessons.length,
          completedInCourse: lessons.filter(l => completed.includes(l.id)).length,
          isLocked: true, lockReason: 'course_vip'
        };
      }

      // If previous lesson not completed → still suggest this one (start point)
      return {
        course, lesson, lessonIdx: i, total: lessons.length,
        completedInCourse: lessons.filter(l => completed.includes(l.id)).length,
        isLocked: false
      };
    }
  }

  return null; // User completed everything
}

function fmtSubject(category, nextLesson) {
  const lessonName = nextLesson ? nextLesson.lesson.title : '';
  return {
    'never_started': nextLesson ? `👋 Bắt đầu khóa "${nextLesson.course.title}" — chỉ 5 phút thôi` : '👋 Sẵn sàng học chưa? Khóa đầu đang đợi bạn',
    'no_completion': nextLesson ? `📚 Quay lại học "${lessonName}" — gần xong rồi!` : '📚 Chỉ còn vài phút nữa là xong bài đầu',
    'stopped': nextLesson ? `🎯 Bài tiếp theo "${lessonName}" đang đợi bạn` : '🎯 Đừng để chuỗi học bị gãy nhé!',
    'long_gone': nextLesson ? `💔 Bạn còn nhớ "${nextLesson.course.title}" chứ?` : '💔 Chúng tôi nhớ bạn — quay lại học tiếp nhé'
  }[category] || '📖 AVA Study — bài học đang đợi';
}

function tmpl(category, user, ctx, nextLesson) {
  const name = user.display_name || user.email.split('@')[0];
  const studyUrl = 'https://ava-study.vercel.app/home.html';
  
  let nextLessonBlock = '';
  if (nextLesson) {
    const lessonUrl = `https://ava-study.vercel.app/course.html?id=${nextLesson.course.id}#${nextLesson.lesson.id}`;
    const progress = Math.round((nextLesson.completedInCourse / nextLesson.total) * 100);
    nextLessonBlock = `
<div style="background:linear-gradient(135deg,rgba(212,175,110,0.08),rgba(212,175,110,0.02));border:1px solid rgba(212,175,110,0.3);border-radius:10px;padding:18px;margin:20px 0">
  <div style="color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">Khóa học</div>
  <div style="font-weight:700;font-size:16px;color:#333;margin-top:4px">${nextLesson.course.title}</div>
  <div style="color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin-top:14px">Bài tiếp theo</div>
  <div style="font-weight:700;font-size:18px;color:#d4af6e;margin-top:4px">📖 ${nextLesson.lesson.title}</div>
  <div style="margin-top:10px;background:#eee;height:6px;border-radius:3px;overflow:hidden">
    <div style="background:#d4af6e;height:100%;width:${progress}%"></div>
  </div>
  <div style="color:#666;font-size:12px;margin-top:6px">Tiến độ khóa: ${nextLesson.completedInCourse}/${nextLesson.total} bài (${progress}%)</div>
  ${nextLesson.isLocked ? '<div style="margin-top:10px;color:#d4af6e;font-weight:700">👑 Khóa VIP — mở khóa ngay khi vào</div>' : ''}
  <p style="text-align:center;margin:18px 0 4px"><a href="${lessonUrl}" style="background:#d4af6e;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">▶ Học bài này ngay</a></p>
</div>`;
  }

  const templates = {
    never_started: `
      <h2 style="color:#d4af6e">Xin chào ${name}!</h2>
      <p>Bạn đã đăng ký AVA Study được <strong>${ctx.daysAgo} ngày</strong> rồi nhưng chưa bắt đầu bài nào.</p>
      <p>Chỉ cần <strong>5 phút mỗi ngày</strong> là đã hình thành thói quen học rồi. Bắt đầu từ bài đầu tiên nhé:</p>
      ${nextLessonBlock}
    `,
    no_completion: `
      <h2 style="color:#d4af6e">Hi ${name}, bạn còn nhớ AVA chứ?</h2>
      <p>Bạn bắt đầu khóa học <strong>${ctx.daysAgo} ngày</strong> trước nhưng chưa hoàn thành bài đầu tiên.</p>
      <p>Đa số học viên gặp khó nhất ở 1-2 bài đầu. Vượt qua được, các bài sau sẽ dễ dàng hơn nhiều.</p>
      ${nextLessonBlock}
    `,
    stopped: `
      <h2 style="color:#d4af6e">${name} ơi, đừng dừng lại nhé!</h2>
      <p>Bạn đã hoàn thành <strong>${ctx.completed} bài</strong> rồi — không phải ai cũng làm được!</p>
      <p>Nhưng ${ctx.daysAgo} ngày qua bạn chưa quay lại. Tiếp tục mỗi ngày 5-10 phút sẽ giúp bạn nhớ kiến thức tốt hơn:</p>
      ${nextLessonBlock}
    `,
    long_gone: `
      <h2 style="color:#d4af6e">${name}, chúng tôi nhớ bạn 💔</h2>
      <p>Đã <strong>${ctx.daysAgo} ngày</strong> bạn không quay lại AVA Study.</p>
      <p>Có vấn đề gì xảy ra không? Bài quá khó? Không đủ thời gian? Reply email này để chúng tôi giúp.</p>
      <p>Hoặc nếu sẵn sàng, quay lại học tiếp:</p>
      ${nextLessonBlock}
    `
  };

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5">
<div style="background:#fff;padding:32px;border-radius:12px;border-top:4px solid #d4af6e">
${templates[category]}
${nextLesson ? '' : `<p style="text-align:center;margin:24px 0"><a href="${studyUrl}" style="background:#d4af6e;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700">📖 Vào học ngay</a></p>`}
<p style="color:#999;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px">Nếu không muốn nhận email này, reply "STOP" để hủy.</p>
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

  // Fetch users + courses
  const [usersRes, coursesRes] = await Promise.all([
    sb('user_progress?select=*&role=neq.admin', {}, SBKEY),
    sb('courses?select=*', {}, SBKEY)
  ]);
  if (usersRes.status !== 200 || !Array.isArray(usersRes.body)) {
    return new Response(JSON.stringify({ error: 'fetch users failed' }), { status: 500 });
  }
  const users = usersRes.body;
  const courses = coursesRes.status === 200 && Array.isArray(coursesRes.body) ? coursesRes.body : [];

  const sent = [];
  const skipped = [];

  for (const u of users) {
    if ((u.banned_until || 0) > Date.now()) { skipped.push({ id: u.user_id, reason: 'banned' }); continue; }
    if (u.last_reminder_at && new Date(u.last_reminder_at) > new Date(FIVE_DAYS_AGO)) {
      skipped.push({ id: u.user_id, reason: 'recent_reminder' }); continue;
    }

    const created = u.created_at ? new Date(u.created_at) : null;
    const lastLogin = u.last_login ? new Date(u.last_login) : created;
    if (!created) { skipped.push({ id: u.user_id, reason: 'no_created_at' }); continue; }

    const daysSinceCreated = Math.floor((NOW - created) / (24 * 60 * 60 * 1000));
    const daysSinceLogin = lastLogin ? Math.floor((NOW - lastLogin) / (24 * 60 * 60 * 1000)) : daysSinceCreated;
    const completedCount = (u.completed || []).length;

    let category = null;
    if (completedCount === 0 && daysSinceCreated >= 3 && daysSinceCreated < 7) {
      category = u.last_login ? 'no_completion' : 'never_started';
    } else if (completedCount > 0 && daysSinceLogin >= 3 && daysSinceLogin < 14) {
      category = 'stopped';
    } else if (daysSinceLogin >= 14) {
      category = 'long_gone';
    }

    if (!category) {
      skipped.push({
        id: u.user_id, email: u.email, reason: 'not_inactive',
        daysSinceCreated, daysSinceLogin, completed: completedCount, hasLogin: !!u.last_login
      }); continue;
    }

    // Find personalized next lesson
    const nextLesson = findNextLesson(u, courses);

    const ctx = { daysAgo: Math.max(daysSinceCreated, daysSinceLogin), completed: completedCount };
    const html = tmpl(category, u, ctx, nextLesson);
    const subject = fmtSubject(category, nextLesson);

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
      await sb(`user_progress?user_id=eq.${u.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_reminder_at: NOW.toISOString() })
      }, SBKEY);
      sent.push({
        id: u.user_id, email: u.email, category, subject,
        nextLesson: nextLesson ? `${nextLesson.course.title} > ${nextLesson.lesson.title}` : 'none',
        emailId: ed.id
      });
    } else {
      skipped.push({ id: u.user_id, reason: 'resend_failed', err: ed });
    }
  }

  return new Response(JSON.stringify({
    ok: true, totalUsers: users.length,
    sent: sent.length, skipped: skipped.length,
    sentDetails: sent, skippedDetails: skipped
  }), { headers: { 'Content-Type': 'application/json' } });
}
