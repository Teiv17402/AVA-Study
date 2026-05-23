// ============================================
// HOME PAGE — list courses
// ============================================
import {
  requireAuth,
  fetchCourses,
  fetchUserProgress,
  isAdmin,
  checkBanned,
  BANK_CONFIG
} from "./firebase.js";
import {
  escapeHtml,
  getCourseProgress,
  formatVnd,
  flashMessage,
  renderHeader
} from "./app.js";

export async function initHomePage() {
  const user = await requireAuth();
  if (!user) return;
  renderHeader(user);

  const grid = document.getElementById("course-grid");
  const subtitle = document.getElementById("welcome-subtitle");
  if (subtitle) subtitle.textContent = `Xin chào ${user.displayName || user.email}, chọn khóa học để bắt đầu`;

  try {
    const [courses, progress] = await Promise.all([
      fetchCourses(),
      fetchUserProgress(user.uid)
    ]);

    const completed = progress.completed || [];

    // Show ban banner if user banned
    if (!isAdmin(user)) {
      const ban = checkBanned(progress);
      if (ban.isBanned) {
        const banBanner = document.createElement("div");
        banBanner.className = "ban-banner";
        const until = new Date(ban.until).toLocaleString("vi-VN");
        banBanner.innerHTML = `
          <div class="ban-banner-icon">⛔</div>
          <div class="ban-banner-text">
            <strong>Tài khoản đang bị khóa ${ban.daysLeft} ngày</strong> do vi phạm cam kết học tập.
            Hết hạn: <strong>${until}</strong>. Bạn không xem được bài trong thời gian này.
          </div>`;
        grid.parentNode.insertBefore(banBanner, grid);
      }
    }

    if (!courses.length) {
      const admin = isAdmin(user);
      grid.innerHTML = `
        <div class="empty-state">
          <div class="icon">📚</div>
          <p><strong>Chưa có khóa học nào</strong></p>
          ${admin
            ? `<p>Bạn là admin. Hãy vào <a href="admin.html">trang Quản trị</a> để tạo khóa học đầu tiên.</p>`
            : `<p>Admin chưa tạo khóa học. Vui lòng quay lại sau.</p>`}
        </div>
      `;
      return;
    }

    grid.innerHTML = courses.map(course => {
      const lessons = course.lessons || [];
      const prog = getCourseProgress(lessons, completed);
      const hasVipLessons = lessons.some(l => l.isVip);
      const vipBadge = course.isVip
        ? `<div class="course-vip-overlay course-vip-full"><span>👑 KHÓA VIP</span><strong>${formatVnd(course.price || BANK_CONFIG.defaultPrice)}</strong></div>`
        : hasVipLessons
          ? `<div class="course-vip-overlay course-vip-partial"><span>👑 Có bài VIP</span></div>`
          : "";
      return `
        <a class="course-card ${course.isVip ? 'vip-course' : ''}" href="course.html?id=${encodeURIComponent(course.id)}">
          ${vipBadge}
          <div class="course-thumb">▶</div>
          <div class="course-body">
            ${course.level ? `<span class="course-level">${escapeHtml(course.level)}</span>` : ""}
            <h3 class="course-title">${escapeHtml(course.title)}</h3>
            <p class="course-desc">${escapeHtml(course.description || "")}</p>
            <div class="course-meta">
              <span>📖 ${lessons.length} bài</span>
              <span>${prog.percent}% hoàn thành</span>
            </div>
            <div class="course-progress-bar">
              <div class="course-progress-fill" style="width:${prog.percent}%"></div>
            </div>
          </div>
        </a>
      `;
    }).join("");
  } catch (err) {
    console.error(err);
    grid.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>Lỗi tải dữ liệu: ${escapeHtml(err.message)}</p>
        <p style="font-size:13px">Có thể do chưa cấu hình Firestore Security Rules. Kiểm tra trong README.</p>
      </div>
    `;
  }
}
