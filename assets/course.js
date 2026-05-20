// ============================================
// COURSE PAGE — sidebar + video + lesson logic
// ============================================
import {
  requireAuth,
  fetchCourse,
  fetchUserProgress,
  markLessonCompleted,
  resetUserProgress
} from "./firebase.js";
import {
  escapeHtml,
  formatDuration,
  getCourseProgress,
  isLessonUnlocked,
  flashMessage,
  renderHeader
} from "./app.js";

let currentUser = null;
let currentCourse = null;
let currentLessons = [];
let completedIds = [];
let currentLessonIndex = 0;
let videoTimerId = null;
let videoElapsed = 0;
let canCompleteAt = 0;

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
        <p>Thiếu mã khóa học. <a href="index.html">Quay lại trang chủ</a></p>
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
          <p>Không tìm thấy khóa học. <a href="index.html">Quay lại</a></p>
        </div>`;
      return;
    }

    currentCourse = course;
    currentLessons = (course.lessons || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    completedIds = progress.completed || [];

    if (!currentLessons.length) {
      document.querySelector(".main-content").innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <p>Khóa học này chưa có bài học nào.</p>
          <p><a href="index.html">Quay lại</a></p>
        </div>`;
      document.getElementById("sidebar").style.display = "none";
      return;
    }

    // Pick lesson to start
    let startIdx = currentLessons.length - 1;
    for (let i = 0; i < currentLessons.length; i++) {
      const unlocked = isLessonUnlocked(currentLessons, i, completedIds);
      const done = completedIds.includes(currentLessons[i].id);
      if (unlocked && !done) { startIdx = i; break; }
    }
    const hashId = location.hash.replace("#", "");
    if (hashId) {
      const idx = currentLessons.findIndex(l => l.id === hashId);
      if (idx >= 0 && isLessonUnlocked(currentLessons, idx, completedIds)) startIdx = idx;
    }

    setupButtons();
    renderSidebar();
    loadLesson(startIdx);
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

  const prog = getCourseProgress(currentLessons, completedIds);
  document.getElementById("progress-percent").textContent = prog.percent + "%";
  document.getElementById("progress-fill").style.width = prog.percent + "%";
  document.getElementById("progress-count").textContent = `${prog.done}/${prog.total} bài`;

  const list = document.getElementById("lesson-list");
  list.innerHTML = currentLessons.map((lesson, idx) => {
    const unlocked = isLessonUnlocked(currentLessons, idx, completedIds);
    const done = completedIds.includes(lesson.id);
    const active = idx === currentLessonIndex;
    const cls = [
      "lesson-item",
      !unlocked ? "locked" : "",
      done ? "completed" : "",
      active ? "active" : ""
    ].filter(Boolean).join(" ");
    const icon = !unlocked ? "🔒" : (done ? "✓" : (idx + 1));

    return `
      <li class="${cls}" data-idx="${idx}">
        <div class="lesson-status">${icon}</div>
        <div class="lesson-info">
          <div class="lesson-name">${escapeHtml(lesson.title)}</div>
          <div class="lesson-duration">${formatDuration(lesson.duration || 0)}</div>
        </div>
      </li>`;
  }).join("");

  list.querySelectorAll(".lesson-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx);
      if (!isLessonUnlocked(currentLessons, idx, completedIds)) {
        flashMessage("Bài này đang khóa. Hoàn thành bài trước để mở!", "error");
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
  if (!isLessonUnlocked(currentLessons, index, completedIds)) return;

  currentLessonIndex = index;
  const lesson = currentLessons[index];
  history.replaceState(null, "", `#${lesson.id}`);

  // Video
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
  if (completedIds.includes(lesson.id)) {
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
  document.getElementById("btn-next").disabled = !nextLesson || !completedIds.includes(lesson.id);

  renderSidebar();
}

function updateTimerUI() {
  const lesson = currentLessons[currentLessonIndex];
  const done = completedIds.includes(lesson.id);
  const timerEl = document.getElementById("timer-info");
  const btnDone = document.getElementById("btn-done");

  if (done) {
    timerEl.classList.add("ready");
    timerEl.innerHTML = `<span class="timer-icon">✓</span><span>Bạn đã hoàn thành bài này. Chuyển sang bài tiếp theo!</span>`;
    btnDone.disabled = false;
    btnDone.textContent = "✓ Đã hoàn thành";
    return;
  }
  const ready = videoElapsed >= canCompleteAt;
  if (ready) {
    timerEl.classList.add("ready");
    timerEl.innerHTML = `<span class="timer-icon">🎉</span><span>Đã đủ thời lượng. Bấm "Hoàn thành bài" để mở bài tiếp theo!</span>`;
    btnDone.disabled = false;
    btnDone.textContent = "Hoàn thành bài học";
  } else {
    timerEl.classList.remove("ready");
    const remaining = canCompleteAt - videoElapsed;
    timerEl.innerHTML = `<span class="timer-icon">⏱</span><span>Xem video để mở khóa nút hoàn thành (còn ${formatDuration(remaining)})</span>`;
    btnDone.disabled = true;
    btnDone.textContent = "Hoàn thành bài học";
  }
}

async function completeCurrentLesson() {
  const lesson = currentLessons[currentLessonIndex];
  if (completedIds.includes(lesson.id)) {
    // Đã xong rồi, chuyển sang bài kế
    const nextIdx = currentLessonIndex + 1;
    if (nextIdx < currentLessons.length) loadLesson(nextIdx);
    return;
  }
  if (videoElapsed < canCompleteAt) {
    flashMessage("Bạn cần xem đủ thời lượng video trước!", "error");
    return;
  }

  try {
    completedIds = await markLessonCompleted(currentUser.uid, lesson.id);
    updateTimerUI();
    renderSidebar();

    const nextIdx = currentLessonIndex + 1;
    if (nextIdx < currentLessons.length) {
      flashMessage("✓ Đã hoàn thành! Chuyển sang bài tiếp...", "success");
      setTimeout(() => loadLesson(nextIdx), 900);
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
  if (next < currentLessons.length && isLessonUnlocked(currentLessons, next, completedIds)) {
    loadLesson(next);
  }
}
