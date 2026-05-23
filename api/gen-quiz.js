// /api/gen-quiz.js v2 — simpler prompt + better debug
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

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, msg: 'gen-quiz alive' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const GEMINI = process.env.GEMINI_API_KEY;
  if (!GEMINI) return new Response(JSON.stringify({ error: 'Missing GEMINI_API_KEY' }), { status: 500 });

  const authHeader = req.headers.get('authorization') || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '');
  const admin = await verifyAdmin(userToken);
  if (!admin) return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403 });

  let body;
  try { body = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const { transcript, numQuestions, lessonTitle, lessonDescription } = body;
  if (!transcript || transcript.length < 50) {
    return new Response(JSON.stringify({ error: 'Transcript quá ngắn (cần ≥50 ký tự)' }), { status: 400 });
  }
  const n = Math.min(Math.max(parseInt(numQuestions) || 10, 3), 25);

  // Simpler prompt
  const prompt = "Tạo " + n + " câu hỏi trắc nghiệm tiếng Việt từ nội dung sau, đa dạng kiểu câu (định nghĩa, áp dụng, so sánh):\n\n" +
    (lessonTitle ? "Bài học: " + lessonTitle + "\n" : "") +
    (lessonDescription ? "Mô tả: " + lessonDescription + "\n" : "") +
    "\nNỘI DUNG:\n" + transcript + "\n\n" +
    "Trả về CHỈ JSON array, mỗi item: {\"q\": câu hỏi, \"opts\": [4 đáp án], \"correct\": index đúng 0-3}";

  let geminiResp, rawText;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 6000,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                q: { type: 'string' },
                opts: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
                correct: { type: 'integer', minimum: 0, maximum: 3 }
              },
              required: ['q', 'opts', 'correct']
            }
          }
        }
      })
    });
    geminiResp = await r.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Network err: ' + e.message }), { status: 500 });
  }

  // Debug: nếu không có candidates, return raw response để debug
  if (!geminiResp.candidates || !geminiResp.candidates[0]) {
    return new Response(JSON.stringify({
      error: 'Gemini không trả về candidates',
      debug: {
        promptFeedback: geminiResp.promptFeedback,
        error: geminiResp.error,
        usageMetadata: geminiResp.usageMetadata,
        modelVersion: geminiResp.modelVersion,
        keys: Object.keys(geminiResp)
      }
    }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }

  const candidate = geminiResp.candidates[0];
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    return new Response(JSON.stringify({
      error: 'Gemini finishReason: ' + candidate.finishReason,
      safetyRatings: candidate.safetyRatings
    }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }

  if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
    return new Response(JSON.stringify({
      error: 'Gemini empty content',
      candidate
    }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }

  rawText = candidate.content.parts[0].text || '';

  // Parse JSON
  let questions;
  try {
    questions = JSON.parse(rawText);
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Output không phải JSON valid',
      rawText: rawText.substring(0, 1500),
      parseError: e.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }

  if (!Array.isArray(questions)) {
    return new Response(JSON.stringify({
      error: 'Output không phải array',
      rawText: rawText.substring(0, 1500)
    }), { status: 500 });
  }

  const valid = questions.filter(q =>
    q && typeof q.q === 'string' && q.q.length > 0 &&
    Array.isArray(q.opts) && q.opts.length === 4 &&
    q.opts.every(o => typeof o === 'string' && o.length > 0) &&
    typeof q.correct === 'number' && q.correct >= 0 && q.correct < 4
  );

  return new Response(JSON.stringify({
    ok: true,
    total: valid.length,
    requested: n,
    questions: valid
  }), { headers: { 'Content-Type': 'application/json' } });
}
