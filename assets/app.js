// ============================================
// APP COMMON — header user chip + logout + utils
// ============================================
import {
  auth,
  onAuthStateChanged,
  isAdmin,
  logout
} from "./firebase.js";

/* ---------- Header user chip ---------- */
export function renderHeader(user) {
  const el = document.getElementById("header-actions");
  if (!el || !user) return;

  const admin = isAdmin(user);
  const avatar = user.photoURL
    ? `<img src="${escapeHtml(user.photoURL)}" referrerpolicy="no-referrer" alt="" />`
    : `<div style="width:28px;height:28px;border-radius:50%;background:#d4af6e;color:#000;display:flex;align-items:center;justify-content:center;font-weight:700;">${(user.displayName || user.email || "U")[0].toUpperCase()}</div>`;

  el.innerHTML = `
    <a class="btn-header" href="leaderboard.html" title="Bảng xếp hạng">🏆 Xếp hạng</a>
    ${admin ? `<a class="btn-header" href="admin.html" title="Trang quản trị">⚙ Quản trị</a>` : ""}
    <div class="user-chip" title="${escapeHtml(user.email)}">
      ${avatar}
      <span class="name">${escapeHtml(user.displayName || user.email)}</span>
      ${admin ? `<span class="badge">Admin</span>` : ""}
    </div>
    <button class="btn-header danger" id="btn-logout">Đăng xuất</button>
  `;

  const btn = document.getElementById("btn-logout");
  if (btn) btn.addEventListener("click", () => {
    if (confirm("Đăng xuất khỏi tài khoản?")) logout();
  });
}

/* ---------- Utility ---------- */
export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} giây`;
  if (s === 0) return `${m} phút`;
  return `${m}p ${s}s`;
}

export function formatVnd(amount) {
  if (amount == null) return "";
  return amount.toLocaleString("vi-VN") + "đ";
}

export function flashMessage(text, type = "info") {
  let el = document.getElementById("flash-message");
  if (!el) {
    el = document.createElement("div");
    el.id = "flash-message";
    document.body.appendChild(el);
  }
  const colors = {
    info: "background:#d4af6e;color:#000;",
    success: "background:#4ade80;color:#000;",
    error: "background:#ef4444;color:#fff;"
  };
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:14px 22px;border-radius:8px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:9999;max-width:90%;text-align:center;display:block;${colors[type] || colors.info}`;
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = "none"; }, 2800);
}

/* ---------- Lesson unlock + 24h timer + VIP logic ---------- */
export const LESSON_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Trạng thái 1 bài:
 *   'completed'           — đã hoàn thành
 *   'available'           — đang mở
 *   'locked-prerequisite' — chưa xong bài trước
 *   'locked-expired'      — quá 24h chưa làm
 *   'locked-vip'          — VIP, chưa thanh toán
 */
export function getLessonStatus(lessons, lessonIndex, progress, course) {
  const lesson = lessons[lessonIndex];
  const completed = progress.completed || [];
  const unlockedAt = progress.unlockedAt || {};
  const paidLessons = progress.paidLessons || [];
  const paidCourses = progress.paidCourses || [];

  if (completed.includes(lesson.id)) return 'completed';

  if (course && course.isVip && !paidCourses.includes(course.id)) {
    return 'locked-vip-course';
  }

  if (lesson.isVip && !paidLessons.includes(lesson.id)) {
    return 'locked-vip';
  }

  if (lessonIndex === 0) {
    return checkExpired(unlockedAt[lesson.id]);
  }

  const prev = lessons[lessonIndex - 1];
  if (!completed.includes(prev.id)) return 'locked-prerequisite';

  return checkExpired(unlockedAt[lesson.id]);
}

function checkExpired(unlockTime) {
  if (!unlockTime) return 'available';
  const elapsed = Date.now() - unlockTime;
  return elapsed > LESSON_EXPIRY_MS ? 'locked-expired' : 'available';
}

export function getRemainingMs(lessonId, progress) {
  const unlockTime = (progress.unlockedAt || {})[lessonId];
  if (!unlockTime) return null;
  const remaining = LESSON_EXPIRY_MS - (Date.now() - unlockTime);
  return remaining > 0 ? remaining : 0;
}

export function formatRemaining(ms) {
  if (ms == null) return '';
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function isLessonUnlocked(lessons, lessonIndex, completedIds, progress, course) {
  if (Array.isArray(completedIds) && !progress) {
    if (lessonIndex === 0) return true;
    const prev = lessons[lessonIndex - 1];
    return completedIds.includes(prev.id);
  }
  const prog = progress || { completed: completedIds || [], unlockedAt: {}, paidLessons: [], paidCourses: [] };
  const status = getLessonStatus(lessons, lessonIndex, prog, course);
  return status === 'completed' || status === 'available';
}

export function getCourseProgress(lessons, completedIds) {
  const total = lessons.length;
  const done = lessons.filter(l => completedIds.includes(l.id)).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

onAuthStateChanged(auth, (user) => {
  if (user) renderHeader(user);
});
