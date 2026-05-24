// ============================================
// DASHBOARD — Tổng quan: greeting + level + streak + recent
// ============================================
import {
  requireAuth,
  fetchUserProfile,
  fetchUserProgress,
  fetchCourses,
  calculateLevel,
  computeXp,
  syncXpCache,
  touchStreakV2,
  fetchRecentActivity
} from "./firebase.js";
import {
  escapeHtml,
  flashMessage,
  renderHeader,
  getCourseProgress,
  getLessonStatus
} from "./app.js";

export async function initDashboardPage() {
  const user = await requireAuth();
  if (!user) return;
  renderHeader(user);

  document.getElementById('greet-name').textContent = (user.displayName || user.email).split(' ')[0];

  try {
    const [profile, progress, courses] = await Promise.all([
      fetchUserProfile(user.uid),
      fetchUserProgress(user.uid),
      fetchCourses()
    ]);

    // Touch streak (Phase B: với freeze protection)
    const streakResult = await touchStreakV2(user.uid);
    const streakDays = streakResult ? streakResult.streakDays : (profile?.streakDays || 0);
    const freezes = streakResult ? streakResult.freezesAvailable : (profile?.streakFreezesAvailable ?? 1);

    // Compute XP fresh, sync cache nếu khác DB
    const xp = computeXp(progress, courses);
    if (profile && xp !== (profile.xpTotal || 0)) {
      syncXpCache(user.uid, xp); // fire-and-forget
    }

    hydrateStats(progress, courses, streakDays, freezes);
    hydrateLevel(xp);
    hydrateContinue(progress, courses);
    hydrateRecent(courses, progress);
    hydrateSocialProof(user.uid); // fire-and-forget

    if (streakResult && streakResult.freezeAppliedNow) {
      flashMessage(`🧊 Đã dùng 1 freeze để giữ chuỗi ${streakDays} ngày! Còn ${freezes} freeze tuần này.`, 'info');
    } else if (streakResult && streakResult.changed && streakDays > 1) {
      flashMessage(`🔥 Chuỗi ${streakDays} ngày — tuyệt vời!`, 'success');
    }
  } catch (err) {
    console.error(err);
    flashMessage('Lỗi tải dashboard: ' + err.message, 'error');
  }
}

function hydrateStats(progress, courses, streakDays, freezes) {
  // Khóa đăng ký = số khóa có ít nhất 1 lesson đã unlock hoặc completed
  const completed = progress.completed || [];
  const unlockedAt = progress.unlockedAt || {};
  const startedCourses = courses.filter(c => {
    const lessonIds = (c.lessons || []).map(l => l.id);
    return lessonIds.some(id => completed.includes(id) || unlockedAt[id]);
  });

  document.getElementById('stat-courses').textContent   = startedCourses.length;
  document.getElementById('stat-streak').textContent    = streakDays;
  document.getElementById('stat-completed').textContent = completed.length;

  // Phase B: hiện badge freeze quota
  const freezeBadge = document.getElementById('freeze-badge');
  if (freezeBadge) {
    if ((freezes || 0) > 0) {
      freezeBadge.style.display = 'inline-flex';
      freezeBadge.textContent = `🧊 ${freezes} freeze tuần này`;
      freezeBadge.title = 'Nếu nghỉ 1 ngày, freeze sẽ tự dùng để giữ chuỗi. Reset thứ 2 hàng tuần.';
    } else {
      freezeBadge.style.display = 'inline-flex';
      freezeBadge.textContent = `🧊 Hết freeze`;
      freezeBadge.style.opacity = '0.5';
      freezeBadge.title = 'Hết freeze tuần này. Reset vào thứ 2.';
    }
  }

  const sub = document.getElementById('greet-sub');
  if (streakDays >= 7) sub.textContent = `🔥 Chuỗi ${streakDays} ngày — bạn đang ở phong độ cao!`;
  else if (streakDays > 0) sub.textContent = `Chuỗi học ${streakDays} ngày — duy trì để lên kỷ lục mới!`;
  else if (completed.length === 0) sub.textContent = `Hôm nay là ngày tốt để bắt đầu bài đầu tiên — chỉ 5 phút thôi!`;
  else sub.textContent = `Hôm qua bạn nghỉ — quay lại học để bắt đầu chuỗi mới nhé!`;
}

function hydrateLevel(xp) {
  const lv = calculateLevel(xp);
  document.getElementById('level-num').textContent   = lv.level;
  document.getElementById('level-next').textContent  = lv.level + 1;
  document.getElementById('xp-in-level').textContent = lv.xpInLevel;
  document.getElementById('xp-per-level').textContent= lv.xpPerLevel;
  document.getElementById('xp-to-next').textContent  = lv.xpToNext;
  document.getElementById('level-fill').style.width  = lv.percent + '%';
}

function hydrateContinue(progress, courses) {
  const container = document.getElementById('continue-container');
  const completed = progress.completed || [];

  // Tìm course đang dở dang: có ít nhất 1 lesson completed/unlocked, chưa xong hết
  const ongoing = courses
    .map(c => {
      const lessons = c.lessons || [];
      const prog = getCourseProgress(lessons, completed);
      return { course: c, lessons, prog };
    })
    .filter(x => x.lessons.length > 0 && x.prog.done > 0 && x.prog.done < x.lessons.length);

  if (ongoing.length === 0) {
    // Fallback: course đầu chưa xong
    const next = courses.find(c => {
      const ids = (c.lessons || []).map(l => l.id);
      return ids.length > 0 && !ids.every(id => completed.includes(id));
    });
    if (!next) {
      container.innerHTML = `
        <div class="continue-empty">
          <p>🎉 Bạn đã hoàn thành tất cả khóa hiện có!</p>
          <a href="home.html" class="btn btn-secondary btn-sm">Xem khóa khác</a>
        </div>`;
      return;
    }
    container.innerHTML = continueCardHtml(next, (next.lessons || []), completed, progress, true);
    return;
  }

  // Lấy course có tiến độ cao nhất → nudge người dùng hoàn thành
  ongoing.sort((a, b) => b.prog.percent - a.prog.percent);
  const top = ongoing[0];
  container.innerHTML = continueCardHtml(top.course, top.lessons, completed, progress, false);
}

function continueCardHtml(course, lessons, completed, progress, isFirstTime) {
  const nextLesson = lessons.find(l => !completed.includes(l.id)) || lessons[0];
  const prog = getCourseProgress(lessons, completed);
  const url = `course.html?id=${encodeURIComponent(course.id)}#${nextLesson ? nextLesson.id : ''}`;
  return `
    <div class="continue-card">
      <div class="continue-course-meta">
        ${course.level ? `<span class="course-level">${escapeHtml(course.level)}</span>` : ''}
        ${course.isVip ? '<span class="vip-tag">👑 VIP</span>' : ''}
      </div>
      <h3 class="continue-course-title">${escapeHtml(course.title)}</h3>
      ${nextLesson ? `
        <div class="continue-next-label">Bài tiếp theo</div>
        <div class="continue-next-title">📖 ${escapeHtml(nextLesson.title)}</div>
      ` : ''}
      <div class="continue-progress">
        <div class="continue-progress-bar">
          <div class="continue-progress-fill" style="width:${prog.percent}%"></div>
        </div>
        <div class="continue-progress-text">${prog.done}/${prog.total} bài · ${prog.percent}%</div>
      </div>
      <a class="btn btn-primary continue-cta" href="${url}">
        ${isFirstTime ? '▶ Bắt đầu học' : '▶ Tiếp tục học'}
      </a>
    </div>
  `;
}

function hydrateRecent(courses, progress) {
  const container = document.getElementById('recent-container');
  if (!courses.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="icon">📚</div>
        <p>Chưa có khóa học nào.</p>
      </div>`;
    return;
  }
  // Lấy 3 khóa mới nhất (theo createdAt)
  const recent = courses
    .slice()
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 3);

  const completed = progress.completed || [];

  container.innerHTML = recent.map(c => {
    const lessons = c.lessons || [];
    const prog = getCourseProgress(lessons, completed);
    return `
      <a class="recent-tile" href="course.html?id=${encodeURIComponent(c.id)}">
        <div class="recent-thumb">▶</div>
        <div class="recent-body">
          ${c.level ? `<span class="course-level">${escapeHtml(c.level)}</span>` : ''}
          ${c.isVip ? '<span class="vip-tag">👑</span>' : ''}
          <h4>${escapeHtml(c.title)}</h4>
          <div class="recent-meta">
            <span>${lessons.length} bài</span>
            <span>${prog.percent}% xong</span>
          </div>
        </div>
      </a>
    `;
  }).join('');
}


/* ============================================
   PHASE B — SOCIAL PROOF BAR
   ============================================ */
async function hydrateSocialProof(currentUserId) {
  const bar = document.getElementById('social-proof-bar');
  if (!bar) return;

  let items;
  try {
    items = await fetchRecentActivity();
  } catch (e) { return; }

  // Loại current user khỏi feed (không tự khoe mình)
  items = (items || []).filter(it => it.userId !== currentUserId);

  if (!items.length) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  let idx = 0;
  const inner = bar.querySelector('.social-proof-text');
  if (!inner) return;

  function renderItem(it) {
    const ago = it.minsAgo < 60
      ? `${it.minsAgo}p trước`
      : `${Math.floor(it.minsAgo / 60)}h trước`;
    inner.innerHTML = `<span class="sp-icon">${it.icon}</span> ${escapeHtml(it.text)} <span class="sp-time">· ${ago}</span>`;
    inner.style.opacity = '0';
    requestAnimationFrame(() => {
      inner.style.transition = 'opacity .4s ease';
      inner.style.opacity = '1';
    });
  }

  renderItem(items[0]);
  if (items.length === 1) return;

  setInterval(() => {
    idx = (idx + 1) % items.length;
    inner.style.opacity = '0';
    setTimeout(() => renderItem(items[idx]), 350);
  }, 5000);
}
