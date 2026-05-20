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
    : `<div style="width:28px;height:28px;border-radius:50%;background:#ffd60a;color:#000;display:flex;align-items:center;justify-content:center;font-weight:700;">${(user.displayName || user.email || "U")[0].toUpperCase()}</div>`;

  el.innerHTML = `
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

export function flashMessage(text, type = "info") {
  let el = document.getElementById("flash-message");
  if (!el) {
    el = document.createElement("div");
    el.id = "flash-message";
    document.body.appendChild(el);
  }
  const colors = {
    info: "background:#ffd60a;color:#000;",
    success: "background:#4ade80;color:#000;",
    error: "background:#ef4444;color:#fff;"
  };
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:14px 22px;border-radius:8px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:9999;max-width:90%;text-align:center;display:block;${colors[type] || colors.info}`;
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = "none"; }, 2800);
}

/* ---------- Lesson unlock logic ---------- */
export function isLessonUnlocked(lessons, lessonIndex, completedIds) {
  if (lessonIndex === 0) return true;
  const prev = lessons[lessonIndex - 1];
  return completedIds.includes(prev.id);
}

export function getCourseProgress(lessons, completedIds) {
  const total = lessons.length;
  const done = lessons.filter(l => completedIds.includes(l.id)).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

/* ---------- Auto-attach auth listener on all pages ---------- */
onAuthStateChanged(auth, (user) => {
  if (user) renderHeader(user);
});
