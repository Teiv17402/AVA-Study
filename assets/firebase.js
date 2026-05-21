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

// Whitelist email admin (chỉ những email trong này mới là admin)
export const ADMIN_EMAILS = [
  "lehoangviet.17042002@gmail.com"
];

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Re-export những hàm dùng nhiều
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
  orderBy,
  serverTimestamp
};

/* ---------- Auth helpers ---------- */
export function isAdmin(user) {
  return !!user && ADMIN_EMAILS.includes(user.email);
}

/**
 * Đảm bảo user có doc trong /users/{uid}. Tự tạo nếu chưa có.
 */
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

/**
 * Chờ Firebase xác nhận trạng thái đăng nhập. Trả về user hoặc null.
 */
export function waitForAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

/**
 * Yêu cầu đăng nhập — nếu chưa đăng nhập sẽ redirect sang login.html
 */
export async function requireAuth() {
  const user = await waitForAuth();
  if (!user) {
    // Chưa login → đẩy về landing page (có 2 button: đăng nhập / đăng ký test)
    location.href = "index.html";
    return null;
  }
  await ensureUserDoc(user);
  return user;
}

/**
 * Yêu cầu đăng nhập + là admin — không phải admin sẽ redirect về home
 */
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
  // Đăng xuất xong về landing page
  location.href = "index.html";
}

/* ---------- Firestore data helpers ---------- */

/** Lấy danh sách khóa học, sắp xếp theo order */
export async function fetchCourses() {
  const q = query(collection(db, "courses"), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Lấy 1 khóa học */
export async function fetchCourse(courseId) {
  const snap = await getDoc(doc(db, "courses", courseId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** Tạo khóa mới */
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

/** Cập nhật khóa */
export async function updateCourse(courseId, data) {
  await updateDoc(doc(db, "courses", courseId), data);
}

/** Xóa khóa */
export async function deleteCourse(courseId) {
  await deleteDoc(doc(db, "courses", courseId));
}

/* ---------- User progress helpers ---------- */

/** Lấy tiến độ của user hiện tại */
export async function fetchUserProgress(userId) {
  const snap = await getDoc(doc(db, "userProgress", userId));
  if (!snap.exists()) return { completed: [] };
  return snap.data();
}

/** Đánh dấu hoàn thành 1 bài */
export async function markLessonCompleted(userId, lessonId) {
  const ref = doc(db, "userProgress", userId);
  const snap = await getDoc(ref);
  const completed = snap.exists() ? (snap.data().completed || []) : [];
  if (!completed.includes(lessonId)) {
    completed.push(lessonId);
    await setDoc(ref, { completed, lastUpdate: serverTimestamp() }, { merge: true });
  }
  return completed;
}

/** Reset tiến độ */
export async function resetUserProgress(userId) {
  await setDoc(doc(db, "userProgress", userId), {
    completed: [],
    lastUpdate: serverTimestamp()
  });
}

/* ---------- Admin: list users + progress ---------- */
export async function fetchAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchAllProgress() {
  const snap = await getDocs(collection(db, "userProgress"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
