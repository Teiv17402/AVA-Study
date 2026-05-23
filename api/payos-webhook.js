// ============================================
// /api/payos-webhook.js — Vercel Edge Function
// Receives transaction notifications from Payos
// Auto-approves matching pending payments
// ============================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";

/**
 * Verify Payos webhook signature
 * Payos signs: sort data keys alphabetically → "k=v&k=v" → HMAC-SHA256 with checksum key
 */
async function verifyPayosSignature(data, signature, checksumKey) {
  const sortedKeys = Object.keys(data).sort();
  const dataString = sortedKeys.map(k => {
    let v = data[k];
    if (v === null || v === undefined) v = "";
    if (typeof v === 'object') v = JSON.stringify(v);
    return `${k}=${v}`;
  }).join('&');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(checksumKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataString));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === signature;
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, message: 'Payos webhook endpoint live' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
  const PAYOS_CHECKSUM = process.env.PAYOS_CHECKSUM_KEY;
  if (!SUPABASE_SECRET || !PAYOS_CHECKSUM) {
    return new Response(JSON.stringify({ error: 'Missing env vars' }), { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Payos webhook format: { code, desc, success, data: {...}, signature }
  const { data, signature } = body || {};
  if (!data) {
    return new Response(JSON.stringify({ ok: true, msg: 'no data, ignored' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Verify signature (optional — comment out for test mode)
  const verified = await verifyPayosSignature(data, signature || '', PAYOS_CHECKSUM);
  if (!verified) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
  }

  // Extract transferContent code: AVA{6}{5} or AVAK{6}{5}
  const desc = (data.description || data.content || '').toUpperCase();
  const amount = parseInt(data.amount || 0);
  const codeMatch = desc.match(/AVAK?[A-Z0-9]{11}/);
  if (!codeMatch) {
    return new Response(JSON.stringify({ ok: true, msg: 'no AVA code in desc', desc }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const transferContent = codeMatch[0];

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Find pending payment
  const { data: payments, error: e1 } = await supabase
    .from('payments').select('*')
    .eq('transfer_content', transferContent)
    .eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1);

  if (e1) return new Response(JSON.stringify({ error: e1.message }), { status: 500 });
  if (!payments || payments.length === 0) {
    return new Response(JSON.stringify({ ok: true, msg: 'no pending payment for ' + transferContent }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const payment = payments[0];

  // Verify amount: user must transfer at least 95% of expected (to allow rounding)
  if (amount < payment.amount * 0.95) {
    await supabase.from('payments').update({
      status: 'pending',
      // Add note
    }).eq('id', payment.id);
    return new Response(JSON.stringify({
      ok: true, msg: 'amount mismatch — kept pending for admin review',
      expected: payment.amount, received: amount
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Auto-approve
  await supabase.from('payments').update({
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: '__payos_auto__',
    amount: amount  // also update with actual amount received
  }).eq('id', payment.id);

  // Grant access
  const { data: prog } = await supabase
    .from('user_progress').select('paid_lessons, paid_courses')
    .eq('user_id', payment.user_id).single();

  if (payment.type === 'course') {
    const paidCourses = (prog?.paid_courses || []).slice();
    if (!paidCourses.includes(payment.course_id)) paidCourses.push(payment.course_id);
    await supabase.from('user_progress').update({
      paid_courses: paidCourses,
      last_update: new Date().toISOString()
    }).eq('user_id', payment.user_id);
  } else {
    const paidLessons = (prog?.paid_lessons || []).slice();
    if (!paidLessons.includes(payment.lesson_id)) paidLessons.push(payment.lesson_id);
    await supabase.from('user_progress').update({
      paid_lessons: paidLessons,
      last_update: new Date().toISOString()
    }).eq('user_id', payment.user_id);
  }

  return new Response(JSON.stringify({
    ok: true, approved: true,
    paymentId: payment.id, userId: payment.user_id,
    type: payment.type, amount
  }), { headers: { 'Content-Type': 'application/json' } });
}
