// ============================================
// MY COURSES PAGE — Phase B
// ============================================
import {
  requireAuth,
  fetchCourses,
  fetchUserProgress,
  categorizeMyCourses
} from "./firebase.js";
import {
  escapeHtml,
  renderHeader,
  flashMessage
} from "./app.js";

let GROUPS = { ongoing: [], done: [], vipBought: [] };

export async function initMyCoursesPage() {
  const user = await requireAuth();
  if (!user) return;
  renderHeader(user);

  const subtitle = document.getElementById('my-courses-subtitle');
  const grid = document.getElementById('my-courses-grid');

  try {
    const [courses, progress] = await Promise.all([
      fetchCourses(), fetchUserProgress(user.uid)
    ]);

    GROUPS = categorizeMyCourses(courses, progress);

    document.getElementById('count-ongoing').textContent = GROUPS.ongoing.length;
    document.getElementById('count-vip').textContent     = GROUPS.vipBought.length;
    document.getElementById('count-done').textContent    = GROUPS.done.length;

    const total = GROUPS.ongoing.length + GROUPS.done.length + GROUPS.vipBought.length;
    subtitle.textContent = total > 0
      ? `Bạn có ${total} khóa học trong tài khoản`
      : 'Bạn chưa bắt đầu khóa nào — khám phá khóa học bên dưới';

    bindTabs();
    renderGroup('ongoing');

    if (total === 0) {
      document.getElementById('cta-explore').style.display = 'block';
    }
  } catch (err) {
    console.error(err);
    grid.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠</div>
        <p>Lỗi tải khóa học: ${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function bindTabs() {
  const tabs = document.querySelectorAll('.mc-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      renderGroup(tab.dataset.filter);
    });
  });
}

function renderGroup(filter) {
  const grid = document.getElementById('my-courses-grid');
  const items = GROUPS[filter] || [];
  if (!items.length) {
    const labels = {
      ongoing: 'Bạn chưa bắt đầu khóa nào. Vào "Khám phá" để chọn khóa đầu tiên.',
      done:    'Chưa có khóa nào hoàn thành. Tiếp tục học để mở thành tích!',
      vipBought: 'Bạn chưa mua khóa VIP nào.'
    };
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="icon">📚</div>
        <p>${escapeHtml(labels[filter] || 'Trống')}</p>
        <a href="home.html" class="btn btn-secondary btn-sm" style="margin-top:14px">Khám phá khóa học →</a>
      </div>`;
    return;
  }
  grid.innerHTML = items.map(it => courseCardHtml(it, filter)).join('');
}

function courseCardHtml(it, filter) {
  const { course, done, total } = it;
  const percent = total > 0 ? Math.round(done / total * 100) : 0;
  const ctaText = filter === 'done' ? '🎓 Xem lại'
                 : filter === 'vipBought' ? '▶ Bắt đầu học'
                 : '▶ Tiếp tục';
  return `
    <a class="course-card" href="course.html?id=${encodeURIComponent(course.id)}">
      <div class="course-thumb">${filter === 'done' ? '🎓' : '▶'}</div>
      <div class="course-body">
        ${course.level ? `<span class="course-level">${escapeHtml(course.level)}</span>` : ''}
        ${course.isVip ? '<span class="vip-tag">👑 VIP</span>' : ''}
        <h3 class="course-title">${escapeHtml(course.title)}</h3>
        <p class="course-desc">${escapeHtml(course.description || '')}</p>
        <div class="course-meta">
          <span>📖 ${total} bài</span>
          <span>${percent}% hoàn thành</span>
        </div>
        <div class="course-progress-bar">
          <div class="course-progress-fill" style="width:${percent}%"></div>
        </div>
        <div class="course-cta">${ctaText}</div>
      </div>
    </a>
  `;
}
