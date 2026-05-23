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
      // Tìm giá min của các bài VIP (cho hiển thị giá khi khóa có bài VIP riêng)
      const minVipLessonPrice = hasVipLessons
        ? Math.min(...lessons.filter(l => l.isVip).map(l => l.price || BANK_CONFIG.defaultPrice))
        : 0;

      const lockSvg = `<svg class="thumb-lock-svg" viewBox="0 0 64 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 36V22C16 13.16 23.16 6 32 6C40.84 6 48 13.16 48 22V36" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
        <rect x="8" y="36" width="48" height="38" rx="6" stroke="currentColor" stroke-width="5" fill="none"/>
        <circle cx="32" cy="52" r="4" fill="currentColor"/>
        <path d="M32 56v8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      </svg>`;

      const thumbContent = course.isVip
        ? `<div class="course-thumb thumb-locked thumb-locked-full">${lockSvg}<div class="thumb-lock-label">👑 KHÓA VIP</div></div>`
        : hasVipLessons
          ? `<div class="course-thumb thumb-locked thumb-locked-partial">${lockSvg}<div class="thumb-lock-label">👑 CÓ BÀI VIP</div></div>`
          : `<div class="course-thumb">▶</div>`;

      const priceLine = course.isVip
        ? `<div class="course-price-line"><span class="price-label">💰 Mở toàn khóa:</span> <strong class="price-value">${formatVnd(course.price || BANK_CONFIG.defaultPrice)}</strong></div>`
        : hasVipLessons
          ? `<div class="course-price-line price-partial"><span class="price-label">💰 Bài VIP từ:</span> <strong class="price-value">${formatVnd(minVipLessonPrice)}</strong></div>`
          : "";

      return `
        <a class="course-card ${course.isVip ? 'vip-course' : ''}${hasVipLessons && !course.isVip ? ' has-vip-lessons' : ''}" href="course.html?id=${encodeURIComponent(course.id)}">
          ${thumbContent}
          <div class="course-body">
            ${course.level ? `<span class="course-level">${escapeHtml(course.level)}</span>` : ""}
            <h3 class="course-title">${escapeHtml(course.title)}</h3>
            <p class="course-desc">${escapeHtml(course.description || "")}</p>
            ${priceLine}
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
