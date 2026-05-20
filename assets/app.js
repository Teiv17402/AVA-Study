/* ============================================
   LEARNING SITE — APP LOGIC
   Quản lý khóa học, mở khóa bài, lưu tiến độ
   ============================================ */

const STORAGE_KEY = "learning_progress_v1";
const DATA_URL = "data/courses.json";

/* ---------- Storage helpers ---------- */
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { completed: [] };
  } catch (e) {
    return { completed: [] };
  }
}

function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function isCompleted(lessonId) {
  return loadProgress().completed.includes(lessonId);
}

function markCompleted(lessonId) {
  const p = loadProgress();
  if (!p.completed.includes(lessonId)) {
    p.completed.push(lessonId);
    saveProgress(p);
  }
}

function resetProgress() {
  if (confirm("Bạn chắc chắn muốn xóa toàn bộ tiến độ học? Tất cả bài học sẽ khóa lại từ đầu.")) {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
}

/* ---------- Data fetching ---------- */
async function loadCourses() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error("Không tải được dữ liệu khóa học");
  return res.json();
}

/* ---------- Helpers ---------- */
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} giây`;
  if (s === 0) return `${m} phút`;
  return `${m}p ${s}s`;
}

function isLessonUnlocked(course, lessonIndex) {
  if (lessonIndex === 0) return true;
  const prev = course.lessons[lessonIndex - 1];
  return isCompleted(prev.id);
}

function getCourseProgress(course) {
  const total = course.lessons.length;
  const done = course.lessons.filter(l => isCompleted(l.id)).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

function getQueryParam(name) {
  const params = new URLSearchParams(location.search);
  return params.get(name);
}

/* ============================================
   HOMEPAGE RENDER
   ============================================ */
async function renderHomepage() {
  const grid = document.getElementById("course-grid");
  const titleEl = document.getElementById("site-title");
  const subtitleEl = document.getElementById("site-subtitle");

  try {
    const data = await loadCourses();

    if (titleEl) titleEl.innerHTML = `Chào mừng đến với <span class="accent">${escapeHtml(data.siteName || "Học Online")}</span>`;
    if (subtitleEl) subtitleEl.textContent = data.siteTagline || "";

    if (!data.courses || data.courses.length === 0) {
      grid.innerHTML = `<div class="empty-state"><div class="icon">📚</div><p>Chưa có khóa học nào.</p></div>`;
      return;
    }

    grid.innerHTML = data.courses.map(course => {
      const progress = getCourseProgress(course);
      return `
        <a class="course-card" href="course.html?id=${encodeURIComponent(course.id)}">
          <div class="course-thumb">▶</div>
          <div class="course-body">
            ${course.level ? `<span class="course-level">${escapeHtml(course.level)}</span>` : ""}
            <h3 class="course-title">${escapeHtml(course.title)}</h3>
            <p class="course-desc">${escapeHtml(course.description || "")}</p>
            <div class="course-meta">
              <span>📖 ${course.lessons.length} bài</span>
              <span>${progress.percent}% hoàn thành</span>
            </div>
            <div class="course-progress-bar">
              <div class="course-progress-fill" style="width:${progress.percent}%"></div>
            </div>
          </div>
        </a>
      `;
    }).join("");
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Lỗi tải dữ liệu: ${escapeHtml(err.message)}</p></div>`;
  }
}

/* ============================================
   COURSE PAGE RENDER + LOGIC
   ============================================ */
let currentCourse = null;
let currentLessonIndex = 0;
let videoTimerId = null;
let videoElapsed = 0;
let canCompleteAt = 0;

async function renderCoursePage() {
  const courseId = getQueryParam("id");
  if (!courseId) {
    document.getElementById("course-layout").innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Thiếu mã khóa học. <a href="index.html">Quay lại trang chủ</a></p></div>`;
    return;
  }

  try {
    const data = await loadCourses();
    const course = data.courses.find(c => c.id === courseId);
    if (!course) throw new Error("Không tìm thấy khóa học");
    currentCourse = course;

    // Find first unlocked lesson (or first incomplete)
    let startIdx = 0;
    for (let i = 0; i < course.lessons.length; i++) {
      if (isLessonUnlocked(course, i) && !isCompleted(course.lessons[i].id)) {
        startIdx = i;
        break;
      }
      if (i === course.lessons.length - 1) startIdx = i;
    }
    // If a hash specifies lesson
    const hashLesson = location.hash.replace("#", "");
    if (hashLesson) {
      const idx = course.lessons.findIndex(l => l.id === hashLesson);
      if (idx >= 0 && isLessonUnlocked(course, idx)) startIdx = idx;
    }

    renderSidebar();
    loadLesson(startIdx);
  } catch (err) {
    document.getElementById("course-layout").innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderSidebar() {
  const courseNameEl = document.getElementById("sidebar-course-name");
  if (courseNameEl) courseNameEl.textContent = currentCourse.title;

  const progress = getCourseProgress(currentCourse);
  document.getElementById("progress-percent").textContent = progress.percent + "%";
  document.getElementById("progress-fill").style.width = progress.percent + "%";
  document.getElementById("progress-count").textContent = `${progress.done}/${progress.total} bài`;

  const list = document.getElementById("lesson-list");
  list.innerHTML = currentCourse.lessons.map((lesson, idx) => {
    const unlocked = isLessonUnlocked(currentCourse, idx);
    const done = isCompleted(lesson.id);
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
      </li>
    `;
  }).join("");

  list.querySelectorAll(".lesson-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx);
      if (!isLessonUnlocked(currentCourse, idx)) {
        flashMessage("Bài này đang khóa. Bạn cần hoàn thành bài trước!");
        return;
      }
      loadLesson(idx);
      // Auto-close sidebar on mobile
      if (window.innerWidth <= 960) {
        document.getElementById("sidebar").classList.add("collapsed");
      }
    });
  });
}

function loadLesson(index) {
  if (!currentCourse) return;
  if (index < 0 || index >= currentCourse.lessons.length) return;
  if (!isLessonUnlocked(currentCourse, index)) return;

  currentLessonIndex = index;
  const lesson = currentCourse.lessons[index];
  location.hash = lesson.id;

  // Update video
  const videoWrap = document.getElementById("video-wrap");
  if (lesson.driveFileId && lesson.driveFileId !== "REPLACE_WITH_GOOGLE_DRIVE_FILE_ID") {
    videoWrap.innerHTML = `<iframe src="https://drive.google.com/file/d/${encodeURIComponent(lesson.driveFileId)}/preview" allow="autoplay" allowfullscreen></iframe>`;
  } else {
    videoWrap.innerHTML = `
      <div class="video-placeholder">
        <div class="icon">▶</div>
        <div><strong>Video chưa được cấu hình</strong></div>
        <div style="font-size:13px">Hãy thêm Google Drive File ID vào <code>data/courses.json</code></div>
      </div>
    `;
  }

  // Update lesson info
  document.getElementById("lesson-title-big").textContent = lesson.title;
  document.getElementById("lesson-description").textContent = lesson.description || "";

  // Badge
  const badge = document.getElementById("lesson-badge");
  if (isCompleted(lesson.id)) {
    badge.textContent = "✓ Đã hoàn thành";
    badge.classList.add("done");
  } else {
    badge.textContent = "● Đang học";
    badge.classList.remove("done");
  }

  // Reset timer state
  if (videoTimerId) clearInterval(videoTimerId);
  videoElapsed = 0;
  // Cho phép bấm hoàn thành sau khi xem 80% thời lượng video
  canCompleteAt = Math.max(10, Math.floor((lesson.duration || 60) * 0.8));
  updateTimerUI();
  videoTimerId = setInterval(() => {
    videoElapsed++;
    updateTimerUI();
  }, 1000);

  // Update nav buttons
  document.getElementById("btn-prev").disabled = (index === 0);
  const nextLesson = currentCourse.lessons[index + 1];
  document.getElementById("btn-next").disabled = !nextLesson || !isCompleted(lesson.id);

  renderSidebar();
}

function updateTimerUI() {
  const lesson = currentCourse.lessons[currentLessonIndex];
  const completed = isCompleted(lesson.id);
  const timerEl = document.getElementById("timer-info");
  const btnDone = document.getElementById("btn-done");

  if (completed) {
    timerEl.classList.add("ready");
    timerEl.innerHTML = `<span class="timer-icon">✓</span><span>Bạn đã hoàn thành bài học này. Có thể chuyển sang bài tiếp theo!</span>`;
    btnDone.disabled = false;
    btnDone.textContent = "✓ Đã hoàn thành";
    return;
  }

  const ready = videoElapsed >= canCompleteAt;
  if (ready) {
    timerEl.classList.add("ready");
    timerEl.innerHTML = `<span class="timer-icon">🎉</span><span>Bạn đã xem đủ thời lượng. Bấm "Hoàn thành bài" để mở bài tiếp theo!</span>`;
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

function completeCurrentLesson() {
  const lesson = currentCourse.lessons[currentLessonIndex];
  if (videoElapsed < canCompleteAt && !isCompleted(lesson.id)) {
    flashMessage("Bạn cần xem đủ thời lượng video trước!");
    return;
  }
  markCompleted(lesson.id);
  updateTimerUI();
  renderSidebar();

  // Auto move to next lesson
  const nextIdx = currentLessonIndex + 1;
  if (nextIdx < currentCourse.lessons.length) {
    flashMessage("✓ Đã hoàn thành! Chuyển sang bài tiếp theo...");
    setTimeout(() => loadLesson(nextIdx), 800);
  } else {
    flashMessage("🎉 Chúc mừng! Bạn đã hoàn thành toàn bộ khóa học!");
  }
}

function gotoPrev() {
  if (currentLessonIndex > 0) loadLesson(currentLessonIndex - 1);
}

function gotoNext() {
  const next = currentLessonIndex + 1;
  if (next < currentCourse.lessons.length && isLessonUnlocked(currentCourse, next)) {
    loadLesson(next);
  }
}

/* ---------- Utility ---------- */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function flashMessage(text) {
  let el = document.getElementById("flash-message");
  if (!el) {
    el = document.createElement("div");
    el.id = "flash-message";
    el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#ffd60a;color:#000;padding:14px 22px;border-radius:8px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:9999;max-width:90%;text-align:center;";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = "none"; }, 2500);
}

/* ---------- Mobile sidebar toggle ---------- */
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "home") renderHomepage();
  if (page === "course") renderCoursePage();

  const btnReset = document.getElementById("btn-reset");
  if (btnReset) btnReset.addEventListener("click", resetProgress);

  const btnPrev = document.getElementById("btn-prev");
  if (btnPrev) btnPrev.addEventListener("click", gotoPrev);

  const btnNext = document.getElementById("btn-next");
  if (btnNext) btnNext.addEventListener("click", gotoNext);

  const btnDone = document.getElementById("btn-done");
  if (btnDone) btnDone.addEventListener("click", completeCurrentLesson);

  const btnMobile = document.getElementById("mobile-toggle");
  if (btnMobile) btnMobile.addEventListener("click", toggleSidebar);
});
