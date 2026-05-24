// ============================================
// SETTINGS PAGE — Hồ sơ + Thông báo + Bảo mật + Thanh toán
// ============================================
import {
  requireAuth,
  fetchUserProfile,
  updateUserProfile,
  updateNotificationPrefs,
  fetchMyPayments,
  requestAccountDeletion,
  DEFAULT_NOTIF_PREFS
} from "./firebase.js";
import { escapeHtml, formatVnd, flashMessage, renderHeader } from "./app.js";

const EMAIL_PREFS = [
  { key: 'email_reminders',  title: 'Nhắc nhở học',
    desc: 'Email nhắc khi bạn không học 3+ ngày, gợi ý bài tiếp theo' },
  { key: 'email_milestones', title: 'Cột mốc & thành tích',
    desc: 'Khi hoàn thành khóa, đạt level mới, chuỗi học dài kỷ lục' },
  { key: 'email_promotions', title: 'Ưu đãi & khuyến mãi',
    desc: 'Coupon giảm giá, khóa VIP mới ra mắt' },
  { key: 'email_newsletter', title: 'Bản tin hàng tuần',
    desc: 'Báo cáo học tập tuần + mẹo học hiệu quả' }
];

const PUSH_PREFS = [
  { key: 'push_messages',     title: 'Tin nhắn từ admin',
    desc: 'Khi admin gửi thông báo riêng cho bạn' },
  { key: 'push_reminders',    title: 'Nhắc giờ học',
    desc: 'Push browser khi đến giờ học đã đặt' },
  { key: 'push_achievements', title: 'Thành tích & badge mới',
    desc: 'Khi mở khóa cấp độ hoặc đạt badge mới' }
];

let CURRENT_USER = null;
let CURRENT_PROFILE = null;

export async function initSettingsPage() {
  const user = await requireAuth();
  if (!user) return;
  CURRENT_USER = user;
  renderHeader(user);

  // Load profile
  try {
    CURRENT_PROFILE = await fetchUserProfile(user.uid);
  } catch (err) {
    console.error(err);
    flashMessage('Lỗi tải hồ sơ: ' + err.message, 'error');
    return;
  }

  bindTabs();
  hydrateProfileTab();
  hydrateNotifTab();
  bindSecurityTab();
  loadPaymentsTab();
}

function bindTabs() {
  const tabs = document.querySelectorAll('.settings-tab');
  const sections = document.querySelectorAll('.settings-section');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      sections.forEach(s => s.classList.toggle('active', s.id === 'section-' + name));
      history.replaceState(null, '', '#' + name);
    });
  });

  // Open tab from URL hash
  const hash = location.hash.replace('#', '');
  if (hash) {
    const t = document.querySelector(`.settings-tab[data-tab="${hash}"]`);
    if (t) t.click();
  }
}

/* =================== TAB: HỒ SƠ =================== */
function hydrateProfileTab() {
  const p = CURRENT_PROFILE || {};
  const nameInput  = document.getElementById('profile-name');
  const emailInput = document.getElementById('profile-email');
  const phoneInput = document.getElementById('profile-phone');
  const bioInput   = document.getElementById('profile-bio');
  const joinedInput= document.getElementById('profile-joined');
  const avatarEl   = document.getElementById('profile-avatar');
  const avatarFile = document.getElementById('avatar-upload');

  nameInput.value  = p.customName || p.displayName || '';
  emailInput.value = p.email || CURRENT_USER.email || '';
  phoneInput.value = p.phone || '';
  bioInput.value   = p.bio   || '';

  if (p.createdAt) {
    const d = new Date(p.createdAt);
    joinedInput.value = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } else {
    joinedInput.value = '—';
  }

  // Avatar: ưu tiên customAvatar > photoUrl Google > chữ cái đầu
  renderAvatar(avatarEl, p.customAvatar || p.photoUrl, p.customName || p.displayName || p.email);

  avatarFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      flashMessage('Ảnh quá lớn (>1MB). Vui lòng chọn ảnh nhỏ hơn.', 'error');
      return;
    }
    flashMessage('Đang xử lý ảnh...', 'info');
    try {
      const dataUrl = await compressImageToDataUrl(file, 256);
      renderAvatar(avatarEl, dataUrl, nameInput.value || CURRENT_USER.email);
      // Lưu tạm vào input để btn-save sẽ commit
      avatarEl.dataset.pendingAvatar = dataUrl;
      flashMessage('Đã chọn ảnh — bấm "Lưu thay đổi" để áp dụng', 'success');
    } catch (err) {
      flashMessage('Lỗi xử lý ảnh: ' + err.message, 'error');
    }
  });

  document.getElementById('btn-save-profile').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-profile');
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';
    try {
      const patch = {
        customName: nameInput.value.trim(),
        phone:      phoneInput.value.trim(),
        bio:        bioInput.value.trim()
      };
      if (avatarEl.dataset.pendingAvatar) {
        patch.customAvatar = avatarEl.dataset.pendingAvatar;
      }
      await updateUserProfile(CURRENT_USER.uid, patch);
      delete avatarEl.dataset.pendingAvatar;
      flashMessage('Đã lưu hồ sơ ✓', 'success');
      CURRENT_PROFILE = await fetchUserProfile(CURRENT_USER.uid);
    } catch (err) {
      flashMessage('Lỗi lưu: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Lưu thay đổi';
    }
  });
}

function renderAvatar(el, urlOrDataUrl, fallbackName) {
  if (urlOrDataUrl) {
    el.style.backgroundImage = `url("${urlOrDataUrl.replace(/"/g, '%22')}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.textContent = (fallbackName || 'A')[0].toUpperCase();
  }
}

/** Nén ảnh xuống size×size (square crop center), trả về dataURL JPEG q=0.8 */
function compressImageToDataUrl(file, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width  - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Không đọc được ảnh'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Không đọc được file'));
    reader.readAsDataURL(file);
  });
}

/* =================== TAB: THÔNG BÁO =================== */
function hydrateNotifTab() {
  const prefs = { ...DEFAULT_NOTIF_PREFS, ...(CURRENT_PROFILE?.notificationPrefs || {}) };
  const emailList = document.getElementById('notif-email-list');
  const pushList  = document.getElementById('notif-push-list');

  emailList.innerHTML = EMAIL_PREFS.map(p => notifRowHtml(p, prefs[p.key])).join('');
  pushList.innerHTML  = PUSH_PREFS.map(p  => notifRowHtml(p, prefs[p.key])).join('');

  document.getElementById('btn-save-notif').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-notif');
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';
    try {
      const collect = {};
      [...EMAIL_PREFS, ...PUSH_PREFS].forEach(p => {
        const cb = document.getElementById('notif-' + p.key);
        collect[p.key] = !!(cb && cb.checked);
      });
      await updateNotificationPrefs(CURRENT_USER.uid, collect);
      flashMessage('Đã lưu cài đặt thông báo ✓', 'success');
      CURRENT_PROFILE.notificationPrefs = collect;
    } catch (err) {
      flashMessage('Lỗi lưu: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Lưu cài đặt thông báo';
    }
  });
}

function notifRowHtml(p, enabled) {
  return `
    <label class="notif-row">
      <div>
        <div class="notif-row-title">${escapeHtml(p.title)}</div>
        <div class="notif-row-desc">${escapeHtml(p.desc)}</div>
      </div>
      <div class="switch">
        <input type="checkbox" id="notif-${p.key}" ${enabled ? 'checked' : ''} />
        <span class="slider"></span>
      </div>
    </label>
  `;
}

/* =================== TAB: BẢO MẬT =================== */
function bindSecurityTab() {
  document.getElementById('btn-delete-account').addEventListener('click', async () => {
    const step1 = confirm(
      'Bạn chắc chắn muốn XÓA TÀI KHOẢN?\n\n' +
      '• Toàn bộ tiến độ học, XP, level, streak sẽ mất vĩnh viễn\n' +
      '• Lịch sử thanh toán bị xóa\n' +
      '• Các bài/khóa VIP đã mua bị thu hồi\n' +
      '• Bạn sẽ bị đăng xuất ngay sau khi xóa\n\n' +
      'Hành động này KHÔNG THỂ hoàn tác. Tiếp tục?'
    );
    if (!step1) return;

    const reason = prompt(
      'Vì sao bạn xóa tài khoản? (tùy chọn — giúp chúng tôi cải thiện)\n\n' +
      'VD: "Không có thời gian học", "Khóa học không phù hợp", "Lỗi kỹ thuật"...'
    );
    if (reason === null) return; // user huỷ

    const confirmText = prompt('Gõ "XOA" (không dấu, in hoa) để xác nhận xóa:');
    if (confirmText !== 'XOA') {
      flashMessage('Đã hủy — bạn gõ sai mã xác nhận', 'info');
      return;
    }

    try {
      await requestAccountDeletion(CURRENT_USER.uid, CURRENT_USER.email, reason);
      alert('Đã gửi yêu cầu xóa tài khoản. Bạn sẽ được đăng xuất.');
      location.href = 'index.html';
    } catch (err) {
      flashMessage('Lỗi xóa: ' + err.message, 'error');
    }
  });
}

/* =================== TAB: THANH TOÁN =================== */
async function loadPaymentsTab() {
  const container = document.getElementById('payments-container');
  const summary = document.getElementById('payments-summary');
  try {
    const payments = await fetchMyPayments(CURRENT_USER.uid);
    const approved = payments.filter(p => p.status === 'approved');
    const totalSpent = approved.reduce((s, p) => s + (p.amount || 0), 0);
    summary.textContent = `${approved.length} giao dịch · Tổng ${formatVnd(totalSpent)}`;

    if (!payments.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">💳</div>
          <p><strong>Chưa có giao dịch nào</strong></p>
          <p>Khi bạn mua bài/khóa VIP, lịch sử sẽ hiện ở đây.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <table class="payments-table">
        <thead>
          <tr>
            <th>Ngày</th>
            <th>Loại</th>
            <th>Nội dung</th>
            <th>Số tiền</th>
            <th>Trạng thái</th>
            <th>Mã CK</th>
          </tr>
        </thead>
        <tbody>
          ${payments.map(p => paymentRowHtml(p)).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error(err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠</div>
        <p>Lỗi tải lịch sử: ${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function paymentRowHtml(p) {
  const date = p.createdAt ? new Date(p.createdAt.seconds * 1000) : null;
  const dateStr = date ? date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) + '<br><small style="color:#888">' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + '</small>' : '—';
  const target = p.type === 'course'
    ? `📚 ${escapeHtml(p.courseTitle || '(Khóa)')}`
    : `📖 ${escapeHtml(p.lessonTitle || '(Bài)')}<br><small style="color:#888">${escapeHtml(p.courseTitle || '')}</small>`;
  const statusBadge = {
    approved: '<span class="pay-status approved">✓ Đã duyệt</span>',
    pending:  '<span class="pay-status pending">⏳ Chờ duyệt</span>',
    rejected: '<span class="pay-status rejected">✗ Từ chối</span>',
    fraud:    '<span class="pay-status fraud">⚠ Gian lận</span>'
  }[p.status] || `<span class="pay-status">${escapeHtml(p.status)}</span>`;
  return `
    <tr>
      <td>${dateStr}</td>
      <td>${p.type === 'course' ? 'Khóa' : 'Bài'}</td>
      <td>${target}</td>
      <td><strong>${formatVnd(p.amount || 0)}</strong></td>
      <td>${statusBadge}</td>
      <td><code style="font-size:11px">${escapeHtml(p.transferContent || '')}</code></td>
    </tr>
  `;
}
