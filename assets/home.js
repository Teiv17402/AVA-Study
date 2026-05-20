// ============================================
// HOME PAGE — list courses
// ============================================
import {
  requireAuth,
  fetchCourses,
  fetchUserProgress,
  isAdmin
} from "./firebase.js";
import {
  escapeHtml,
  getCourseProgress,
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
      return `
        <a class="course-card" href="course.html?id=${encodeURIComponent(course.id)}">
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
