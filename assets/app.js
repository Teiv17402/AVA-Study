// ============================================
// APP COMMON — header user chip + logout + utils
// ============================================
import {
  auth,
  onAuthStateChanged,
  isAdmin,
  logout,
  fetchUserProfile
} from "./firebase.js";

/* Cache profile để header không gọi DB nhiều lần */
let _profileCache = null;

/* ---------- Header user chip ---------- */
export function renderHeader(user, profile) {
  const el = document.getElementById("header-actions");
  if (!el || !user) return;

  // Ưu tiên customAvatar/customName từ profile nếu có
  const displayName = (profile && profile.customName) || user.displayName || user.email;
  const avatarSrc   = (profile && profile.customAvatar) || user.photoURL;

  const admin = isAdmin(user);
  const avatar = avatarSrc
    ? `<img src="${escapeHtml(avatarSrc)}" referrerpolicy="no-referrer" alt="" />`
    : `<div style="width:28px;height:28px;border-radius:50%;background:#d4af6e;color:#000;display:flex;align-items:center;justify-content:center;font-weight:700;">${(displayName || "U")[0].toUpperCase()}</div>`;

  // Highlight nav theo trang hiện tại
  const page = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
  const isActive = (n) => page === n ? 'active' : '';

  const navHtml = `
      <a class="btn-header ${isActive('dashboard.html')}" href="dashboard.html" title="Tổng quan">📊 Tổng quan</a>
      <a class="btn-header ${isActive('my-courses.html')}" href="my-courses.html" title="Khóa học của tôi">📚 Khóa của tôi</a>
      <a class="btn-header ${isActive('home.html')}" href="home.html" title="Khám phá khóa học">🔍 Khám phá</a>
      <a class="btn-header ${isActive('leaderboard.html')}" href="leaderboard.html" title="Bảng xếp hạng">🏆 Xếp hạng</a>
      <a class="btn-header ${isActive('settings.html')}" href="settings.html" title="Cài đặt">⚙ Cài đặt</a>
      ${admin ? `<a class="btn-header ${isActive('admin.html')}" href="admin.html" title="Trang quản trị">🛠 Quản trị</a>` : ""}
  `;

  el.innerHTML = `
    <nav class="header-nav">${navHtml}</nav>
    <div class="user-chip" title="${escapeHtml(user.email)}">
      ${avatar}
      <span class="name">${escapeHtml(displayName)}</span>
      ${admin ? `<span class="badge">Admin</span>` : ""}
    </div>
    <button class="btn-header danger desktop-only" id="btn-logout">Đăng xuất</button>
    <button class="hamburger-btn" id="btn-hamburger" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>
  `;

  // Mobile drawer — re-create mỗi lần renderHeader để listener không bị stale
  const oldDrawer = document.getElementById('mobile-drawer');
  if (oldDrawer) oldDrawer.remove();

  const drawer = document.createElement('div');
  drawer.id = 'mobile-drawer';
  drawer.className = 'mobile-drawer';
  drawer.innerHTML = `
    <div class="mobile-drawer-backdrop" id="drawer-backdrop"></div>
    <aside class="mobile-drawer-panel">
      <div class="mobile-drawer-head">
        <div class="user-chip">${avatar}<span class="name">${escapeHtml(displayName)}</span></div>
        <button class="mobile-drawer-close" id="drawer-close">×</button>
      </div>
      <nav class="mobile-drawer-nav">${navHtml}</nav>
      <button class="btn btn-danger" id="btn-logout-mobile">🛑 Đăng xuất</button>
    </aside>
  `;
  document.body.appendChild(drawer);

  // Bind listeners — querySelector for fresh elements
  const hamBtn = document.getElementById('btn-hamburger');
  if (hamBtn) hamBtn.addEventListener('click', () => drawer.classList.add('open'));
  document.getElementById('drawer-close').addEventListener('click', () =>
    drawer.classList.remove('open'));
  document.getElementById('drawer-backdrop').addEventListener('click', () =>
    drawer.classList.remove('open'));
  document.getElementById('btn-logout-mobile').addEventListener('click', () => {
    if (confirm("Đăng xuất khỏi tài khoản?")) logout();
  });

  // Close drawer khi click vào link nav (cho phép navigate mượt)
  drawer.querySelectorAll('a.btn-header').forEach(a => {
    a.addEventListener('click', () => drawer.classList.remove('open'));
  });

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

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  renderHeader(user);                       // Render ngay (avatar Google)
  try {
    if (!_profileCache) _profileCache = await fetchUserProfile(user.uid);
    if (_profileCache) renderHeader(user, _profileCache); // Re-render với customAvatar
  } catch (e) { /* silent */ }
});
