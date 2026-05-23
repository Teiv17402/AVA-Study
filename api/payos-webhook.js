// /api/payos-webhook.js — Vercel Edge Function (pure fetch, no SDK)
export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";

async function verifyPayosSignature(data, signature, checksumKey) {
  const sortedKeys = Object.keys(data).sort();
  const dataString = sortedKeys.map(k => {
    let v = data[k];
    if (v === null || v === undefined) v = "";
    if (typeof v === 'object') v = JSON.stringify(v);
    return `${k}=${v}`;
  }).join('&');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(checksumKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataString));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === signature;
}

async function sbFetch(path, opts = {}, key) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      'apikey': key, 'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
      ...(opts.headers || {})
    }
  });
  const body = await r.text();
  let json;
  try { json = JSON.parse(body); } catch (e) { json = body; }
  return { status: r.status, body: json };
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, message: 'Payos webhook live' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const SBKEY = process.env.SUPABASE_SECRET_KEY;
  const CKKEY = process.env.PAYOS_CHECKSUM_KEY;
  if (!SBKEY || !CKKEY) {
    return new Response(JSON.stringify({ error: 'Missing env vars', hasSB: !!SBKEY, hasCK: !!CKKEY }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await req.json(); } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { data, signature } = body || {};
  if (!data) {
    return new Response(JSON.stringify({ ok: true, msg: 'no data' }), { headers: { 'Content-Type': 'application/json' }});
  }

  const verified = await verifyPayosSignature(data, signature || '', CKKEY);
  if (!verified) {
    return new Response(JSON.stringify({ error: 'Invalid signature', received: signature }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  const desc = (data.description || data.content || '').toUpperCase();
  const amount = parseInt(data.amount || 0);
  const codeMatch = desc.match(/AVAK?[A-Z0-9]{11}/);
  if (!codeMatch) {
    return new Response(JSON.stringify({ ok: true, msg: 'no AVA code', desc }), { headers: { 'Content-Type': 'application/json' }});
  }
  const transferContent = codeMatch[0];

  // Find pending payment
  const findRes = await sbFetch(`payments?transfer_content=eq.${transferContent}&status=eq.pending&order=created_at.desc&limit=1`, {}, SBKEY);
  if (findRes.status !== 200) {
    return new Response(JSON.stringify({ error: 'sb find failed', findRes }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }
  const payments = findRes.body;
  if (!Array.isArray(payments) || payments.length === 0) {
    return new Response(JSON.stringify({ ok: true, msg: 'no pending payment for ' + transferContent }), { headers: { 'Content-Type': 'application/json' }});
  }
  const payment = payments[0];

  if (amount < payment.amount * 0.95) {
    return new Response(JSON.stringify({
      ok: true, msg: 'amount too low — kept pending', expected: payment.amount, received: amount
    }), { headers: { 'Content-Type': 'application/json' }});
  }

  // Approve payment
  await sbFetch(`payments?id=eq.${payment.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'approved',
      approved_at: new Date().toISOString(),
      amount: amount
    })
  }, SBKEY);

  // Get current progress
  const progRes = await sbFetch(`user_progress?user_id=eq.${payment.user_id}&select=paid_lessons,paid_courses`, {}, SBKEY);
  const prog = (progRes.body && progRes.body[0]) || {};

  let patch = { last_update: new Date().toISOString() };
  if (payment.type === 'course') {
    const list = (prog.paid_courses || []).slice();
    if (!list.includes(payment.course_id)) list.push(payment.course_id);
    patch.paid_courses = list;
  } else {
    const list = (prog.paid_lessons || []).slice();
    if (!list.includes(payment.lesson_id)) list.push(payment.lesson_id);
    patch.paid_lessons = list;
  }
  await sbFetch(`user_progress?user_id=eq.${payment.user_id}`, {
    method: 'PATCH', body: JSON.stringify(patch)
  }, SBKEY);

  return new Response(JSON.stringify({
    ok: true, approved: true, paymentId: payment.id,
    userId: payment.user_id, type: payment.type, amount
  }), { headers: { 'Content-Type': 'application/json' }});
}
