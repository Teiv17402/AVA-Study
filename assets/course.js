// ============================================
// COURSE PAGE — sidebar + video + 24h lock logic
// ============================================
import {
  requireAuth,
  fetchCourse,
  fetchUserProgress,
  markLessonCompleted,
  ensureFirstUnlock,
  resetUserProgress,
  isAdmin
} from "./firebase.js";
import {
  escapeHtml,
  formatDuration,
  getCourseProgress,
  isLessonUnlocked,
  getLessonStatus,
  getRemainingMs,
  formatRemaining,
  flashMessage,
  renderHeader
} from "./app.js";

let currentUser = null;
let currentCourse = null;
let currentLessons = [];
let userProgress = { completed: [], unlockedAt: {} };
let currentLessonIndex = 0;
let videoTimerId = null;
let videoElapsed = 0;
let canCompleteAt = 0;
let sidebarTickId = null;

export async function initCoursePage() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  renderHeader(currentUser);

  const params = new URLSearchParams(location.search);
  const courseId = params.get("id");

  if (!courseId) {
    document.getElementById("course-layout").innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>Thiếu mã khóa học. <a href="home.html">Quay lại trang chủ</a></p>
      </div>`;
    return;
  }

  try {
    const [course, progress] = await Promise.all([
      fetchCourse(courseId),
      fetchUserProgress(currentUser.uid)
    ]);

    if (!course) {
      document.getElementById("course-layout").innerHTML = `
        <div class="empty-state">
          <div class="icon">⚠️</div>
          <p>Không tìm thấy khóa học. <a href="home.html">Quay lại</a></p>
        </div>`;
      return;
    }

    currentCourse = course;
    currentLessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    userProgress = progress;

    if (!currentLessons.length) {
      document.querySelector(".main-content").innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <p>Khóa học này chưa có bài học nào.</p>
          <p><a href="home.html">Quay lại</a></p>
        </div>`;
      document.getElementById("sidebar").style.display = "none";
      return;
    }

    if (!isAdmin(currentUser)) {
      const firstId = currentLessons[0].id;
      const updated = await ensureFirstUnlock(currentUser.uid, firstId);
      if (updated) userProgress = updated;
    }

    let startIdx = currentLessons.length - 1;
    for (let i = 0; i < currentLessons.length; i++) {
      const status = getLessonStatus(currentLessons, i, userProgress);
      if (status === 'available') { startIdx = i; break; }
    }
    const hashId = location.hash.replace("#", "");
    if (hashId) {
      const idx = currentLessons.findIndex(l => l.id === hashId);
      if (idx >= 0) {
        const status = getLessonStatus(currentLessons, idx, userProgress);
        if (status === 'completed' || status === 'available') startIdx = idx;
      }
    }

    setupButtons();
    renderSidebar();
    loadLesson(startIdx);

    sidebarTickId = setInterval(renderSidebar, 60 * 1000);
  } catch (err) {
    console.error(err);
    document.getElementById("course-layout").innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>Lỗi: ${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function setupButtons() {
  document.getElementById("btn-prev").addEventListener("click", gotoPrev);
  document.getElementById("btn-next").addEventListener("click", gotoNext);
  document.getElementById("btn-done").addEventListener("click", completeCurrentLesson);
  document.getElementById("mobile-toggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
  });
}

function renderSidebar() {
  document.getElementById("sidebar-course-name").textContent = currentCourse.title;

  const completed = userProgress.completed || [];
  const prog = getCourseProgress(currentLessons, completed);
  document.getElementById("progress-percent").textContent = prog.percent + "%";
  document.getElementById("progress-fill").style.width = prog.percent + "%";
  document.getElementById("progress-count").textContent = `${prog.done}/${prog.total} bài`;

  const list = document.getElementById("lesson-list");
  list.innerHTML = currentLessons.map((lesson, idx) => {
    const status = getLessonStatus(currentLessons, idx, userProgress);
    const active = idx === currentLessonIndex;

    let cls = "lesson-item";
    let icon = (idx + 1);
    let extra = "";

    if (status === 'completed') { cls += " completed"; icon = "✓"; }
    else if (status === 'locked-prerequisite') { cls += " locked"; icon = "🔒"; }
    else if (status === 'locked-expired') { cls += " expired"; icon = "⌛"; }
    else if (status === 'available') {
      const ms = getRemainingMs(lesson.id, userProgress);
      if (ms != null && !isAdmin(currentUser)) {
        const urgent = ms < 60 * 60 * 1000;
        extra = `<span class="lesson-countdown${urgent ? ' urgent' : ''}">${formatRemaining(ms)}</span>`;
      }
    }
    if (status === 'locked-expired') {
      extra = `<span class="lesson-expired-tag">Hết hạn</span>`;
    }
    if (active) cls += " active";

    return `
      <li class="${cls}" data-idx="${idx}">
        <div class="lesson-status">${icon}</div>
        <div class="lesson-info">
          <div class="lesson-name">${escapeHtml(lesson.title)}${extra}</div>
          <div class="lesson-duration">${formatDuration(lesson.duration || 0)}</div>
        </div>
      </li>`;
  }).join("");

  list.querySelectorAll(".lesson-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx);
      const status = getLessonStatus(currentLessons, idx, userProgress);
      if (status === 'locked-prerequisite') {
        flashMessage("Bài này đang khóa. Hoàn thành bài trước để mở!", "error");
        return;
      }
      if (status === 'locked-expired') {
        flashMessage("Bài này đã hết hạn 24h. Liên hệ admin để mở lại!", "error");
        return;
      }
      loadLesson(idx);
      if (window.innerWidth <= 960) {
        document.getElementById("sidebar").classList.add("collapsed");
      }
    });
  });
}

function loadLesson(index) {
  if (index < 0 || index >= currentLessons.length) return;
  const status = getLessonStatus(currentLessons, index, userProgress);

  if (!isAdmin(currentUser)) {
    if (status === 'locked-prerequisite') return;
    if (status === 'locked-expired') {
      currentLessonIndex = index;
      const lesson = currentLessons[index];
      history.replaceState(null, "", `#${lesson.id}`);
      renderExpiredNotice(lesson);
      renderSidebar();
      return;
    }
  }

  currentLessonIndex = index;
  const lesson = currentLessons[index];
  history.replaceState(null, "", `#${lesson.id}`);

  const videoWrap = document.getElementById("video-wrap");
  if (lesson.driveFileId && lesson.driveFileId !== "REPLACE_WITH_GOOGLE_DRIVE_FILE_ID" && lesson.driveFileId.trim()) {
    videoWrap.innerHTML = `<iframe src="https://drive.google.com/file/d/${encodeURIComponent(lesson.driveFileId)}/preview" allow="autoplay" allowfullscreen></iframe>`;
  } else {
    videoWrap.innerHTML = `
      <div class="video-placeholder">
        <div class="icon">▶</div>
        <div><strong>Video chưa được cấu hình</strong></div>
        <div style="font-size:13px">Admin cần thêm Google Drive File ID vào bài học này</div>
      </div>`;
  }

  document.getElementById("lesson-title-big").textContent = lesson.title;
  document.getElementById("lesson-description").textContent = lesson.description || "";

  const badge = document.getElementById("lesson-badge");
  const completed = userProgress.completed || [];
  if (completed.includes(lesson.id)) {
    badge.textContent = "✓ Đã hoàn thành";
    badge.classList.add("done");
  } else {
    badge.textContent = "● Đang học";
    badge.classList.remove("done");
  }

  if (videoTimerId) clearInterval(videoTimerId);
  videoElapsed = 0;
  canCompleteAt = Math.max(10, Math.floor((lesson.duration || 60) * 0.8));
  updateTimerUI();
  videoTimerId = setInterval(() => {
    videoElapsed++;
    updateTimerUI();
  }, 1000);

  document.getElementById("btn-prev").disabled = (index === 0);
  const nextLesson = currentLessons[index + 1];
  document.getElementById("btn-next").disabled = !nextLesson || !completed.includes(lesson.id);

  renderSidebar();
}

function renderExpiredNotice(lesson) {
  const videoWrap = document.getElementById("video-wrap");
  videoWrap.innerHTML = `
    <div class="video-placeholder">
      <div class="icon" style="color:var(--danger)">⌛</div>
      <div><strong>Bài học đã hết hạn 24h</strong></div>
    </div>`;
  document.getElementById("lesson-title-big").textContent = lesson.title;
  document.getElementById("lesson-description").innerHTML = `
    <div class="expired-notice">
      <div class="icon">⌛</div>
      <h3>Bài học đã bị khóa</h3>
      <p>Bạn không hoàn thành bài này trong 24h kể từ lúc được mở. Hệ thống đã tự động khóa.</p>
      <p>Vui lòng liên hệ admin để được mở lại nếu cần thiết.</p>
    </div>`;
  const badge = document.getElementById("lesson-badge");
  badge.textContent = "⌛ Hết hạn";
  badge.classList.remove("done");
  document.getElementById("timer-info").innerHTML = `<span class="timer-icon">⌛</span><span>Bài này đã hết hạn — không thể hoàn thành nữa</span>`;
  document.getElementById("btn-done").disabled = true;
  document.getElementById("btn-done").textContent = "Bài đã khóa";
  document.getElementById("btn-prev").disabled = (currentLessonIndex === 0);
  document.getElementById("btn-next").disabled = true;
  if (videoTimerId) clearInterval(videoTimerId);
}

const MANUAL_OVERRIDE_AFTER = 30;

function updateTimerUI() {
  const lesson = currentLessons[currentLessonIndex];
  const completed = userProgress.completed || [];
  const done = completed.includes(lesson.id);
  const timerEl = document.getElementById("timer-info");
  const btnDone = document.getElementById("btn-done");
  const admin = isAdmin(currentUser);

  if (done) {
    timerEl.classList.add("ready");
    timerEl.innerHTML = `<span class="timer-icon">✓</span><span>Bạn đã hoàn thành bài này. Chuyển sang bài tiếp theo!</span>`;
    btnDone.disabled = false;
    btnDone.textContent = "✓ Đã hoàn thành";
    return;
  }

  if (admin) {
    timerEl.classList.add("ready");
    timerEl.innerHTML = `<span class="timer-icon">👑</span><span>Bạn là admin — có thể hoàn thành bài bất cứ lúc nào</span>`;
    btnDone.disabled = false;
    btnDone.textContent = "Hoàn thành bài học";
    return;
  }

  const ms = getRemainingMs(lesson.id, userProgress);
  const expiryWarning = (ms != null && ms < 24 * 60 * 60 * 1000)
    ? `<div style="margin-top:6px;font-size:12px;color:var(--accent)">⏱ Còn ${formatRemaining(ms)} trước khi bài này tự động khóa</div>`
    : "";

  const ready = videoElapsed >= canCompleteAt;
  if (ready) {
    timerEl.classList.add("ready");
    timerEl.innerHTML = `<span class="timer-icon">🎉</span><span>Đã đủ thời lượng. Bấm "Hoàn thành bài" để mở bài tiếp theo!${expiryWarning}</span>`;
    btnDone.disabled = false;
    btnDone.textContent = "Hoàn thành bài học";
    return;
  }

  timerEl.classList.remove("ready");
  const remaining = canCompleteAt - videoElapsed;
  const showManualOverride = videoElapsed >= MANUAL_OVERRIDE_AFTER;
  const overrideHtml = showManualOverride
    ? `<div style="margin-top:8px;font-size:13px"><a href="#" id="link-manual-done" style="color:var(--accent);text-decoration:underline">Đã tua đến cuối video? Bấm vào đây để hoàn thành</a></div>`
    : "";
  timerEl.innerHTML = `
    <span class="timer-icon">⏱</span>
    <span>
      Xem video để mở khóa nút hoàn thành (còn ${formatDuration(remaining)})
      ${overrideHtml}
      ${expiryWarning}
    </span>
  `;
  btnDone.disabled = true;
  btnDone.textContent = "Hoàn thành bài học";

  const linkManual = document.getElementById("link-manual-done");
  if (linkManual) {
    linkManual.addEventListener("click", async (e) => {
      e.preventDefault();
      if (confirm("Bạn đã xem hết hoặc tua đến cuối video chưa?\n\nBấm OK để đánh dấu hoàn thành bài học này.")) {
        await completeCurrentLesson(true);
      }
    });
  }
}

async function completeCurrentLesson(forceOverride = false) {
  const lesson = currentLessons[currentLessonIndex];
  const completed = userProgress.completed || [];
  if (completed.includes(lesson.id)) {
    const nextIdx = currentLessonIndex + 1;
    if (nextIdx < currentLessons.length) loadLesson(nextIdx);
    return;
  }

  const admin = isAdmin(currentUser);
  const enoughTime = videoElapsed >= canCompleteAt;

  if (!admin && !enoughTime && !forceOverride) {
    flashMessage("Bạn cần xem đủ thời lượng video trước!", "error");
    return;
  }

  try {
    const nextLesson = currentLessons[currentLessonIndex + 1];
    const nextId = nextLesson ? nextLesson.id : null;
    const result = await markLessonCompleted(currentUser.uid, lesson.id, nextId);
    userProgress.completed = result.completed;
    userProgress.unlockedAt = result.unlockedAt;
    updateTimerUI();
    renderSidebar();

    const nextIdx = currentLessonIndex + 1;
    if (nextIdx < currentLessons.length) {
      flashMessage("✓ Đã hoàn thành! Bài kế tiếp đã mở khóa, có 24h để hoàn thành.", "success");
      setTimeout(() => loadLesson(nextIdx), 1100);
    } else {
      flashMessage("🎉 Chúc mừng! Bạn đã hoàn thành khóa học!", "success");
    }
  } catch (err) {
    flashMessage("Lỗi lưu tiến độ: " + err.message, "error");
  }
}

function gotoPrev() {
  if (currentLessonIndex > 0) loadLesson(currentLessonIndex - 1);
}
function gotoNext() {
  const next = currentLessonIndex + 1;
  if (next < currentLessons.length) {
    const status = getLessonStatus(currentLessons, next, userProgress);
    if (status === 'available' || status === 'completed' || isAdmin(currentUser)) {
      loadLesson(next);
    }
  }
}
