// ============================================
// ADMIN PAGE — quản lý khóa học, bài học, user
// ============================================
import {
  requireAdmin,
  fetchCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  fetchAllUsers,
  fetchAllProgress
} from "./firebase.js";
import {
  escapeHtml,
  formatDuration,
  flashMessage,
  renderHeader
} from "./app.js";

let currentUser = null;
let courses = [];
let editingCourseId = null;
let editingLesson = null; // { courseId, lessonIndex } — null nếu đang add mới

export async function initAdminPage() {
  currentUser = await requireAdmin();
  if (!currentUser) return;
  renderHeader(currentUser);

  setupTabs();
  setupModals();
  await refreshCourses();
}

/* ---------- TABS ---------- */
function setupTabs() {
  document.querySelectorAll(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".admin-section").forEach(s => s.classList.remove("active"));
      tab.classList.add("active");
      const tabName = tab.dataset.tab;
      document.getElementById(`section-${tabName}`).classList.add("active");
      if (tabName === "users") loadUsers();
    });
  });

  document.getElementById("btn-new-course").addEventListener("click", () => openCourseModal());
}

/* ---------- COURSES ---------- */
async function refreshCourses() {
  try {
    courses = await fetchCourses();
    renderCourses();
  } catch (err) {
    document.getElementById("courses-container").innerHTML = `<p style="color:#ef4444">Lỗi: ${escapeHtml(err.message)}</p>`;
  }
}

function renderCourses() {
  const c = document.getElementById("courses-container");
  if (!courses.length) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="icon">📚</div>
        <p><strong>Chưa có khóa học nào</strong></p>
        <p>Bấm "+ Thêm khóa học" để tạo khóa đầu tiên.</p>
      </div>`;
    return;
  }

  c.innerHTML = courses.map(course => {
    const lessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    return `
      <div class="admin-card" data-course="${escapeHtml(course.id)}" style="border-color: var(--border)">
        <div class="admin-card-header">
          <div>
            <div class="admin-card-title">${escapeHtml(course.title)}</div>
            <div style="font-size:13px;color:var(--text-mute);margin-top:4px">
              ${escapeHtml(course.level || "")} · ${lessons.length} bài · Thứ tự: ${course.order || 0}
            </div>
          </div>
          <div class="admin-actions">
            <button class="btn btn-secondary btn-sm" data-action="edit-course" data-id="${course.id}">✏ Sửa</button>
            <button class="btn btn-primary btn-sm" data-action="add-lesson" data-id="${course.id}">+ Thêm bài</button>
            <button class="btn btn-danger btn-sm" data-action="delete-course" data-id="${course.id}">🗑 Xóa</button>
          </div>
        </div>

        ${course.description ? `<p style="color:var(--text-soft);margin-bottom:16px">${escapeHtml(course.description)}</p>` : ""}

        ${lessons.length === 0
          ? `<p style="color:var(--text-mute);font-style:italic">Chưa có bài học nào. Bấm "+ Thêm bài" để bắt đầu.</p>`
          : lessons.map((lesson, idx) => `
              <div class="admin-lesson-row">
                <div class="num">${idx + 1}</div>
                <div class="admin-lesson-info">
                  <div class="name">${escapeHtml(lesson.title)}</div>
                  <div class="meta">
                    ${formatDuration(lesson.duration || 0)} ·
                    ${lesson.driveFileId && lesson.driveFileId.trim() && lesson.driveFileId !== "REPLACE_WITH_GOOGLE_DRIVE_FILE_ID"
                      ? `✓ Có video`
                      : `⚠ Chưa có video`}
                  </div>
                </div>
                <div class="admin-actions">
                  <button class="btn btn-secondary btn-sm" data-action="move-up" data-course="${course.id}" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}>↑</button>
                  <button class="btn btn-secondary btn-sm" data-action="move-down" data-course="${course.id}" data-idx="${idx}" ${idx === lessons.length - 1 ? "disabled" : ""}>↓</button>
                  <button class="btn btn-secondary btn-sm" data-action="edit-lesson" data-course="${course.id}" data-idx="${idx}">✏</button>
                  <button class="btn btn-danger btn-sm" data-action="delete-lesson" data-course="${course.id}" data-idx="${idx}">🗑</button>
                </div>
              </div>
            `).join("")}
      </div>
    `;
  }).join("");

  // Bind actions
  c.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", handleAction);
  });
}

async function handleAction(e) {
  const btn = e.currentTarget;
  const action = btn.dataset.action;
  const courseId = btn.dataset.id || btn.dataset.course;
  const idx = btn.dataset.idx ? parseInt(btn.dataset.idx) : null;
  const course = courses.find(c => c.id === courseId);
  if (!course && action !== "new-course") return;

  switch (action) {
    case "edit-course":
      openCourseModal(course);
      break;
    case "delete-course":
      if (confirm(`Xóa khóa "${course.title}" và toàn bộ bài học? Không thể khôi phục.`)) {
        try {
          await deleteCourse(courseId);
          flashMessage("Đã xóa khóa học", "success");
          await refreshCourses();
        } catch (err) {
          flashMessage("Lỗi: " + err.message, "error");
        }
      }
      break;
    case "add-lesson":
      openLessonModal(courseId, null);
      break;
    case "edit-lesson":
      openLessonModal(courseId, idx);
      break;
    case "delete-lesson":
      const lessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      if (confirm(`Xóa bài "${lessons[idx].title}"?`)) {
        lessons.splice(idx, 1);
        lessons.forEach((l, i) => l.order = i);
        try {
          await updateCourse(courseId, { lessons });
          flashMessage("Đã xóa bài học", "success");
          await refreshCourses();
        } catch (err) {
          flashMessage("Lỗi: " + err.message, "error");
        }
      }
      break;
    case "move-up":
    case "move-down":
      await moveLesson(courseId, idx, action === "move-up" ? -1 : 1);
      break;
  }
}

async function moveLesson(courseId, idx, delta) {
  const course = courses.find(c => c.id === courseId);
  const lessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= lessons.length) return;
  [lessons[idx], lessons[newIdx]] = [lessons[newIdx], lessons[idx]];
  lessons.forEach((l, i) => l.order = i);
  try {
    await updateCourse(courseId, { lessons });
    await refreshCourses();
  } catch (err) {
    flashMessage("Lỗi: " + err.message, "error");
  }
}

/* ---------- MODALS ---------- */
function setupModals() {
  document.querySelectorAll("[data-close]").forEach(el => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active"));
    });
  });
  document.querySelectorAll(".modal-overlay").forEach(m => {
    m.addEventListener("click", (e) => {
      if (e.target === m) m.classList.remove("active");
    });
  });
  document.getElementById("btn-save-course").addEventListener("click", saveCourse);
  document.getElementById("btn-save-lesson").addEventListener("click", saveLesson);
}

function openCourseModal(course = null) {
  editingCourseId = course ? course.id : null;
  document.getElementById("modal-course-title").textContent = course ? "Sửa khóa học" : "Thêm khóa học mới";
  document.getElementById("course-title").value = course ? course.title : "";
  document.getElementById("course-level").value = course ? (course.level || "Cơ bản") : "Cơ bản";
  document.getElementById("course-order").value = course ? (course.order || 0) : (courses.length + 1);
  document.getElementById("course-desc").value = course ? (course.description || "") : "";
  document.getElementById("modal-course").classList.add("active");
}

async function saveCourse() {
  const title = document.getElementById("course-title").value.trim();
  if (!title) { flashMessage("Tên khóa học không được trống", "error"); return; }
  const data = {
    title,
    level: document.getElementById("course-level").value.trim() || "Cơ bản",
    order: parseInt(document.getElementById("course-order").value) || 0,
    description: document.getElementById("course-desc").value.trim()
  };

  try {
    if (editingCourseId) {
      await updateCourse(editingCourseId, data);
      flashMessage("Đã cập nhật khóa học", "success");
    } else {
      await createCourse({ ...data, lessons: [] });
      flashMessage("Đã tạo khóa học mới", "success");
    }
    document.getElementById("modal-course").classList.remove("active");
    await refreshCourses();
  } catch (err) {
    flashMessage("Lỗi: " + err.message, "error");
  }
}

function openLessonModal(courseId, lessonIdx) {
  editingLesson = { courseId, lessonIndex: lessonIdx };
  const course = courses.find(c => c.id === courseId);
  const lessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const lesson = lessonIdx !== null ? lessons[lessonIdx] : null;

  document.getElementById("modal-lesson-title").textContent = lesson ? "Sửa bài học" : `Thêm bài học vào "${course.title}"`;
  document.getElementById("lesson-title").value = lesson ? lesson.title : "";
  document.getElementById("lesson-drive").value = lesson ? (lesson.driveFileId || "") : "";
  document.getElementById("lesson-duration").value = lesson ? (lesson.duration || 0) : 600;
  document.getElementById("lesson-desc").value = lesson ? (lesson.description || "") : "";
  document.getElementById("modal-lesson").classList.add("active");
}

async function saveLesson() {
  const title = document.getElementById("lesson-title").value.trim();
  if (!title) { flashMessage("Tên bài học không được trống", "error"); return; }

  const driveId = document.getElementById("lesson-drive").value.trim();
  const duration = parseInt(document.getElementById("lesson-duration").value) || 0;
  const description = document.getElementById("lesson-desc").value.trim();

  const course = courses.find(c => c.id === editingLesson.courseId);
  const lessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));

  if (editingLesson.lessonIndex !== null) {
    // Sửa
    const existing = lessons[editingLesson.lessonIndex];
    lessons[editingLesson.lessonIndex] = {
      ...existing,
      title,
      driveFileId: driveId,
      duration,
      description
    };
  } else {
    // Thêm mới
    const newId = "lesson-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    lessons.push({
      id: newId,
      title,
      driveFileId: driveId,
      duration,
      description,
      order: lessons.length
    });
  }

  lessons.forEach((l, i) => l.order = i);

  try {
    await updateCourse(editingLesson.courseId, { lessons });
    flashMessage("Đã lưu bài học", "success");
    document.getElementById("modal-lesson").classList.remove("active");
    await refreshCourses();
  } catch (err) {
    flashMessage("Lỗi: " + err.message, "error");
  }
}

/* ---------- USERS ---------- */
async function loadUsers() {
  const c = document.getElementById("users-container");
  try {
    const [users, allProgress] = await Promise.all([fetchAllUsers(), fetchAllProgress()]);
    if (!users.length) {
      c.innerHTML = `<p style="color:var(--text-mute)">Chưa có user nào đăng nhập.</p>`;
      return;
    }
    const progressMap = {};
    allProgress.forEach(p => { progressMap[p.id] = p; });

    c.innerHTML = `
      <div style="overflow-x:auto">
        <table class="users-table">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Bài đã học</th>
              <th>Đăng nhập gần nhất</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => {
              const prog = progressMap[u.id];
              const completedCount = (prog && prog.completed) ? prog.completed.length : 0;
              const lastLogin = u.lastLogin ? new Date(u.lastLogin.seconds * 1000).toLocaleString("vi-VN") : "—";
              return `
                <tr>
                  <td>${escapeHtml(u.displayName || "—")}</td>
                  <td>${escapeHtml(u.email || "—")}</td>
                  <td><span class="role-badge ${u.role === "admin" ? "admin" : "user"}">${u.role || "user"}</span></td>
                  <td>${completedCount} bài</td>
                  <td>${lastLogin}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    c.innerHTML = `<p style="color:#ef4444">Lỗi: ${escapeHtml(err.message)}</p>`;
  }
}
