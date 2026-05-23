// ============================================
// LEADERBOARD PAGE v2 — podium style + formula
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
    document.getElementById("leaderboard-podium").innerHTML = `<p style="color:#ef4444;text-align:center;padding:20px">Lỗi: ${escapeHtml(err.message)}</p>`;
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
  const sorted = [...entries].sort((a, b) => getScore(b) - getScore(a));

  const podium = document.getElementById("leaderboard-podium");
  const list = document.getElementById("leaderboard-list");
  const myCard = document.getElementById("my-rank-card");

  if (!sorted.length) {
    podium.innerHTML = '<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:40px"><div style="font-size:60px">🏆</div><p><strong>Chưa có dữ liệu xếp hạng</strong></p><p style="color:var(--text-mute);font-size:13px">Hãy hoàn thành bài học đầu tiên để xuất hiện trên bảng vàng!</p></div>';
    list.innerHTML = "";
    myCard.innerHTML = "";
    return;
  }

  // Podium: arrange visually 2-1-3 (silver-gold-bronze)
  const top = sorted.slice(0, 3);
  const order = [1, 0, 2]; // 2nd, 1st, 3rd
  const podiumClasses = ["second", "first", "third"];

  podium.innerHTML = order.map((idx, slotPos) => {
    const e = top[idx];
    if (!e) return `<div class="podium-slot ${podiumClasses[slotPos]} empty"></div>`;
    const rank = idx + 1;
    return `
      <div class="podium-slot ${podiumClasses[slotPos]}">
        <div class="podium-num-circle">${rank}</div>
        <div class="podium-name">${escapeHtml(e.user.displayName || e.user.email || "—")}</div>
        <div class="podium-score-main">${getScore(e)}</div>
        <div class="podium-stat-label">Điểm ${currentTab === "month" ? "tháng này" : "tổng"}</div>
        <div style="font-size:11px;color:var(--text-mute);margin-top:6px">
          📖 ${e.score.breakdown.lessonsCompleted} bài · 🎓 ${e.score.breakdown.coursesCompleted} khóa
        </div>
      </div>`;
  }).join("");

  // List from rank 4+
  const rest = sorted.slice(3, 50);
  list.innerHTML = `
    <div class="formula-card">
      <h3>🧮 Công thức tính điểm</h3>
      <ul class="formula-list">
        <li><span>Mỗi bài hoàn thành</span><strong>+10đ</strong></li>
        <li><span>Mỗi khóa hoàn thành</span><strong>+100đ</strong></li>
        <li><span>Quiz đạt ≥95%</span><strong>+20đ / bài</strong></li>
        <li><span>Vi phạm timer 24h</span><strong class="neg">-10đ / lần</strong></li>
      </ul>
      <p style="margin-top:10px;color:var(--text-mute);font-size:12px;font-style:italic">
        "Tháng này" chỉ tính bài hoàn thành & vi phạm trong tháng hiện tại. Top mỗi tháng sẽ được tặng quà.
      </p>
    </div>

    ${rest.length ? `
    <h3 style="margin:20px 0 12px;color:var(--text-mute);font-size:13px;text-transform:uppercase;letter-spacing:1px">Hạng 4 trở xuống</h3>
    <table class="lb-table">
      <thead>
        <tr>
          <th style="width:60px">Hạng</th>
          <th>User</th>
          <th>Bài</th>
          <th>Khóa</th>
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
    </table>` : ""}
  `;

  // My rank card
  const myIdx = sorted.findIndex(e => e.user.id === currentUser.uid);
  if (myIdx >= 0) {
    const me = sorted[myIdx];
    myCard.innerHTML = `
      <div class="my-rank-inner">
        <div>
          <div class="my-rank-label">Hạng của bạn (${currentTab === "month" ? "tháng này" : "tổng"})</div>
          <div class="my-rank-value">#${myIdx + 1}</div>
        </div>
        <div></div>
        <div class="my-rank-score">${getScore(me)} điểm</div>
        <div class="my-rank-breakdown">
          📖 ${me.score.breakdown.lessonsCompleted} bài · 🎓 ${me.score.breakdown.coursesCompleted} khóa
          ${me.score.breakdown.violations > 0 ? ` · ⚠️ ${me.score.breakdown.violations} vi phạm` : ""}
        </div>
      </div>`;
  } else {
    myCard.innerHTML = "";
  }
}
