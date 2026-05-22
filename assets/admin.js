// ============================================
// ADMIN PAGE — quản lý khóa học, bài học, user, payments
// ============================================
import {
  requireAdmin,
  fetchCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  fetchAllUsers,
  fetchAllProgress,
  adminResetLessonTimer,
  fetchPendingPayments,
  approvePayment,
  rejectPayment,
  BANK_CONFIG
} from "./firebase.js";
import {
  escapeHtml,
  formatDuration,
  formatVnd,
  flashMessage,
  renderHeader,
  getLessonStatus
} from "./app.js";

let currentUser = null;
let courses = [];
let editingCourseId = null;
let editingLesson = null;

export async function initAdminPage() {
  currentUser = await requireAdmin();
  if (!currentUser) return;
  renderHeader(currentUser);

  setupTabs();
  setupModals();
  await refreshCourses();
}

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
          ? `<p style="color:var(--text-mute);font-style:italic">Chưa có bài học nào.</p>`
          : lessons.map((lesson, idx) => `
              <div class="admin-lesson-row">
                <div class="num">${idx + 1}</div>
                <div class="admin-lesson-info">
                  <div class="name">${escapeHtml(lesson.title)} ${lesson.isVip ? `<span class="lesson-vip-tag">👑 VIP ${formatVnd(lesson.price || BANK_CONFIG.defaultPrice)}</span>` : ""}</div>
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
  const vipCheckbox = document.getElementById("lesson-is-vip");
  const priceInput = document.getElementById("lesson-price");
  if (vipCheckbox) vipCheckbox.checked = !!(lesson && lesson.isVip);
  if (priceInput) priceInput.value = (lesson && lesson.price) ? lesson.price : "";
  document.getElementById("modal-lesson").classList.add("active");
}

async function saveLesson() {
  const title = document.getElementById("lesson-title").value.trim();
  if (!title) { flashMessage("Tên bài học không được trống", "error"); return; }

  const driveId = document.getElementById("lesson-drive").value.trim();
  const duration = parseInt(document.getElementById("lesson-duration").value) || 0;
  const description = document.getElementById("lesson-desc").value.trim();
  const isVip = !!document.getElementById("lesson-is-vip")?.checked;
  const priceVal = parseInt(document.getElementById("lesson-price")?.value);
  const price = (isVip && priceVal > 0) ? priceVal : (isVip ? BANK_CONFIG.defaultPrice : 0);

  const course = courses.find(c => c.id === editingLesson.courseId);
  const lessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));

  if (editingLesson.lessonIndex !== null) {
    const existing = lessons[editingLesson.lessonIndex];
    lessons[editingLesson.lessonIndex] = {
      ...existing,
      title, driveFileId: driveId, duration, description, isVip, price
    };
  } else {
    const newId = "lesson-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    lessons.push({
      id: newId, title, driveFileId: driveId, duration, description,
      isVip, price, order: lessons.length
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

async function loadUsers() {
  const c = document.getElementById("users-container");
  try {
    const [users, allProgress, payments] = await Promise.all([
      fetchAllUsers(),
      fetchAllProgress(),
      fetchPendingPayments()
    ]);

    if (!users.length) {
      c.innerHTML = `<p style="color:var(--text-mute)">Chưa có user nào đăng nhập.</p>`;
      return;
    }
    const progressMap = {};
    allProgress.forEach(p => { progressMap[p.id] = p; });

    if (!courses.length) {
      try { courses = await fetchCourses(); } catch (e) {}
    }

    const lockedItems = computeLockedItems(users, progressMap);

    c.innerHTML = `
      <div style="overflow-x:auto">
        <table class="users-table">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Bài đã học</th>
              <th>Bài VIP đã mua</th>
              <th>Bài hết hạn</th>
              <th>Đăng nhập gần nhất</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => {
              const prog = progressMap[u.id];
              const completedCount = (prog && prog.completed) ? prog.completed.length : 0;
              const paidCount = (prog && prog.paidLessons) ? prog.paidLessons.length : 0;
              const lockedCount = (lockedItems.byUser[u.id] || []).length;
              const lastLogin = u.lastLogin ? new Date(u.lastLogin.seconds * 1000).toLocaleString("vi-VN") : "—";
              return `
                <tr>
                  <td>${escapeHtml(u.displayName || "—")}</td>
                  <td>${escapeHtml(u.email || "—")}</td>
                  <td><span class="role-badge ${u.role === "admin" ? "admin" : "user"}">${u.role || "user"}</span></td>
                  <td>${completedCount} bài</td>
                  <td>${paidCount > 0 ? `<span style="color:var(--accent);font-weight:600">${paidCount} bài</span>` : "—"}</td>
                  <td>${lockedCount > 0 ? `<span style="color:var(--danger);font-weight:600">${lockedCount} hết hạn</span>` : "—"}</td>
                  <td>${lastLogin}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>

      <div class="admin-card" style="margin-top:24px">
        <div class="admin-card-header">
          <h2 class="admin-card-title">💳 Thanh toán chờ duyệt ${payments.length > 0 ? `<span class="payment-count">${payments.length}</span>` : ""}</h2>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-payments">Làm mới</button>
        </div>
        <div id="payments-list">
          ${payments.length === 0
            ? `<p style="color:var(--text-mute);font-style:italic">Không có yêu cầu thanh toán nào.</p>`
            : payments.map(p => {
                const created = p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleString("vi-VN") : "—";
                return `
                  <div class="payment-row-admin">
                    <div class="info">
                      <div class="name">
                        ${escapeHtml(p.userEmail || "—")}
                        <span class="payment-amount">${formatVnd(p.amount)}</span>
                      </div>
                      <div class="meta">
                        Khóa: <strong>${escapeHtml(p.courseTitle || "—")}</strong> · Bài: <strong>${escapeHtml(p.lessonTitle || "—")}</strong>
                      </div>
                      <div class="meta payment-content">
                        Nội dung CK: <code>${escapeHtml(p.transferContent)}</code> · ${created}
                      </div>
                    </div>
                    <div class="payment-actions">
                      <button class="btn btn-primary btn-sm" data-payment-action="approve"
                        data-pid="${escapeHtml(p.id)}"
                        data-uid="${escapeHtml(p.userId)}"
                        data-lesson="${escapeHtml(p.lessonId)}">✓ Duyệt</button>
                      <button class="btn btn-danger btn-sm" data-payment-action="reject"
                        data-pid="${escapeHtml(p.id)}">✗ Từ chối</button>
                    </div>
                  </div>
                `;
              }).join("")}
        </div>
      </div>

      <div class="admin-card" style="margin-top:24px">
        <div class="admin-card-header">
          <h2 class="admin-card-title">⌛ Bài đang chờ mở khóa (quá 24h)</h2>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-locked">Làm mới</button>
        </div>
        <div id="locked-list">
          ${lockedItems.flat.length === 0
            ? `<p style="color:var(--text-mute);font-style:italic">Không có user nào đang bị khóa bài.</p>`
            : lockedItems.flat.map(item => `
                <div class="admin-locked-row" data-uid="${escapeHtml(item.userId)}" data-lesson="${escapeHtml(item.lessonId)}">
                  <div class="info">
                    <div class="name">${escapeHtml(item.userName)} <span style="color:var(--text-mute);font-weight:400">(${escapeHtml(item.userEmail)})</span></div>
                    <div class="meta">Khóa: <strong>${escapeHtml(item.courseTitle)}</strong> — Bài: <strong>${escapeHtml(item.lessonTitle)}</strong> · Hết hạn từ ${item.expiredAgo}</div>
                  </div>
                  <button class="btn btn-primary btn-sm" data-action="unlock-lesson"
                    data-uid="${escapeHtml(item.userId)}"
                    data-lesson="${escapeHtml(item.lessonId)}">🔓 Mở lại 24h</button>
                </div>
              `).join("")}
        </div>
      </div>
    `;

    // Bind payment buttons
    c.querySelectorAll('[data-payment-action]').forEach(btn => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.paymentAction;
        const pid = btn.dataset.pid;
        const uid = btn.dataset.uid;
        const lessonId = btn.dataset.lesson;
        btn.disabled = true;
        btn.textContent = "Đang xử lý...";
        try {
          if (action === "approve") {
            await approvePayment(pid, uid, lessonId, currentUser.uid);
            flashMessage("✓ Đã duyệt! User có thể xem bài VIP.", "success");
          } else {
            await rejectPayment(pid, currentUser.uid);
            flashMessage("Đã từ chối thanh toán.", "info");
          }
          await loadUsers();
        } catch (err) {
          flashMessage("Lỗi: " + err.message, "error");
          btn.disabled = false;
          btn.textContent = action === "approve" ? "✓ Duyệt" : "✗ Từ chối";
        }
      });
    });

    // Bind unlock buttons
    c.querySelectorAll('[data-action="unlock-lesson"]').forEach(btn => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.uid;
        const lessonId = btn.dataset.lesson;
        btn.disabled = true;
        btn.textContent = "Đang mở...";
        try {
          await adminResetLessonTimer(uid, lessonId);
          flashMessage("✓ Đã mở lại bài. User có thêm 24h.", "success");
          await loadUsers();
        } catch (err) {
          flashMessage("Lỗi: " + err.message, "error");
          btn.disabled = false;
          btn.textContent = "🔓 Mở lại 24h";
        }
      });
    });

    const refreshPayBtn = document.getElementById("btn-refresh-payments");
    if (refreshPayBtn) refreshPayBtn.addEventListener("click", loadUsers);
    const refreshLockBtn = document.getElementById("btn-refresh-locked");
    if (refreshLockBtn) refreshLockBtn.addEventListener("click", loadUsers);

  } catch (err) {
    c.innerHTML = `<p style="color:#ef4444">Lỗi: ${escapeHtml(err.message)}</p>`;
  }
}

function computeLockedItems(users, progressMap) {
  const byUser = {};
  const flat = [];

  users.forEach(u => {
    if (u.role === "admin") return;
    const prog = progressMap[u.id];
    if (!prog) return;
    const unlockedAt = prog.unlockedAt || {};

    courses.forEach(course => {
      const lessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      lessons.forEach((lesson, idx) => {
        const status = getLessonStatus(lessons, idx, prog);
        if (status !== 'locked-expired') return;

        const unlockTime = unlockedAt[lesson.id];
        const expiredAgo = unlockTime ? formatExpiredAgo(unlockTime) : "không rõ";

        const item = {
          userId: u.id,
          userName: u.displayName || u.email || "—",
          userEmail: u.email || "",
          courseTitle: course.title || "—",
          lessonTitle: lesson.title || "—",
          lessonId: lesson.id,
          expiredAgo
        };
        if (!byUser[u.id]) byUser[u.id] = [];
        byUser[u.id].push(item);
        flat.push(item);
      });
    });
  });

  return { byUser, flat };
}

function formatExpiredAgo(unlockTime) {
  const EXPIRY = 24 * 60 * 60 * 1000;
  const expiredAt = unlockTime + EXPIRY;
  const ago = Date.now() - expiredAt;
  if (ago < 0) return "vừa nãy";
  const days = Math.floor(ago / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ago % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days} ngày${hours > 0 ? ` ${hours}h` : ""} trước`;
  return `${hours}h trước`;
}
