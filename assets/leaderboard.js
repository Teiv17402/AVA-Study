// ============================================
// LEADERBOARD PAGE
// ============================================
import {
  requireAuth,
  fetchCourses,
  fetchLeaderboard,
  isAdmin
} from "./firebase.js";
import {
  escapeHtml,
  renderHeader
} from "./app.js";

let currentUser = null;
let entries = [];
let currentTab = "month";

export async function initLeaderboardPage() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  renderHeader(currentUser);

  try {
    const courses = await fetchCourses();
    entries = await fetchLeaderboard(courses);
    setupTabs();
    render();
  } catch (err) {
    document.getElementById("leaderboard-podium").innerHTML = `<p style="color:#ef4444">Lỗi: ${escapeHtml(err.message)}</p>`;
  }
}

function setupTabs() {
  document.querySelectorAll(".lb-tab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".lb-tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      currentTab = t.dataset.tab;
      render();
    });
  });
}

function getScore(e) {
  return currentTab === "month" ? e.score.monthly : e.score.total;
}

function render() {
  // Sort by current tab metric
  const sorted = [...entries].sort((a, b) => getScore(b) - getScore(a));

  const podium = document.getElementById("leaderboard-podium");
  const list = document.getElementById("leaderboard-list");
  const myCard = document.getElementById("my-rank-card");

  if (!sorted.length) {
    podium.innerHTML = '<div class="empty-state"><div class="icon">🏆</div><p><strong>Chưa có dữ liệu xếp hạng</strong></p></div>';
    list.innerHTML = "";
    myCard.innerHTML = "";
    return;
  }

  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3, 50);

  podium.innerHTML = top3.map((e, i) => {
    const rank = i + 1;
    const medal = ["🥇", "🥈", "🥉"][i];
    const className = ["first", "second", "third"][i];
    return `
      <div class="podium-slot ${className}">
        <div class="podium-medal">${medal}</div>
        <div class="podium-avatar">
          ${e.user.photoURL
            ? `<img src="${escapeHtml(e.user.photoURL)}" referrerpolicy="no-referrer" />`
            : `<div class="avatar-fallback">${(e.user.displayName || e.user.email || "U")[0].toUpperCase()}</div>`}
        </div>
        <div class="podium-name">${escapeHtml(e.user.displayName || e.user.email || "—")}</div>
        <div class="podium-score">${getScore(e)} điểm</div>
        <div class="podium-rank">#${rank}</div>
      </div>`;
  }).join("");

  list.innerHTML = rest.length ? `
    <table class="lb-table">
      <thead>
        <tr>
          <th style="width:60px">Hạng</th>
          <th>User</th>
          <th>Bài học</th>
          <th>Khóa học</th>
          <th>Vi phạm</th>
          <th>Điểm</th>
        </tr>
      </thead>
      <tbody>
        ${rest.map((e, i) => `
          <tr ${e.user.id === currentUser.uid ? 'class="me-row"' : ""}>
            <td><strong>#${i + 4}</strong></td>
            <td>${escapeHtml(e.user.displayName || e.user.email || "—")}</td>
            <td>${e.score.breakdown.lessonsCompleted}</td>
            <td>${e.score.breakdown.coursesCompleted}</td>
            <td>${e.score.breakdown.violations > 0 ? `<span style="color:#ef4444">${e.score.breakdown.violations}</span>` : "—"}</td>
            <td style="color:#d4af6e;font-weight:700">${getScore(e)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>` : "";

  // My rank
  const myIdx = sorted.findIndex(e => e.user.id === currentUser.uid);
  if (myIdx >= 0) {
    const me = sorted[myIdx];
    myCard.innerHTML = `
      <div class="my-rank-inner">
        <div class="my-rank-label">Hạng của bạn (${currentTab === "month" ? "tháng này" : "tổng"})</div>
        <div class="my-rank-value">#${myIdx + 1}</div>
        <div class="my-rank-score">${getScore(me)} điểm</div>
        <div class="my-rank-breakdown">
          📖 ${me.score.breakdown.lessonsCompleted} bài · 🎓 ${me.score.breakdown.coursesCompleted} khóa · ${me.score.breakdown.violations > 0 ? `⚠️ ${me.score.breakdown.violations} vi phạm` : "✓ 0 vi phạm"}
        </div>
      </div>`;
  } else {
    myCard.innerHTML = "";
  }
}
