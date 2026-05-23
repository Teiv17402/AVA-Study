// /api/gen-quiz.js — Generate quiz from transcript via Gemini
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

  // Admin only
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
  const n = Math.min(Math.max(parseInt(numQuestions) || 10, 5), 25);

  const prompt = `Bạn là chuyên gia giáo dục tạo quiz cho học viên Việt Nam.

Bài học: ${lessonTitle || 'không có tiêu đề'}
${lessonDescription ? 'Mô tả: ' + lessonDescription : ''}

NỘI DUNG BÀI HỌC (transcript hoặc tài liệu):
"""
${transcript}
"""

NHIỆM VỤ: Tạo CHÍNH XÁC ${n} câu hỏi trắc nghiệm tiếng Việt từ nội dung trên.

YÊU CẦU:
- Mỗi câu hỏi có ĐÚNG 4 đáp án A, B, C, D
- 1 đáp án ĐÚNG, 3 đáp án sai nhưng HỢP LÝ (không quá dễ đoán)
- Câu hỏi đa dạng: định nghĩa, áp dụng, so sánh, nguyên nhân-kết quả
- Không lặp lại câu hỏi
- Đáp án ngắn gọn (<15 từ)
- Câu hỏi rõ ràng, không mơ hồ

ĐỊNH DẠNG OUTPUT: JSON array đúng schema sau, KHÔNG markdown, KHÔNG text khác:
[
  {"q": "Câu hỏi 1?", "opts": ["A", "B", "C", "D"], "correct": 0},
  {"q": "Câu hỏi 2?", "opts": ["A", "B", "C", "D"], "correct": 2}
]

correct = index đáp án đúng (0=A, 1=B, 2=C, 3=D).

Bắt đầu output JSON ngay (không có \`\`\` block, không có \"json\" tag):`;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json'
      }
    })
  });

  const data = await r.json();
  if (!data.candidates || !data.candidates[0]) {
    return new Response(JSON.stringify({
      error: 'Gemini không trả về kết quả',
      details: data
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let text = data.candidates[0].content.parts[0].text;
  // Strip markdown code blocks if any
  text = text.replace(/^\`\`\`(json)?\s*/i, '').replace(/\`\`\`\s*$/, '').trim();

  let questions;
  try {
    questions = JSON.parse(text);
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Gemini trả về không phải JSON hợp lệ',
      rawText: text.substring(0, 1000)
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // Validate
  if (!Array.isArray(questions)) {
    return new Response(JSON.stringify({ error: 'Output không phải array', raw: text.substring(0, 500) }), { status: 500 });
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
