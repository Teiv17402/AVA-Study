// /api/send-email.js — Generic email sender via Resend
export const config = { runtime: 'edge' };

const FROM_EMAIL = "AVA Study <onboarding@resend.dev>"; // dùng default cho test, đổi sau khi verify domain

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, msg: 'send-email alive' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    return new Response(JSON.stringify({ error: 'Missing RESEND_API_KEY env' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Simple auth: header X-Internal-Key matches env (prevent random people spamming)
  const INTERNAL = process.env.INTERNAL_API_KEY;
  if (INTERNAL && req.headers.get('x-internal-key') !== INTERNAL) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const { to, subject, html, text, from } = body;
  if (!to || !subject || (!html && !text)) {
    return new Response(JSON.stringify({ error: 'Missing to/subject/html|text' }), { status: 400 });
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + RESEND_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: from || FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html || undefined,
      text: text || undefined
    })
  });
  const data = await r.json();
  return new Response(JSON.stringify({ status: r.status, data }), {
    status: r.status === 200 ? 200 : 500,
    headers: { 'Content-Type': 'application/json' }
  });
}
