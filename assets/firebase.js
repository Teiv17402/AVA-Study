// ============================================
// SUPABASE BACKEND — drop-in replacement for firebase.js
// Same export names so other files don't need import changes
// ============================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://tloemybryfsqimdgbwvs.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7Gf6atJXyVV1cjriMoHBaQ_-nvZUbNP";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// Aliases for backward compat
export const auth = supabase.auth;
export const db = supabase;
export const googleProvider = null;

export const ADMIN_EMAILS = ["lehoangviet.17042002@gmail.com"];

export const BANK_CONFIG = {
  bankCode: "MB",
  bankName: "MB Bank",
  accountNo: "2168888868",
  accountName: "LE HOANG VIET",
  defaultPrice: 99000
};

export const VIOLATION_BAN_DAYS = [7, 30];

export function buildVietQrUrl(amount, content) {
  const params = new URLSearchParams({ amount, addInfo: content, accountName: BANK_CONFIG.accountName });
  return `https://img.vietqr.io/image/${BANK_CONFIG.bankCode}-${BANK_CONFIG.accountNo}-compact2.png?${params}`;
}

export function buildTransferContent(userId, lessonId) {
  return `AVA${userId.slice(0,6).toUpperCase()}${lessonId.slice(-5).toUpperCase()}`;
}

export function buildCourseTransferContent(userId, courseId) {
  return `AVAK${userId.slice(0,6).toUpperCase()}${courseId.slice(-5).toUpperCase()}`;
}

export function isAdmin(user) {
  if (!user) return false;
  const email = user.email || (user.user && user.user.email);
  return ADMIN_EMAILS.includes(email);
}

// ============================================
// AUTH (replaces Firebase Auth functions)
// ============================================
function normalizeUser(supabaseUser) {
  if (!supabaseUser) return null;
  return {
    uid: supabaseUser.id,
    id: supabaseUser.id,
    email: supabaseUser.email,
    displayName: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || supabaseUser.email,
    photoURL: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture || ''
  };
}

export async function signInWithGoogle() {
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
  const redirectTo = base + 'home.html';
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
  if (error) throw error;
  return data;
}

// Compatibility shim for signInWithPopup(auth, googleProvider) → redirect flow
export function signInWithPopup() { return signInWithGoogle(); }
export function signOut() { return supabase.auth.signOut(); }

export function onAuthStateChanged(_authParam, callback) {
  supabase.auth.getSession().then(({ data: { session } }) => {
    callback(session ? normalizeUser(session.user) : null);
  });
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session ? normalizeUser(session.user) : null);
  });
  return () => subscription.unsubscribe();
}

export async function ensureUserDoc(user) {
  if (!user) return;
  const role = isAdmin(user) ? 'admin' : 'user';
  
  // Check if first time (no existing row)
  const { data: existing } = await supabase
    .from('user_progress').select('user_id').eq('user_id', user.uid).maybeSingle();
  const isFirstTime = !existing;
  
  const { error } = await supabase
    .from('user_progress')
    .upsert({
      user_id: user.uid,
      email: user.email,
      display_name: user.displayName || user.email,
      photo_url: user.photoURL || '',
      role,
      last_login: new Date().toISOString()
    }, { onConflict: 'user_id' });
  if (error) console.warn('ensureUserDoc:', error);
  
  // Fire welcome email if first time (non-admin)
  if (isFirstTime && !isAdmin(user)) {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (session) {
        // Fire and forget — don't await
        fetch('/api/welcome-email', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + session.access_token,
            'Content-Type': 'application/json'
          },
          body: '{}'
        }).then(r => r.json()).then(d => console.log('Welcome email:', d)).catch(e => console.warn('Welcome err:', e));
      }
    } catch (e) { console.warn('Welcome trigger error:', e); }
  }
}

export function waitForAuth() {
  return new Promise((resolve) => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      resolve(session ? normalizeUser(session.user) : null);
    });
  });
}

export async function requireAuth() {
  const user = await waitForAuth();
  if (!user) { location.href = "index.html"; return null; }
  await ensureUserDoc(user);
  return user;
}

export async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;
  if (!isAdmin(user)) {
    alert("Bạn không có quyền truy cập trang này.");
    location.href = "home.html";
    return null;
  }
  return user;
}

export async function logout() {
  await supabase.auth.signOut();
  location.href = "index.html";
}

// ============================================
// COURSES
// ============================================
function dbToFrontCourse(row) {
  if (!row) return null;
  return {
    id: row.id, title: row.title, description: row.description,
    level: row.level, thumbnail: row.thumbnail,
    lessons: row.lessons || [], order: row.display_order,
    isVip: row.is_vip, price: row.price,
    createdAt: row.created_at
  };
}

export async function fetchCourses() {
  const { data, error } = await supabase
    .from('courses').select('*').order('display_order', { ascending: true });
  if (error) throw error;
  return (data || []).map(dbToFrontCourse);
}

export async function fetchCourse(courseId) {
  const { data, error } = await supabase
    .from('courses').select('*').eq('id', courseId).maybeSingle();
  if (error) throw error;
  return dbToFrontCourse(data);
}

export async function createCourse(data) {
  const all = await fetchCourses();
  const maxOrder = all.reduce((m, c) => Math.max(m, c.order || 0), 0);
  const { data: inserted, error } = await supabase
    .from('courses')
    .insert([{
      title: data.title || 'Khóa học mới',
      description: data.description || '',
      level: data.level || 'Cơ bản',
      thumbnail: data.thumbnail || '',
      lessons: data.lessons || [],
      display_order: maxOrder + 1,
      is_vip: !!data.isVip,
      price: data.price || 0
    }])
    .select('id').single();
  if (error) throw error;
  return inserted.id;
}

export async function updateCourse(courseId, data) {
  const patch = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.level !== undefined) patch.level = data.level;
  if (data.thumbnail !== undefined) patch.thumbnail = data.thumbnail;
  if (data.lessons !== undefined) patch.lessons = data.lessons;
  if (data.order !== undefined) patch.display_order = data.order;
  if (data.isVip !== undefined) patch.is_vip = data.isVip;
  if (data.price !== undefined) patch.price = data.price;
  const { error } = await supabase.from('courses').update(patch).eq('id', courseId);
  if (error) throw error;
}

export async function deleteCourse(courseId) {
  const { error } = await supabase.from('courses').delete().eq('id', courseId);
  if (error) throw error;
}

// ============================================
// USER PROGRESS
// ============================================
function dbToFrontProgress(row) {
  if (!row) return {
    completed: [], unlockedAt: {}, paidLessons: [], paidCourses: [],
    quizScores: {}, quizAttempts: {}, violations: [], bannedUntil: 0
  };
  return {
    completed: row.completed || [],
    unlockedAt: row.unlocked_at || {},
    paidLessons: row.paid_lessons || [],
    paidCourses: row.paid_courses || [],
    quizScores: row.quiz_scores || {},
    quizAttempts: row.quiz_attempts || {},
    violations: row.violations || [],
    bannedUntil: row.banned_until || 0,
    lastUpdate: row.last_update
  };
}

export async function fetchUserProgress(userId) {
  const { data, error } = await supabase
    .from('user_progress').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return dbToFrontProgress(data);
}

export async function markLessonCompleted(userId, lessonId, nextLessonId) {
  const cur = await fetchUserProgress(userId);
  const completed = cur.completed.slice();
  const unlockedAt = { ...cur.unlockedAt };
  if (!completed.includes(lessonId)) completed.push(lessonId);
  if (nextLessonId && !unlockedAt[nextLessonId]) unlockedAt[nextLessonId] = Date.now();
  const { error } = await supabase.from('user_progress').update({
    completed, unlocked_at: unlockedAt,
    last_update: new Date().toISOString()
  }).eq('user_id', userId);
  if (error) throw error;
  return { completed, unlockedAt };
}

export async function ensureFirstUnlock(userId, firstLessonId) {
  if (!firstLessonId) return null;
  const cur = await fetchUserProgress(userId);
  if (cur.completed.includes(firstLessonId)) return null;
  if (cur.unlockedAt[firstLessonId]) return null;
  const unlockedAt = { ...cur.unlockedAt, [firstLessonId]: Date.now() };
  const { error } = await supabase.from('user_progress').update({
    unlocked_at: unlockedAt, last_update: new Date().toISOString()
  }).eq('user_id', userId);
  if (error) throw error;
  return { completed: cur.completed, unlockedAt };
}

export async function adminResetLessonTimer(userId, lessonId) {
  const cur = await fetchUserProgress(userId);
  const unlockedAt = { ...cur.unlockedAt, [lessonId]: Date.now() };
  const { error } = await supabase.from('user_progress').update({
    unlocked_at: unlockedAt, last_update: new Date().toISOString()
  }).eq('user_id', userId);
  if (error) throw error;
  return unlockedAt;
}

export async function resetUserProgress(userId) {
  const { error } = await supabase.from('user_progress').update({
    completed: [], unlocked_at: {}, paid_lessons: [], paid_courses: [],
    last_update: new Date().toISOString()
  }).eq('user_id', userId);
  if (error) throw error;
}

export async function fetchAllUsers() {
  const { data, error } = await supabase
    .from('user_progress')
    .select('user_id, email, display_name, photo_url, role, last_login');
  if (error) throw error;
  return (data || []).map(u => ({
    id: u.user_id,
    email: u.email,
    displayName: u.display_name,
    photoURL: u.photo_url,
    role: u.role,
    lastLogin: u.last_login ? { seconds: Math.floor(new Date(u.last_login).getTime() / 1000) } : null
  }));
}

export async function fetchAllProgress() {
  const { data, error } = await supabase.from('user_progress').select('*');
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.user_id,
    completed: row.completed || [],
    unlockedAt: row.unlocked_at || {},
    paidLessons: row.paid_lessons || [],
    paidCourses: row.paid_courses || [],
    quizScores: row.quiz_scores || {},
    quizAttempts: row.quiz_attempts || {},
    violations: row.violations || [],
    bannedUntil: row.banned_until || 0
  }));
}

// ============================================
// PAYMENTS
// ============================================
function dbToFrontPayment(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, userEmail: row.user_email,
    type: row.type, lessonId: row.lesson_id, courseId: row.course_id,
    courseTitle: row.course_title, lessonTitle: row.lesson_title,
    amount: row.amount, transferContent: row.transfer_content,
    status: row.status,
    createdAt: row.created_at ? { seconds: Math.floor(new Date(row.created_at).getTime() / 1000) } : null,
    approvedAt: row.approved_at ? { seconds: Math.floor(new Date(row.approved_at).getTime() / 1000) } : null
  };
}

export async function createPayment(userId, userEmail, lessonId, courseId, courseTitle, lessonTitle, amount) {
  const transferContent = buildTransferContent(userId, lessonId);
  const { data: existing } = await supabase
    .from('payments').select('*')
    .eq('user_id', userId).eq('lesson_id', lessonId).eq('status', 'pending');
  if (existing && existing.length > 0) return dbToFrontPayment(existing[0]);
  const { data, error } = await supabase.from('payments').insert([{
    user_id: userId, user_email: userEmail || '',
    type: 'lesson', lesson_id: lessonId, course_id: courseId,
    course_title: courseTitle || '', lesson_title: lessonTitle || '',
    amount, transfer_content: transferContent, status: 'pending'
  }]).select('*').single();
  if (error) throw error;
  return dbToFrontPayment(data);
}

export async function fetchMyPaymentForLesson(userId, lessonId) {
  const { data } = await supabase.from('payments').select('*')
    .eq('user_id', userId).eq('lesson_id', lessonId)
    .order('created_at', { ascending: false }).limit(1);
  return data && data.length ? dbToFrontPayment(data[0]) : null;
}

export async function createCoursePayment(userId, userEmail, courseId, courseTitle, amount) {
  const transferContent = buildCourseTransferContent(userId, courseId);
  const { data: existing } = await supabase.from('payments').select('*')
    .eq('user_id', userId).eq('course_id', courseId).eq('type', 'course').eq('status', 'pending');
  if (existing && existing.length > 0) return dbToFrontPayment(existing[0]);
  const { data, error } = await supabase.from('payments').insert([{
    user_id: userId, user_email: userEmail || '',
    type: 'course', lesson_id: '', course_id: courseId,
    course_title: courseTitle || '', lesson_title: '',
    amount, transfer_content: transferContent, status: 'pending'
  }]).select('*').single();
  if (error) throw error;
  return dbToFrontPayment(data);
}

export async function fetchMyPaymentForCourse(userId, courseId) {
  const { data } = await supabase.from('payments').select('*')
    .eq('user_id', userId).eq('course_id', courseId).eq('type', 'course')
    .order('created_at', { ascending: false }).limit(1);
  return data && data.length ? dbToFrontPayment(data[0]) : null;
}

export async function fetchPendingPayments() {
  const { data, error } = await supabase.from('payments').select('*')
    .eq('status', 'pending').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(dbToFrontPayment);
}

export async function fetchAllPayments() {
  const { data, error } = await supabase.from('payments').select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(dbToFrontPayment);
}

export async function approvePayment(paymentId, userId, lessonId, adminUid) {
  await supabase.from('payments').update({
    status: 'approved', approved_at: new Date().toISOString(), approved_by: adminUid
  }).eq('id', paymentId);
  const cur = await fetchUserProgress(userId);
  const paidLessons = cur.paidLessons.slice();
  if (!paidLessons.includes(lessonId)) paidLessons.push(lessonId);
  await supabase.from('user_progress').update({
    paid_lessons: paidLessons, last_update: new Date().toISOString()
  }).eq('user_id', userId);
}

export async function approveCoursePayment(paymentId, userId, courseId, adminUid) {
  await supabase.from('payments').update({
    status: 'approved', approved_at: new Date().toISOString(), approved_by: adminUid
  }).eq('id', paymentId);
  const cur = await fetchUserProgress(userId);
  const paidCourses = cur.paidCourses.slice();
  if (!paidCourses.includes(courseId)) paidCourses.push(courseId);
  await supabase.from('user_progress').update({
    paid_courses: paidCourses, last_update: new Date().toISOString()
  }).eq('user_id', userId);
}

export async function rejectPayment(paymentId, adminUid) {
  await supabase.from('payments').update({
    status: 'rejected', approved_at: new Date().toISOString(), approved_by: adminUid
  }).eq('id', paymentId);
}

export async function selfApprovePayment() { throw new Error('Self-approve đã tắt — chờ admin duyệt'); }
export async function selfApproveCoursePayment() { throw new Error('Self-approve đã tắt — chờ admin duyệt'); }

export async function markPaymentAsFraud(paymentId, userId, lessonId, courseId, type, adminUid) {
  await supabase.from('payments').update({
    status: 'fraud', fraud_at: new Date().toISOString(), fraud_by: adminUid
  }).eq('id', paymentId);
  const cur = await fetchUserProgress(userId);
  const patch = { last_update: new Date().toISOString() };
  if (type === 'course' && courseId) {
    patch.paid_courses = cur.paidCourses.filter(id => id !== courseId);
  } else if (lessonId) {
    patch.paid_lessons = cur.paidLessons.filter(id => id !== lessonId);
  }
  await supabase.from('user_progress').update(patch).eq('user_id', userId);
}

export async function verifyAutoApproved(paymentId, adminUid) {
  await supabase.from('payments').update({
    status: 'approved', approved_at: new Date().toISOString(), approved_by: adminUid
  }).eq('id', paymentId);
}

// ============================================
// VIOLATIONS + NOTIFICATIONS
// ============================================
export async function recordViolation(userId, userEmail, userName, courseId, courseTitle, lessonId, lessonTitle) {
  const cur = await fetchUserProgress(userId);
  const violations = cur.violations.slice();
  const alreadyRecorded = violations.some(v => v.lessonId === lessonId);
  if (alreadyRecorded) return { count: violations.length, banUntil: cur.bannedUntil, alreadyRecorded: true };

  violations.push({ at: Date.now(), courseId, courseTitle, lessonId, lessonTitle });
  const count = violations.length;
  let bannedUntil = cur.bannedUntil || 0;
  const now = Date.now();
  if (count === 1) bannedUntil = now + VIOLATION_BAN_DAYS[0] * 24 * 60 * 60 * 1000;
  else if (count === 2) bannedUntil = now + VIOLATION_BAN_DAYS[1] * 24 * 60 * 60 * 1000;

  await supabase.from('user_progress').update({
    violations, banned_until: bannedUntil, last_update: new Date().toISOString()
  }).eq('user_id', userId);

  if (count >= 3) {
    await supabase.from('admin_notifications').insert([{
      type: 'repeat_violator', severity: 'high',
      user_id: userId, user_email: userEmail, user_name: userName,
      course_id: courseId, course_title: courseTitle,
      lesson_id: lessonId, lesson_title: lessonTitle,
      violation_count: count,
      message: `User ${userName || userEmail} đã vi phạm ${count} lần. Cần nhắc trên cộng đồng.`,
      read: false
    }]);
  }
  return { count, bannedUntil, alreadyRecorded: false };
}

export function checkBanned(progress) {
  const bannedUntil = (progress && progress.bannedUntil) || 0;
  if (bannedUntil > Date.now()) {
    return {
      isBanned: true, until: bannedUntil,
      daysLeft: Math.ceil((bannedUntil - Date.now()) / (24*60*60*1000))
    };
  }
  return { isBanned: false };
}

export async function fetchBannedUsers() {
  const now = Date.now();
  const { data, error } = await supabase
    .from('user_progress').select('*').gt('banned_until', now);
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.user_id,
    completed: row.completed,
    paidLessons: row.paid_lessons,
    paidCourses: row.paid_courses,
    violations: row.violations || [],
    bannedUntil: row.banned_until
  }));
}

export async function fetchAdminNotifications() {
  const { data, error } = await supabase
    .from('admin_notifications').select('*').eq('read', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(n => ({
    id: n.id, type: n.type, severity: n.severity,
    userId: n.user_id, userEmail: n.user_email, userName: n.user_name,
    courseId: n.course_id, courseTitle: n.course_title,
    lessonId: n.lesson_id, lessonTitle: n.lesson_title,
    violationCount: n.violation_count, message: n.message, read: n.read,
    createdAt: n.created_at ? { seconds: Math.floor(new Date(n.created_at).getTime()/1000) } : null
  }));
}

export async function markNotificationRead(notifId) {
  await supabase.from('admin_notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', notifId);
}

export async function unbanUser(userId) {
  await supabase.from('user_progress')
    .update({ banned_until: 0, last_update: new Date().toISOString() })
    .eq('user_id', userId);
}

// ============================================
// QUIZ
// ============================================
export async function saveQuizScore(userId, lessonId, score) {
  const cur = await fetchUserProgress(userId);
  const quizScores = { ...cur.quizScores };
  const quizAttempts = { ...cur.quizAttempts };
  if (!quizScores[lessonId] || score > quizScores[lessonId]) quizScores[lessonId] = score;
  quizAttempts[lessonId] = (quizAttempts[lessonId] || 0) + 1;
  await supabase.from('user_progress').update({
    quiz_scores: quizScores, quiz_attempts: quizAttempts,
    last_update: new Date().toISOString()
  }).eq('user_id', userId);
  return { score, bestScore: quizScores[lessonId], attempts: quizAttempts[lessonId] };
}

// ============================================
// SCORE + LEADERBOARD
// ============================================
export function calculateScore(progress, courses) {
  if (!progress) return { total: 0, monthly: 0, breakdown: {} };
  const completed = progress.completed || [];
  const violations = progress.violations || [];
  const quizScores = progress.quizScores || {};
  let score = 0, monthlyScore = 0;
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  score += completed.length * 10;
  const courseDone = courses.filter(c => {
    const ids = (c.lessons || []).map(l => l.id);
    return ids.length > 0 && ids.every(id => completed.includes(id));
  });
  score += courseDone.length * 100;
  Object.values(quizScores).forEach(s => { if (s >= 95) score += 20; });
  score -= violations.length * 10;
  const monthCompletions = completed.filter(id => {
    const u = (progress.unlockedAt || {})[id];
    return u && u >= startMonth;
  });
  monthlyScore = monthCompletions.length * 10 - violations.filter(v => v.at >= startMonth).length * 10;
  return {
    total: Math.max(0, score),
    monthly: Math.max(0, monthlyScore),
    breakdown: {
      lessonsCompleted: completed.length,
      coursesCompleted: courseDone.length,
      quizBonuses: Object.values(quizScores).filter(s => s >= 95).length,
      violations: violations.length
    }
  };
}

export async function fetchLeaderboard(courses) {
  const { data, error } = await supabase.from('user_progress').select('*');
  if (error) throw error;
  return (data || [])
    .filter(p => p.role !== 'admin')
    .map(row => {
      const user = {
        id: row.user_id, email: row.email,
        displayName: row.display_name, photoURL: row.photo_url, role: row.role
      };
      const progress = dbToFrontProgress(row);
      const score = calculateScore(progress, courses);
      return { user, progress, score };
    })
    .sort((a, b) => b.score.total - a.score.total);
}

// ============================================
// COUPONS
// ============================================
function dbToFrontCoupon(row) {
  if (!row) return null;
  return {
    id: row.id, code: row.code,
    discountType: row.discount_type, discountValue: row.discount_value,
    appliesTo: row.applies_to,
    courseIds: row.course_ids || [], lessonIds: row.lesson_ids || [],
    expiresAt: row.expires_at || 0, maxUses: row.max_uses || 0,
    usedCount: row.used_count || 0, active: row.active,
    createdAt: row.created_at ? { seconds: Math.floor(new Date(row.created_at).getTime()/1000) } : null
  };
}

export async function createCoupon(data) {
  const code = (data.code || '').toUpperCase().trim();
  if (!code) throw new Error('Mã coupon không được trống');
  const { data: existing } = await supabase.from('coupons').select('id').eq('code', code).limit(1);
  if (existing && existing.length > 0) throw new Error('Mã coupon đã tồn tại: ' + code);
  const { data: inserted, error } = await supabase.from('coupons').insert([{
    code,
    discount_type: data.discountType || 'percent',
    discount_value: data.discountValue || 0,
    applies_to: data.appliesTo || 'all',
    course_ids: data.courseIds || [],
    lesson_ids: data.lessonIds || [],
    expires_at: data.expiresAt || 0,
    max_uses: data.maxUses || 0,
    used_count: 0, active: true
  }]).select('id').single();
  if (error) throw error;
  return inserted.id;
}

export async function fetchCoupons() {
  const { data, error } = await supabase.from('coupons').select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(dbToFrontCoupon);
}

export async function deleteCoupon(couponId) {
  const { error } = await supabase.from('coupons').delete().eq('id', couponId);
  if (error) throw error;
}

export async function toggleCoupon(couponId, active) {
  const { error } = await supabase.from('coupons').update({ active }).eq('id', couponId);
  if (error) throw error;
}

export async function updateCoupon(couponId, data) {
  const patch = {};
  if (data.discountType !== undefined) patch.discount_type = data.discountType;
  if (data.discountValue !== undefined) patch.discount_value = data.discountValue;
  if (data.appliesTo !== undefined) patch.applies_to = data.appliesTo;
  if (data.courseIds !== undefined) patch.course_ids = data.courseIds;
  if (data.lessonIds !== undefined) patch.lesson_ids = data.lessonIds;
  if (data.expiresAt !== undefined) patch.expires_at = data.expiresAt;
  if (data.maxUses !== undefined) patch.max_uses = data.maxUses;
  if (data.active !== undefined) patch.active = data.active;
  const { error } = await supabase.from('coupons').update(patch).eq('id', couponId);
  if (error) throw error;
}

export async function validateCoupon(code, type, targetId, originalPrice) {
  const normCode = (code || '').toUpperCase().trim();
  if (!normCode) return { valid: false, error: 'Vui lòng nhập mã coupon' };
  const { data } = await supabase.from('coupons').select('*').eq('code', normCode).limit(1);
  if (!data || data.length === 0) return { valid: false, error: 'Mã coupon không tồn tại' };
  const c = dbToFrontCoupon(data[0]);
  if (c.active === false) return { valid: false, error: 'Coupon đã bị tắt' };
  if (c.expiresAt && c.expiresAt > 0 && c.expiresAt < Date.now()) return { valid: false, error: 'Coupon đã hết hạn' };
  if (c.maxUses > 0 && c.usedCount >= c.maxUses) return { valid: false, error: 'Coupon đã hết lượt dùng' };
  if (c.appliesTo === 'courses' && type === 'course') {
    if (c.courseIds.length > 0 && !c.courseIds.includes(targetId)) return { valid: false, error: 'Coupon không áp dụng cho khóa này' };
  } else if (c.appliesTo === 'lessons' && type === 'lesson') {
    if (c.lessonIds.length > 0 && !c.lessonIds.includes(targetId)) return { valid: false, error: 'Coupon không áp dụng cho bài này' };
  } else if (c.appliesTo !== 'all') {
    return { valid: false, error: `Coupon chỉ áp dụng cho ${c.appliesTo === 'courses' ? 'khóa học' : 'bài học'}` };
  }
  let discountAmount = c.discountType === 'percent'
    ? Math.round(originalPrice * c.discountValue / 100)
    : c.discountValue;
  discountAmount = Math.min(discountAmount, originalPrice);
  const finalPrice = Math.max(0, originalPrice - discountAmount);
  return {
    valid: true, discountAmount, finalPrice,
    couponId: c.id, code: c.code,
    discountType: c.discountType, discountValue: c.discountValue
  };
}

export async function incrementCouponUsage(couponId) {
  const { data } = await supabase.from('coupons').select('used_count').eq('id', couponId).single();
  if (!data) return;
  await supabase.from('coupons').update({ used_count: (data.used_count || 0) + 1 }).eq('id', couponId);
}


// ============================================
// REVOKE VIP — admin xóa quyền xem bài/khóa của user
// ============================================
export async function revokeUserPaidAccess(userId, type, targetId) {
  const cur = await fetchUserProgress(userId);
  const patch = { last_update: new Date().toISOString() };
  if (type === 'course' && targetId) {
    patch.paid_courses = (cur.paidCourses || []).filter(id => id !== targetId);
  } else if (type === 'lesson' && targetId) {
    patch.paid_lessons = (cur.paidLessons || []).filter(id => id !== targetId);
  } else {
    throw new Error('Type không hợp lệ');
  }
  const { error } = await supabase.from('user_progress').update(patch).eq('user_id', userId);
  if (error) throw error;
}


// ============================================
// QUIZ SOLUTIONS (admin only) + server-side submit
// ============================================
export async function saveQuizSolutions(lessonId, solutions) {
  // Upsert to lesson_quiz_solutions table (admin RLS only)
  const { error } = await supabase
    .from('lesson_quiz_solutions')
    .upsert({ lesson_id: lessonId, solutions, updated_at: new Date().toISOString() }, { onConflict: 'lesson_id' });
  if (error) throw error;
}

export async function fetchQuizSolutions(lessonId) {
  const { data, error } = await supabase
    .from('lesson_quiz_solutions')
    .select('solutions')
    .eq('lesson_id', lessonId).maybeSingle();
  if (error) throw error;
  return data?.solutions || [];
}

/** Submit quiz answers to server for validation */
export async function submitQuizAnswers(lessonId, answers, durationMs) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error('Chưa đăng nhập');

  const r = await fetch('/api/quiz-submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token
    },
    body: JSON.stringify({ lesson_id: lessonId, answers, duration_ms: durationMs || 0 })
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || 'Lỗi gửi bài quiz');
  return json;
}



// ============================================
// PHASE A — SETTINGS + DASHBOARD HELPERS
// ============================================

/** Defaults notification prefs (mirror SQL default) */
export const DEFAULT_NOTIF_PREFS = {
  email_reminders:    true,
  email_milestones:   true,
  email_promotions:   true,
  email_newsletter:   true,
  push_messages:      true,
  push_reminders:     true,
  push_achievements:  true
};

/** Đọc profile mở rộng (Hồ sơ tab) */
export async function fetchUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_progress')
    .select('user_id, email, display_name, photo_url, phone, bio, custom_name, custom_avatar, notification_prefs, created_at, streak_days, streak_longest, streak_last_date, xp_total')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    userId: data.user_id,
    email: data.email,
    displayName: data.display_name,
    photoUrl: data.photo_url,
    customName: data.custom_name || '',
    customAvatar: data.custom_avatar || '',
    phone: data.phone || '',
    bio: data.bio || '',
    notificationPrefs: { ...DEFAULT_NOTIF_PREFS, ...(data.notification_prefs || {}) },
    createdAt: data.created_at,
    streakDays: data.streak_days || 0,
    streakLongest: data.streak_longest || 0,
    streakLastDate: data.streak_last_date,
    xpTotal: data.xp_total || 0
  };
}

/** Update profile: name / phone / bio / customAvatar */
export async function updateUserProfile(userId, patch) {
  const fields = {};
  if (patch.customName !== undefined)   fields.custom_name   = patch.customName;
  if (patch.phone !== undefined)        fields.phone         = patch.phone;
  if (patch.bio !== undefined)          fields.bio           = patch.bio;
  if (patch.customAvatar !== undefined) fields.custom_avatar = patch.customAvatar;
  fields.last_update = new Date().toISOString();
  const { error } = await supabase.from('user_progress').update(fields).eq('user_id', userId);
  if (error) throw error;
}

/** Update notification prefs */
export async function updateNotificationPrefs(userId, prefs) {
  const merged = { ...DEFAULT_NOTIF_PREFS, ...prefs };
  const { error } = await supabase
    .from('user_progress')
    .update({ notification_prefs: merged, last_update: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
  return merged;
}

/** Lấy lịch sử thanh toán của CHÍNH user (RLS đảm bảo user chỉ thấy của mình) */
export async function fetchMyPayments(userId) {
  const { data, error } = await supabase
    .from('payments').select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(dbToFrontPayment);
}

/** Level/XP system — mỗi level = 200 XP, công thức chuẩn EXP-based */
export const XP_PER_LEVEL = 200;

export function calculateLevel(xpTotal) {
  const xp = Math.max(0, xpTotal || 0);
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpInLevel = xp % XP_PER_LEVEL;
  const xpToNext  = XP_PER_LEVEL - xpInLevel;
  return {
    level,
    xpTotal: xp,
    xpInLevel,
    xpToNext,
    xpPerLevel: XP_PER_LEVEL,
    percent: Math.round((xpInLevel / XP_PER_LEVEL) * 100)
  };
}

/** Tính XP từ progress (giống calculateScore, nhưng chỉ trả số) */
export function computeXp(progress, courses) {
  const s = calculateScore(progress || {}, courses || []);
  return s.total;
}

/** Update streak khi user vào trang (gọi 1 lần / day) */
export async function touchStreak(userId) {
  const cur = await fetchUserProfile(userId);
  if (!cur) return null;

  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().slice(0,10);
  const last = cur.streakLastDate || null;

  let newStreak = cur.streakDays || 0;
  let newLongest = cur.streakLongest || 0;

  if (last === todayStr) {
    return { streakDays: newStreak, streakLongest: newLongest, changed: false };
  }

  if (last) {
    const lastDate = new Date(last + 'T00:00:00');
    const diffDays = Math.round((today - lastDate) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) newStreak += 1;            // liên tiếp
    else if (diffDays > 1) newStreak = 1;          // gãy chuỗi → reset
  } else {
    newStreak = 1;
  }
  if (newStreak > newLongest) newLongest = newStreak;

  const { error } = await supabase.from('user_progress').update({
    streak_days: newStreak,
    streak_longest: newLongest,
    streak_last_date: todayStr,
    last_update: new Date().toISOString()
  }).eq('user_id', userId);
  if (error) console.warn('touchStreak:', error);

  return { streakDays: newStreak, streakLongest: newLongest, changed: true };
}

/** Cache XP về DB (gọi sau khi mark lesson completed / nộp quiz) */
export async function syncXpCache(userId, xp) {
  const { error } = await supabase.from('user_progress')
    .update({ xp_total: xp, last_update: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) console.warn('syncXpCache:', error);
}

/** Xóa account (Bảo mật tab) — chỉ xóa data, KHÔNG xóa Supabase auth user
 *  (xóa auth phải dùng service role → user phải bấm "Xóa" rồi liên hệ admin)
 *  Trước mắt: reset hết data + ghi log để admin xử lý.
 */
export async function requestAccountDeletion(userId, userEmail, reason) {
  // Reset progress
  await supabase.from('user_progress').update({
    completed: [], unlocked_at: {}, paid_lessons: [], paid_courses: [],
    quiz_scores: {}, quiz_attempts: {}, streak_days: 0, xp_total: 0,
    notification_prefs: { email_reminders: false, email_milestones: false,
      email_promotions: false, email_newsletter: false,
      push_messages: false, push_reminders: false, push_achievements: false },
    last_update: new Date().toISOString()
  }).eq('user_id', userId);

  // Log để admin xóa Supabase auth user thủ công
  await supabase.from('admin_notifications').insert([{
    type: 'account_deletion_request', severity: 'high',
    user_id: userId, user_email: userEmail,
    message: `User ${userEmail} yêu cầu xóa account. Lý do: ${reason || '(không nhập)'}. Vào Supabase → Auth → Users → Delete user.`,
    read: false
  }]);

  // Logout
  await supabase.auth.signOut();
}
