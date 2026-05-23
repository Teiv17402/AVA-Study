// /api/quiz-submit.js — Server-side quiz validation
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";
const SUPABASE_PUBLISHABLE = "sb_publishable_7Gf6atJXyVV1cjriMoHBaQ_-nvZUbNP";

async function sbFetch(path, opts = {}, key) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      'apikey': key, 'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
      ...(opts.headers || {})
    }
  });
  const t = await r.text();
  let body = null;
  if (t) { try { body = JSON.parse(t); } catch (e) { body = t; } }
  return { status: r.status, body };
}

async function verifyUser(userToken) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'Authorization': 'Bearer ' + userToken,
      'apikey': SUPABASE_PUBLISHABLE
    }
  });
  if (r.status !== 200) return null;
  return await r.json();
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, msg: 'quiz-submit alive' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  if (!SBKEY) return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });

  // Auth
  const authHeader = req.headers.get('authorization') || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!userToken) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const user = await verifyUser(userToken);
  if (!user || !user.id) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });

  // Body
  let body;
  try { body = await req.json(); } catch (e) { return new Response('Invalid JSON', { status: 400 }); }
  const { lesson_id, answers, duration_ms } = body || {};
  if (!lesson_id || !Array.isArray(answers)) return new Response('Bad request', { status: 400 });

  // Rate limit: max 10 attempts per lesson per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentRes = await sbFetch(
    `quiz_attempts_log?user_id=eq.${user.id}&lesson_id=eq.${encodeURIComponent(lesson_id)}&created_at=gte.${oneHourAgo}&select=id`,
    {}, SBKEY
  );
  if (Array.isArray(recentRes.body) && recentRes.body.length >= 10) {
    return new Response(JSON.stringify({
      error: 'Quá nhiều lần thử trong 1 giờ. Vui lòng thử lại sau.'
    }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  // Fetch solutions
  let solutions = [];
  const solRes = await sbFetch(`lesson_quiz_solutions?lesson_id=eq.${encodeURIComponent(lesson_id)}`, {}, SBKEY);
  if (solRes.status === 200 && Array.isArray(solRes.body) && solRes.body.length > 0) {
    solutions = solRes.body[0].solutions || [];
  }

  // Backward compat: if no row in solutions table, fetch inline correct from courses.lessons
  if (solutions.length === 0) {
    const courseRes = await sbFetch(`courses?lessons=cs.[{"id":"${lesson_id}"}]&select=lessons`, {}, SBKEY);
    if (courseRes.status === 200 && Array.isArray(courseRes.body)) {
      for (const c of courseRes.body) {
        const lesson = (c.lessons || []).find(l => l.id === lesson_id);
        if (lesson && Array.isArray(lesson.quiz) && lesson.quiz.length > 0) {
          solutions = lesson.quiz.map(q => q.correct || 0);
          break;
        }
      }
    }
  }

  if (solutions.length === 0) {
    return new Response(JSON.stringify({ error: 'No quiz for this lesson' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Calculate score
  let correctCount = 0;
  const total = solutions.length;
  const wrong = [];
  for (let i = 0; i < total; i++) {
    if (answers[i] === solutions[i]) correctCount++;
    else wrong.push(i);
  }
  const score = total > 0 ? Math.round(correctCount / total * 100) : 0;
  const passed = score >= 90;

  // Log attempt
  await sbFetch('quiz_attempts_log', {
    method: 'POST',
    body: JSON.stringify({
      user_id: user.id, lesson_id, score,
      answers, duration_ms: duration_ms || 0
    })
  }, SBKEY);

  // Update user_progress.quiz_scores
  const progRes = await sbFetch(`user_progress?user_id=eq.${user.id}&select=quiz_scores,quiz_attempts`, {}, SBKEY);
  const prog = (Array.isArray(progRes.body) && progRes.body[0]) || {};
  const quizScores = prog.quiz_scores || {};
  const quizAttempts = prog.quiz_attempts || {};
  if (!quizScores[lesson_id] || score > quizScores[lesson_id]) quizScores[lesson_id] = score;
  quizAttempts[lesson_id] = (quizAttempts[lesson_id] || 0) + 1;
  await sbFetch(`user_progress?user_id=eq.${user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      quiz_scores: quizScores,
      quiz_attempts: quizAttempts,
      last_update: new Date().toISOString()
    })
  }, SBKEY);

  return new Response(JSON.stringify({
    ok: true,
    correctCount, total, score, passed,
    wrongIndices: wrong,
    bestScore: quizScores[lesson_id],
    attempts: quizAttempts[lesson_id]
  }), { headers: { 'Content-Type': 'application/json' } });
}
