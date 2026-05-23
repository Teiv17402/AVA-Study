// ============================================
// FIREBASE INIT + AUTH + FIRESTORE HELPERS
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCU9fEVcnrAdq8AT4vSWWKr6IJ9WMQuRXs",
  authDomain: "ava-study.firebaseapp.com",
  projectId: "ava-study",
  storageBucket: "ava-study.firebasestorage.app",
  messagingSenderId: "729248373415",
  appId: "1:729248373415:web:1c5f2077f242cd407a1982"
};

export const ADMIN_EMAILS = [
  "lehoangviet.17042002@gmail.com"
];

// ============================================
// BANK CONFIG — DEMO DATA (admin sửa lại sau)
// ============================================
export const BANK_CONFIG = {
  bankCode: "MB",            // Mã ngân hàng VietQR (xem https://api.vietqr.io/v2/banks)
  bankName: "MB Bank",
  accountNo: "0123456789",
  accountName: "NGUYEN VAN DEMO",
  defaultPrice: 99000        // Giá mặc định 1 bài VIP (VNĐ)
};

/** Tạo URL ảnh VietQR */
export function buildVietQrUrl(amount, content) {
  const params = new URLSearchParams({
    amount: amount,
    addInfo: content,
    accountName: BANK_CONFIG.accountName
  });
  return `https://img.vietqr.io/image/${BANK_CONFIG.bankCode}-${BANK_CONFIG.accountNo}-compact2.png?${params}`;
}

/** Tạo nội dung chuyển khoản unique */
export function buildTransferContent(userId, lessonId) {
  const u = userId.slice(0, 6).toUpperCase();
  const l = lessonId.slice(-5).toUpperCase();
  return `AVA${u}${l}`;
}

/** Tạo nội dung chuyển khoản unique cho khóa */
export function buildCourseTransferContent(userId, courseId) {
  const u = userId.slice(0, 6).toUpperCase();
  const c = courseId.slice(-5).toUpperCase();
  return `AVAK${u}${c}`;
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp
};

export function isAdmin(user) {
  return !!user && ADMIN_EMAILS.includes(user.email);
}

export async function ensureUserDoc(user) {
  if (!user) return;
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      email: user.email,
      displayName: user.displayName || user.email,
      photoURL: user.photoURL || "",
      role: isAdmin(user) ? "admin" : "user",
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp()
    });
  } else {
    await updateDoc(userRef, {
      lastLogin: serverTimestamp(),
      role: isAdmin(user) ? "admin" : (snap.data().role || "user")
    });
  }
}

export function waitForAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export async function requireAuth() {
  const user = await waitForAuth();
  if (!user) {
    location.href = "index.html";
    return null;
  }
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
  await signOut(auth);
  location.href = "index.html";
}

export async function fetchCourses() {
  const q = query(collection(db, "courses"), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchCourse(courseId) {
  const snap = await getDoc(doc(db, "courses", courseId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createCourse(data) {
  const courses = await fetchCourses();
  const maxOrder = courses.reduce((m, c) => Math.max(m, c.order || 0), 0);
  const ref = await addDoc(collection(db, "courses"), {
    title: data.title || "Khóa học mới",
    description: data.description || "",
    level: data.level || "Cơ bản",
    thumbnail: data.thumbnail || "",
    lessons: data.lessons || [],
    order: maxOrder + 1,
    isVip: !!data.isVip,
    price: data.price || 0,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateCourse(courseId, data) {
  await updateDoc(doc(db, "courses", courseId), data);
}

export async function deleteCourse(courseId) {
  await deleteDoc(doc(db, "courses", courseId));
}

export async function fetchUserProgress(userId) {
  const snap = await getDoc(doc(db, "userProgress", userId));
  if (!snap.exists()) return { completed: [], unlockedAt: {}, paidLessons: [], paidCourses: [], quizScores: {}, quizAttempts: {} };
  const data = snap.data();
  return {
    completed: data.completed || [],
    unlockedAt: data.unlockedAt || {},
    paidLessons: data.paidLessons || [],
    paidCourses: data.paidCourses || [],
    quizScores: data.quizScores || {},
    quizAttempts: data.quizAttempts || {},
    violations: data.violations || [],
    bannedUntil: data.bannedUntil || 0,
    lastUpdate: data.lastUpdate
  };
}

export async function markLessonCompleted(userId, lessonId, nextLessonId) {
  const ref = doc(db, "userProgress", userId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const completed = data.completed || [];
  const unlockedAt = data.unlockedAt || {};

  if (!completed.includes(lessonId)) {
    completed.push(lessonId);
  }
  if (nextLessonId && !unlockedAt[nextLessonId]) {
    unlockedAt[nextLessonId] = Date.now();
  }

  await setDoc(ref, {
    completed,
    unlockedAt,
    lastUpdate: serverTimestamp()
  }, { merge: true });

  return { completed, unlockedAt };
}

export async function ensureFirstUnlock(userId, firstLessonId) {
  if (!firstLessonId) return null;
  const ref = doc(db, "userProgress", userId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const completed = data.completed || [];
  const unlockedAt = data.unlockedAt || {};

  if (completed.includes(firstLessonId)) return null;
  if (unlockedAt[firstLessonId]) return null;

  unlockedAt[firstLessonId] = Date.now();
  await setDoc(ref, {
    completed,
    unlockedAt,
    lastUpdate: serverTimestamp()
  }, { merge: true });
  return { completed, unlockedAt };
}

export async function adminResetLessonTimer(userId, lessonId) {
  const ref = doc(db, "userProgress", userId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const unlockedAt = data.unlockedAt || {};
  unlockedAt[lessonId] = Date.now();
  await setDoc(ref, {
    unlockedAt,
    lastUpdate: serverTimestamp()
  }, { merge: true });
  return unlockedAt;
}

export async function resetUserProgress(userId) {
  await setDoc(doc(db, "userProgress", userId), {
    completed: [],
    unlockedAt: {},
    paidLessons: [],
    lastUpdate: serverTimestamp()
  });
}

export async function fetchAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchAllProgress() {
  const snap = await getDocs(collection(db, "userProgress"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ============================================
// PAYMENT HELPERS
// ============================================

/** User tạo yêu cầu thanh toán (status: pending) */
export async function createPayment(userId, userEmail, lessonId, courseId, courseTitle, lessonTitle, amount) {
  const transferContent = buildTransferContent(userId, lessonId);

  // Kiểm tra đã có pending payment cho bài này chưa
  const existing = await getDocs(query(
    collection(db, "payments"),
    where("userId", "==", userId),
    where("lessonId", "==", lessonId),
    where("status", "==", "pending")
  ));
  if (!existing.empty) {
    // Đã có pending — trả lại payment đó
    const d = existing.docs[0];
    return { id: d.id, ...d.data() };
  }

  const ref = await addDoc(collection(db, "payments"), {
    userId,
    userEmail: userEmail || "",
    type: "lesson",
    lessonId,
    courseId,
    courseTitle: courseTitle || "",
    lessonTitle: lessonTitle || "",
    amount,
    transferContent,
    status: "pending",
    createdAt: serverTimestamp()
  });
  return {
    id: ref.id,
    userId,
    type: "lesson",
    lessonId,
    courseId,
    amount,
    transferContent,
    status: "pending"
  };
}

/** User tạo yêu cầu thanh toán cho cả KHÓA (status: pending) */
export async function createCoursePayment(userId, userEmail, courseId, courseTitle, amount) {
  const transferContent = buildCourseTransferContent(userId, courseId);
  const existing = await getDocs(query(
    collection(db, "payments"),
    where("userId", "==", userId),
    where("courseId", "==", courseId),
    where("type", "==", "course"),
    where("status", "==", "pending")
  ));
  if (!existing.empty) {
    const d = existing.docs[0];
    return { id: d.id, ...d.data() };
  }
  const ref = await addDoc(collection(db, "payments"), {
    userId,
    userEmail: userEmail || "",
    type: "course",
    lessonId: "",
    courseId,
    courseTitle: courseTitle || "",
    lessonTitle: "",
    amount,
    transferContent,
    status: "pending",
    createdAt: serverTimestamp()
  });
  return {
    id: ref.id,
    userId,
    type: "course",
    courseId,
    amount,
    transferContent,
    status: "pending"
  };
}

/** User check trạng thái thanh toán cho 1 khóa */
export async function fetchMyPaymentForCourse(userId, courseId) {
  const snap = await getDocs(query(
    collection(db, "payments"),
    where("userId", "==", userId),
    where("courseId", "==", courseId),
    where("type", "==", "course")
  ));
  if (snap.empty) return null;
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return items[0];
}

/** User check trạng thái thanh toán cho 1 bài */
export async function fetchMyPaymentForLesson(userId, lessonId) {
  const snap = await getDocs(query(
    collection(db, "payments"),
    where("userId", "==", userId),
    where("lessonId", "==", lessonId)
  ));
  if (snap.empty) return null;
  // Lấy cái mới nhất
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return items[0];
}

/** Admin lấy list tất cả payment pending */
export async function fetchPendingPayments() {
  const snap = await getDocs(query(
    collection(db, "payments"),
    where("status", "==", "pending")
  ));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return items;
}

/** Admin lấy TẤT CẢ payments (mọi status) — cho tab Lịch sử */
export async function fetchAllPayments() {
  const snap = await getDocs(collection(db, "payments"));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return items;
}

/** Admin duyệt payment → thêm lesson vào paidLessons của user */
export async function approvePayment(paymentId, userId, lessonId, adminUid) {
  // Update payment status
  await updateDoc(doc(db, "payments", paymentId), {
    status: "approved",
    approvedAt: serverTimestamp(),
    approvedBy: adminUid
  });

  // Add lessonId vào paidLessons của user
  const progRef = doc(db, "userProgress", userId);
  const snap = await getDoc(progRef);
  const data = snap.exists() ? snap.data() : {};
  const paidLessons = data.paidLessons || [];
  if (!paidLessons.includes(lessonId)) {
    paidLessons.push(lessonId);
  }
  await setDoc(progRef, {
    paidLessons,
    lastUpdate: serverTimestamp()
  }, { merge: true });
}

/** Admin duyệt payment KHÓA → thêm courseId vào paidCourses của user */
export async function approveCoursePayment(paymentId, userId, courseId, adminUid) {
  await updateDoc(doc(db, "payments", paymentId), {
    status: "approved",
    approvedAt: serverTimestamp(),
    approvedBy: adminUid
  });
  const progRef = doc(db, "userProgress", userId);
  const snap = await getDoc(progRef);
  const data = snap.exists() ? snap.data() : {};
  const paidCourses = data.paidCourses || [];
  if (!paidCourses.includes(courseId)) {
    paidCourses.push(courseId);
  }
  await setDoc(progRef, {
    paidCourses,
    lastUpdate: serverTimestamp()
  }, { merge: true });
}

/** Admin từ chối payment */
export async function rejectPayment(paymentId, adminUid) {
  await updateDoc(doc(db, "payments", paymentId), {
    status: "rejected",
    approvedAt: serverTimestamp(),
    approvedBy: adminUid
  });
}

/** USER tự auto-duyệt bài VIP — gọi khi user bấm "Tôi đã thanh toán" */
export async function selfApprovePayment(paymentId, userId, lessonId) {
  await updateDoc(doc(db, "payments", paymentId), {
    status: "auto_approved",
    autoApprovedAt: serverTimestamp()
  });
  const progRef = doc(db, "userProgress", userId);
  const snap = await getDoc(progRef);
  const data = snap.exists() ? snap.data() : {};
  const paidLessons = data.paidLessons || [];
  if (!paidLessons.includes(lessonId)) paidLessons.push(lessonId);
  await setDoc(progRef, {
    paidLessons,
    lastUpdate: serverTimestamp()
  }, { merge: true });
}

/** USER tự auto-duyệt cả KHÓA */
export async function selfApproveCoursePayment(paymentId, userId, courseId) {
  await updateDoc(doc(db, "payments", paymentId), {
    status: "auto_approved",
    autoApprovedAt: serverTimestamp()
  });
  const progRef = doc(db, "userProgress", userId);
  const snap = await getDoc(progRef);
  const data = snap.exists() ? snap.data() : {};
  const paidCourses = data.paidCourses || [];
  if (!paidCourses.includes(courseId)) paidCourses.push(courseId);
  await setDoc(progRef, {
    paidCourses,
    lastUpdate: serverTimestamp()
  }, { merge: true });
}

/** ADMIN báo gian lận: revoke quyền + đổi status fraud */
export async function markPaymentAsFraud(paymentId, userId, lessonId, courseId, type, adminUid) {
  await updateDoc(doc(db, "payments", paymentId), {
    status: "fraud",
    fraudAt: serverTimestamp(),
    fraudBy: adminUid
  });
  const progRef = doc(db, "userProgress", userId);
  const snap = await getDoc(progRef);
  const data = snap.exists() ? snap.data() : {};
  if (type === "course" && courseId) {
    const paidCourses = (data.paidCourses || []).filter(id => id !== courseId);
    await setDoc(progRef, { paidCourses, lastUpdate: serverTimestamp() }, { merge: true });
  } else if (lessonId) {
    const paidLessons = (data.paidLessons || []).filter(id => id !== lessonId);
    await setDoc(progRef, { paidLessons, lastUpdate: serverTimestamp() }, { merge: true });
  }
}

/** ADMIN verify auto-approved payment (sau khi đối chiếu với sao kê) */
export async function verifyAutoApproved(paymentId, adminUid) {
  await updateDoc(doc(db, "payments", paymentId), {
    status: "approved",
    approvedAt: serverTimestamp(),
    approvedBy: adminUid
  });
}

// ============================================
// F3: VIOLATION SYSTEM (vi phạm timer 24h)
// ============================================
export const VIOLATION_BAN_DAYS = [7, 30]; // L1: 7d, L2: 30d, L3: notify admin

/** Tự động ghi nhận vi phạm khi user load bài và bị expired */
export async function recordViolation(userId, userEmail, userName, courseId, courseTitle, lessonId, lessonTitle) {
  const progRef = doc(db, "userProgress", userId);
  const snap = await getDoc(progRef);
  const data = snap.exists() ? snap.data() : {};
  const violations = data.violations || [];
  const alreadyRecorded = violations.some(v => v.lessonId === lessonId);
  if (alreadyRecorded) return { count: violations.length, banUntil: data.bannedUntil || 0, alreadyRecorded: true };

  violations.push({
    at: Date.now(),
    courseId, courseTitle, lessonId, lessonTitle
  });
  const count = violations.length;

  let bannedUntil = data.bannedUntil || 0;
  const now = Date.now();
  if (count === 1) bannedUntil = now + VIOLATION_BAN_DAYS[0] * 24 * 60 * 60 * 1000;
  else if (count === 2) bannedUntil = now + VIOLATION_BAN_DAYS[1] * 24 * 60 * 60 * 1000;

  await setDoc(progRef, {
    violations, bannedUntil, lastUpdate: serverTimestamp()
  }, { merge: true });

  // Lần ≥3: tạo notification cho admin
  if (count >= 3) {
    await addDoc(collection(db, "adminNotifications"), {
      type: "repeat_violator",
      severity: "high",
      userId, userEmail, userName,
      courseId, courseTitle, lessonId, lessonTitle,
      violationCount: count,
      message: `User ${userName || userEmail} đã vi phạm ${count} lần. Cần nhắc trên cộng đồng.`,
      read: false,
      createdAt: serverTimestamp()
    });
  }

  return { count, bannedUntil, alreadyRecorded: false };
}

/** Check user bị ban chưa */
export function checkBanned(progress) {
  const bannedUntil = (progress && progress.bannedUntil) || 0;
  if (bannedUntil > Date.now()) {
    return {
      isBanned: true,
      until: bannedUntil,
      daysLeft: Math.ceil((bannedUntil - Date.now()) / (24 * 60 * 60 * 1000))
    };
  }
  return { isBanned: false };
}

/** Admin: lấy list user bị ban */
export async function fetchBannedUsers() {
  const snap = await getDocs(collection(db, "userProgress"));
  const now = Date.now();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => (p.bannedUntil || 0) > now);
}

/** Admin: lấy notifications chưa đọc */
export async function fetchAdminNotifications() {
  const snap = await getDocs(query(collection(db, "adminNotifications"), where("read", "==", false)));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return items;
}

/** Admin: mark notification đã đọc */
export async function markNotificationRead(notifId) {
  await updateDoc(doc(db, "adminNotifications", notifId), { read: true, readAt: serverTimestamp() });
}

/** Admin: gỡ ban thủ công */
export async function unbanUser(userId) {
  await setDoc(doc(db, "userProgress", userId), {
    bannedUntil: 0,
    lastUpdate: serverTimestamp()
  }, { merge: true });
}

// ============================================
// F6: LEADERBOARD / SCORING
// ============================================
/** Tính điểm 1 user từ progress + courses */
export function calculateScore(progress, courses) {
  if (!progress) return { total: 0, monthly: 0, breakdown: {} };
  const completed = progress.completed || [];
  const paidCourses = progress.paidCourses || [];
  const violations = progress.violations || [];
  const quizScores = progress.quizScores || {};

  let score = 0;
  let monthlyScore = 0;
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  // 10 điểm / bài hoàn thành
  score += completed.length * 10;

  // 100 điểm / khóa hoàn thành (mọi bài trong khóa đều completed)
  const courseDone = courses.filter(c => {
    const ids = (c.lessons || []).map(l => l.id);
    return ids.length > 0 && ids.every(id => completed.includes(id));
  });
  score += courseDone.length * 100;

  // Quiz bonus: +20 nếu quiz score ≥95%
  Object.values(quizScores).forEach(s => {
    if (s >= 95) score += 20;
  });

  // Penalty -10 mỗi vi phạm
  score -= violations.length * 10;

  // Monthly: only count completions in current month (best-effort via unlockedAt timestamps)
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

/** Lấy leaderboard — return [{user, progress, score}] sorted by total */
export async function fetchLeaderboard(courses) {
  const [usersSnap, progSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "userProgress"))
  ]);
  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const progMap = {};
  progSnap.docs.forEach(d => { progMap[d.id] = d.data(); });

  return users
    .filter(u => u.role !== "admin")
    .map(u => {
      const prog = progMap[u.id];
      const score = calculateScore(prog, courses);
      return { user: u, progress: prog, score };
    })
    .sort((a, b) => b.score.total - a.score.total);
}


/** Lưu điểm quiz tốt nhất cho 1 bài + tăng attempts */
export async function saveQuizScore(userId, lessonId, score) {
  const ref = doc(db, "userProgress", userId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const quizScores = data.quizScores || {};
  const quizAttempts = data.quizAttempts || {};
  // Chỉ lưu nếu score cao hơn lần trước
  if (!quizScores[lessonId] || score > quizScores[lessonId]) {
    quizScores[lessonId] = score;
  }
  quizAttempts[lessonId] = (quizAttempts[lessonId] || 0) + 1;
  await setDoc(ref, {
    quizScores, quizAttempts,
    lastUpdate: serverTimestamp()
  }, { merge: true });
  return { score, bestScore: quizScores[lessonId], attempts: quizAttempts[lessonId] };
}
