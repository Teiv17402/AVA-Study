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
  if (!snap.exists()) return { completed: [], unlockedAt: {}, paidLessons: [] };
  const data = snap.data();
  return {
    completed: data.completed || [],
    unlockedAt: data.unlockedAt || {},
    paidLessons: data.paidLessons || [],
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
    lessonId,
    courseId,
    amount,
    transferContent,
    status: "pending"
  };
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

/** Admin từ chối payment */
export async function rejectPayment(paymentId, adminUid) {
  await updateDoc(doc(db, "payments", paymentId), {
    status: "rejected",
    approvedAt: serverTimestamp(),
    approvedBy: adminUid
  });
}
