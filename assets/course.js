// ============================================
// COURSE PAGE — sidebar + video + 24h lock + VIP payment
// ============================================
import {
  requireAuth,
  fetchCourse,
  fetchUserProgress,
  markLessonCompleted,
  ensureFirstUnlock,
  resetUserProgress,
  createPayment,
  fetchMyPaymentForLesson,
  createCoursePayment,
  fetchMyPaymentForCourse,
  selfApprovePayment,
  selfApproveCoursePayment,
  recordViolation,
  checkBanned,
  buildVietQrUrl,
  BANK_CONFIG,
  isAdmin
} from "./firebase.js";
import {
  escapeHtml,
  formatDuration,
  formatVnd,
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
let userProgress = { completed: [], unlockedAt: {}, paidLessons: [], paidCourses: [] };
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

    // BAN CHECK — hard ban toàn hệ thống nếu vi phạm
    if (!isAdmin(currentUser)) {
      const ban = checkBanned(userProgress);
      if (ban.isBanned) {
        renderBannedScreen(ban);
        return;
      }
    }

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
      const courseLocked = course.isVip && !(userProgress.paidCourses || []).includes(course.id);
      if (!courseLocked) {
        const firstNonVip = currentLessons.find(l => !l.isVip);
        if (firstNonVip) {
          const updated = await ensureFirstUnlock(currentUser.uid, firstNonVip.id);
          if (updated) userProgress = { ...userProgress, ...updated };
        }
      }
    }

    let startIdx = 0;
    for (let i = 0; i < currentLessons.length; i++) {
      const status = getLessonStatus(currentLessons, i, userProgress, currentCourse);
      if (status === 'available') { startIdx = i; break; }
    }
    const hashId = location.hash.replace("#", "");
    if (hashId) {
      const idx = currentLessons.findIndex(l => l.id === hashId);
      if (idx >= 0) startIdx = idx;
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
    const status = getLessonStatus(currentLessons, idx, userProgress, currentCourse);
    const active = idx === currentLessonIndex;

    let cls = "lesson-item";
    let icon = (idx + 1);
    let extra = "";

    if (lesson.isVip) {
      extra = `<span class="lesson-vip-tag">👑 VIP ${formatVnd(lesson.price || BANK_CONFIG.defaultPrice)}</span>`;
    }

    if (status === 'completed') { cls += " completed"; icon = "✓"; }
    else if (status === 'locked-prerequisite') { cls += " locked"; icon = "🔒"; }
    else if (status === 'locked-expired') {
      cls += " expired"; icon = "⌛";
      extra = `<span class="lesson-expired-tag">Hết hạn</span>`;
    }
    else if (status === 'locked-vip') {
      cls += " vip-locked"; icon = "👑";
    }
    else if (status === 'locked-vip-course') {
      cls += " vip-locked"; icon = "👑";
    }
    else if (status === 'available') {
      const ms = getRemainingMs(lesson.id, userProgress);
      if (ms != null && !isAdmin(currentUser)) {
        const urgent = ms < 60 * 60 * 1000;
        // Replace extra (if there was a VIP tag, hide it since user paid)
        if (!lesson.isVip || (userProgress.paidLessons || []).includes(lesson.id)) {
          extra = `<span class="lesson-countdown${urgent ? ' urgent' : ''}">${formatRemaining(ms)}</span>`;
        }
      }
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
      const status = getLessonStatus(currentLessons, idx, userProgress, currentCourse);
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
  hideLockOverlay(); // clear any existing overlay
  const lesson = currentLessons[index];
  const status = getLessonStatus(currentLessons, index, userProgress, currentCourse);

  if (!isAdmin(currentUser)) {
    if (status === 'locked-prerequisite') return;

    if (status === 'locked-vip-course') {
      currentLessonIndex = index;
      history.replaceState(null, "", `#${lesson.id}`);
      renderCourseVipPaymentNotice(currentCourse, lesson);
      renderSidebar();
      return;
    }

    if (status === 'locked-vip') {
      currentLessonIndex = index;
      history.replaceState(null, "", `#${lesson.id}`);
      renderVipPaymentNotice(lesson);
      renderSidebar();
      return;
    }

    if (status === 'locked-expired') {
      currentLessonIndex = index;
      history.replaceState(null, "", `#${lesson.id}`);
      renderExpiredNotice(lesson);
      renderSidebar();
      // Record violation (idempotent per lesson)
      (async () => {
        try {
          const result = await recordViolation(
            currentUser.uid, currentUser.email, currentUser.displayName,
            currentCourse.id, currentCourse.title,
            lesson.id, lesson.title
          );
          if (!result.alreadyRecorded) {
            const updated = await fetchUserProgress(currentUser.uid);
            userProgress = updated;
            if (result.bannedUntil > Date.now()) {
              const days = Math.ceil((result.bannedUntil - Date.now()) / 86400000);
              flashMessage(`⛔ Bạn đã bị khóa ${days} ngày do vi phạm lần ${result.count}.`, "error");
              setTimeout(() => location.reload(), 2000);
            } else if (result.count >= 3) {
              flashMessage(`⚠️ Vi phạm lần ${result.count} — admin đã được thông báo.`, "error");
            }
          }
        } catch (e) { console.warn("Lỗi ghi nhận vi phạm:", e); }
      })();
      return;
    }
  }

  currentLessonIndex = index;
  history.replaceState(null, "", `#${lesson.id}`);

  const videoWrap = document.getElementById("video-wrap");
  if (lesson.driveFileId && lesson.driveFileId !== "REPLACE_WITH_GOOGLE_DRIVE_FILE_ID" && lesson.driveFileId.trim()) {
    videoWrap.innerHTML = `<iframe src="https://drive.google.com/file/d/${encodeURIComponent(lesson.driveFileId)}/preview" allow="autoplay" allowfullscreen></iframe>`;
  } else {
    videoWrap.innerHTML = `
      <div class="video-placeholder">
        <div class="icon">▶</div>
        <div><strong>Video chưa được cấu hình</strong></div>
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
  canCompleteAt = Math.max(10, Math.floor((lesson.duration || 60) * 0.85));
  updateTimerUI();
  videoTimerId = setInterval(() => {
    // Pause counter when user switches tab / minimizes / clicks outside (Drive iframe lost focus)
    if (document.hidden || !document.hasFocus()) {
      updatePausedHint(true);
      return;
    }
    updatePausedHint(false);
    videoElapsed++;
    updateTimerUI();
  }, 1000);

  document.getElementById("btn-prev").disabled = (index === 0);
  const nextLesson = currentLessons[index + 1];
  document.getElementById("btn-next").disabled = !nextLesson || !completed.includes(lesson.id);

  renderSidebar();
}

async function renderVipPaymentNotice(lesson) {
  const price = lesson.price || BANK_CONFIG.defaultPrice;

  // Show lockscreen overlay (dismissible)
  showLockOverlay({
    title: "👑 Bài học VIP",
    subtitle: `Bài <strong>${escapeHtml(lesson.title)}</strong> cần thanh toán <strong style="color:#d4af6e">${formatVnd(price)}</strong> để mở khóa.`,
    hint: "Thanh toán bằng QR + chờ admin duyệt.",
    dismissible: true,
    actions: [
      { label: "💳 Mua ngay", primary: true, onClick: () => { hideLockOverlay(); showPaymentModal(lesson, price); } },
      { label: "← Quay lại", primary: false, onClick: () => { hideLockOverlay(); location.href = "home.html"; } }
    ]
  });

  // Check existing payment status
  const existingPayment = await fetchMyPaymentForLesson(currentUser.uid, lesson.id);

  const videoWrap = document.getElementById("video-wrap");
  videoWrap.innerHTML = `
    <div class="video-placeholder" style="background: linear-gradient(135deg, #1a1a1a, #2a1f0a)">
      <div class="icon" style="color:var(--accent);font-size:80px">👑</div>
      <div><strong style="font-size:18px">Bài học VIP</strong></div>
      <div style="font-size:13px;margin-top:8px">Cần thanh toán để xem nội dung</div>
    </div>`;

  document.getElementById("lesson-title-big").textContent = lesson.title;
  document.getElementById("lesson-badge").textContent = "👑 VIP";
  document.getElementById("lesson-badge").classList.remove("done");

  // Render payment UI in lesson-description area
  const descEl = document.getElementById("lesson-description");

  if (existingPayment && existingPayment.status === 'pending') {
    descEl.innerHTML = renderPendingPayment(existingPayment, lesson, price);
  } else if (existingPayment && existingPayment.status === 'rejected') {
    descEl.innerHTML = renderPaymentForm(lesson, price, true);
    bindPaymentButton(lesson, price);
  } else {
    descEl.innerHTML = renderPaymentForm(lesson, price, false);
    bindPaymentButton(lesson, price);
  }

  document.getElementById("timer-info").innerHTML = `<span class="timer-icon">👑</span><span>Bài VIP — thanh toán để mở khóa nội dung</span>`;
  document.getElementById("btn-done").disabled = true;
  document.getElementById("btn-done").textContent = "Bài VIP";
  document.getElementById("btn-prev").disabled = (currentLessonIndex === 0);
  document.getElementById("btn-next").disabled = true;
  if (videoTimerId) clearInterval(videoTimerId);
}

function renderPaymentForm(lesson, price, wasRejected) {
  return `
    <div class="vip-notice">
      ${wasRejected ? `<div class="vip-warn">⚠️ Lần thanh toán trước bị từ chối. Vui lòng kiểm tra lại nội dung chuyển khoản.</div>` : ""}
      <h3>👑 Bài học này yêu cầu thanh toán</h3>
      <div class="vip-price">${formatVnd(price)}</div>
      <p class="vip-instructions">
        Chuyển khoản theo thông tin bên dưới. Sau khi chuyển xong, bấm
        <strong>"Tôi đã thanh toán"</strong> để gửi yêu cầu lên admin.
      </p>
      <button class="btn btn-primary" id="btn-show-qr">📱 Hiện QR thanh toán</button>
    </div>
  `;
}

function renderPendingPayment(payment, lesson, price) {
  return `
    <div class="vip-notice pending">
      <h3>⏳ Đang chờ admin duyệt thanh toán</h3>
      <p class="vip-instructions">
        Yêu cầu của bạn đã được gửi. Admin sẽ kiểm tra giao dịch và duyệt trong thời gian ngắn.
      </p>
      <div class="vip-info-row"><span>Số tiền:</span> <strong>${formatVnd(payment.amount)}</strong></div>
      <div class="vip-info-row"><span>Nội dung CK:</span> <strong>${escapeHtml(payment.transferContent)}</strong></div>
      <button class="btn btn-secondary" id="btn-show-qr">📱 Xem lại QR</button>
      <p style="margin-top:16px;font-size:13px;color:var(--text-mute)">
        Nếu đã chờ lâu mà chưa được duyệt, vui lòng liên hệ admin để hỗ trợ.
      </p>
    </div>
  `;
}

function bindPaymentButton(lesson, price) {
  const btn = document.getElementById("btn-show-qr");
  if (!btn) return;
  btn.addEventListener("click", () => showPaymentModal(lesson, price));
}

async function showPaymentModal(lesson, price) {
  // Create payment record (or fetch existing pending)
  let payment;
  try {
    payment = await createPayment(
      currentUser.uid,
      currentUser.email,
      lesson.id,
      currentCourse.id,
      currentCourse.title,
      lesson.title,
      price
    );
  } catch (err) {
    flashMessage("Lỗi tạo yêu cầu thanh toán: " + err.message, "error");
    return;
  }

  const qrUrl = buildVietQrUrl(price, payment.transferContent);

  // Create modal
  let modal = document.getElementById("payment-modal");
  if (modal) modal.remove();
  modal = document.createElement("div");
  modal.id = "payment-modal";
  modal.className = "modal-overlay active";
  modal.innerHTML = `
    <div class="modal payment-modal">
      <div class="modal-header">
        <h2>💳 Quét QR thanh toán</h2>
        <button class="modal-close" data-close-payment>×</button>
      </div>
      <div class="modal-body">
        <div class="payment-qr-wrap">
          <img src="${qrUrl}" alt="QR thanh toán" class="payment-qr" />
        </div>
        <div class="payment-info">
          <div class="payment-row"><span>Ngân hàng:</span> <strong>${escapeHtml(BANK_CONFIG.bankName)}</strong></div>
          <div class="payment-row"><span>Số tài khoản:</span> <strong>${escapeHtml(BANK_CONFIG.accountNo)}</strong></div>
          <div class="payment-row"><span>Tên chủ TK:</span> <strong>${escapeHtml(BANK_CONFIG.accountName)}</strong></div>
          <div class="payment-row highlight"><span>Số tiền:</span> <strong>${formatVnd(price)}</strong></div>
          <div class="payment-row highlight"><span>Nội dung CK:</span> <strong>${escapeHtml(payment.transferContent)}</strong></div>
        </div>
        <p class="payment-note">
          ⚠️ <strong>Quan trọng:</strong> Nhập <strong>đúng nội dung CK</strong> ở trên để admin biết bạn thanh toán bài nào.
          Sau khi chuyển khoản xong, bấm nút bên dưới để gửi yêu cầu duyệt.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-close-payment>Đóng</button>
        <button class="btn btn-primary" id="btn-confirm-paid">✅ Tôi đã thanh toán</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll("[data-close-payment]").forEach(el => {
    el.addEventListener("click", () => modal.remove());
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  document.getElementById("btn-confirm-paid").addEventListener("click", () => {
    modal.remove();
    flashMessage("✓ Đã gửi yêu cầu! Đang chờ admin duyệt...", "success");
    setTimeout(() => renderVipPaymentNotice(lesson), 800);
  });
}

async function renderCourseVipPaymentNotice(course, lesson) {
  const price = course.price || BANK_CONFIG.defaultPrice;

  showLockOverlay({
    title: "👑 Khóa học VIP",
    subtitle: `Khóa <strong>${escapeHtml(course.title)}</strong> cần mua ${formatVnd(price)} để mở <strong>toàn bộ ${(course.lessons || []).length} bài</strong>.`,
    hint: "Thanh toán 1 lần — xem được tất cả bài trong khóa.",
    dismissible: true,
    actions: [
      { label: "💳 Mua khóa ngay", primary: true, onClick: () => { hideLockOverlay(); showCoursePaymentModal(course, price); } },
      { label: "← Quay lại", primary: false, onClick: () => { hideLockOverlay(); location.href = "home.html"; } }
    ]
  });

  const existingPayment = await fetchMyPaymentForCourse(currentUser.uid, course.id);

  const videoWrap = document.getElementById("video-wrap");
  videoWrap.innerHTML = `
    <div class="video-placeholder" style="background: linear-gradient(135deg, #1a1a1a, #2a1f0a)">
      <div class="icon" style="color:var(--accent);font-size:80px">👑</div>
      <div><strong style="font-size:18px">Khóa học VIP</strong></div>
      <div style="font-size:13px;margin-top:8px">Thanh toán 1 lần để mở toàn bộ ${(course.lessons || []).length} bài học</div>
    </div>`;

  document.getElementById("lesson-title-big").textContent = lesson.title;
  document.getElementById("lesson-badge").textContent = "👑 Khóa VIP";
  document.getElementById("lesson-badge").classList.remove("done");

  const descEl = document.getElementById("lesson-description");

  if (existingPayment && existingPayment.status === 'pending') {
    descEl.innerHTML = renderCoursePendingPayment(existingPayment, course, price);
  } else if (existingPayment && existingPayment.status === 'rejected') {
    descEl.innerHTML = renderCoursePaymentForm(course, price, true);
    bindCoursePaymentButton(course, price);
  } else {
    descEl.innerHTML = renderCoursePaymentForm(course, price, false);
    bindCoursePaymentButton(course, price);
  }

  document.getElementById("timer-info").innerHTML = `<span class="timer-icon">👑</span><span>Khóa VIP — thanh toán để mở toàn bộ khóa</span>`;
  document.getElementById("btn-done").disabled = true;
  document.getElementById("btn-done").textContent = "Khóa VIP";
  document.getElementById("btn-prev").disabled = (currentLessonIndex === 0);
  document.getElementById("btn-next").disabled = true;
  if (videoTimerId) clearInterval(videoTimerId);
}

function renderCoursePaymentForm(course, price, wasRejected) {
  const total = (course.lessons || []).length;
  return `
    <div class="vip-notice course-vip">
      ${wasRejected ? `<div class="vip-warn">⚠️ Lần thanh toán trước bị từ chối. Vui lòng kiểm tra lại nội dung chuyển khoản.</div>` : ""}
      <h3>👑 Khóa học VIP — mở toàn bộ ${total} bài</h3>
      <div class="vip-price">${formatVnd(price)}</div>
      <p class="vip-instructions">
        Thanh toán <strong>1 lần</strong> cho cả khóa. Admin duyệt xong, bạn xem được <strong>tất cả ${total} bài</strong> trong khóa này.
      </p>
      <button class="btn btn-primary" id="btn-show-qr">📱 Hiện QR thanh toán</button>
    </div>
  `;
}

function renderCoursePendingPayment(payment, course, price) {
  return `
    <div class="vip-notice pending course-vip">
      <h3>⏳ Đang chờ admin duyệt thanh toán khóa</h3>
      <p class="vip-instructions">
        Yêu cầu mua khóa <strong>${escapeHtml(course.title)}</strong> đã được gửi. Admin sẽ duyệt trong thời gian ngắn.
      </p>
      <div class="vip-info-row"><span>Số tiền:</span> <strong>${formatVnd(payment.amount)}</strong></div>
      <div class="vip-info-row"><span>Nội dung CK:</span> <strong>${escapeHtml(payment.transferContent)}</strong></div>
      <button class="btn btn-secondary" id="btn-show-qr">📱 Xem lại QR</button>
    </div>
  `;
}

function bindCoursePaymentButton(course, price) {
  const btn = document.getElementById("btn-show-qr");
  if (!btn) return;
  btn.addEventListener("click", () => showCoursePaymentModal(course, price));
}

async function showCoursePaymentModal(course, price) {
  let payment;
  try {
    payment = await createCoursePayment(
      currentUser.uid,
      currentUser.email,
      course.id,
      course.title,
      price
    );
  } catch (err) {
    flashMessage("Lỗi tạo yêu cầu thanh toán: " + err.message, "error");
    return;
  }

  const qrUrl = buildVietQrUrl(price, payment.transferContent);
  const totalLessons = (course.lessons || []).length;

  let modal = document.getElementById("payment-modal");
  if (modal) modal.remove();
  modal = document.createElement("div");
  modal.id = "payment-modal";
  modal.className = "modal-overlay active";
  modal.innerHTML = `
    <div class="modal payment-modal">
      <div class="modal-header">
        <h2>💳 Mua khóa "${escapeHtml(course.title)}"</h2>
        <button class="modal-close" data-close-payment>×</button>
      </div>
      <div class="modal-body">
        <div class="payment-qr-wrap">
          <img src="${qrUrl}" alt="QR thanh toán khóa" class="payment-qr" />
        </div>
        <div class="payment-info">
          <div class="payment-row"><span>Ngân hàng:</span> <strong>${escapeHtml(BANK_CONFIG.bankName)}</strong></div>
          <div class="payment-row"><span>Số tài khoản:</span> <strong>${escapeHtml(BANK_CONFIG.accountNo)}</strong></div>
          <div class="payment-row"><span>Tên chủ TK:</span> <strong>${escapeHtml(BANK_CONFIG.accountName)}</strong></div>
          <div class="payment-row highlight"><span>Số tiền:</span> <strong>${formatVnd(price)}</strong></div>
          <div class="payment-row highlight"><span>Nội dung CK:</span> <strong>${escapeHtml(payment.transferContent)}</strong></div>
          <div class="payment-row"><span>Bạn nhận được:</span> <strong style="color:var(--accent)">${totalLessons} bài học</strong></div>
        </div>
        <p class="payment-note">
          ⚠️ <strong>Quan trọng:</strong> Nhập <strong>đúng nội dung CK</strong> ở trên (bắt đầu bằng <code>AVAK</code>) để admin biết bạn mua khóa nào.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-close-payment>Đóng</button>
        <button class="btn btn-primary" id="btn-confirm-paid">✅ Tôi đã thanh toán</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll("[data-close-payment]").forEach(el => {
    el.addEventListener("click", () => modal.remove());
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  document.getElementById("btn-confirm-paid").addEventListener("click", () => {
    modal.remove();
    flashMessage("✓ Đã gửi yêu cầu mua khóa! Đang chờ admin duyệt...", "success");
    setTimeout(() => renderCourseVipPaymentNotice(course, currentLessons[currentLessonIndex]), 800);
  });
}

function renderBannedScreen(ban) {
  const until = new Date(ban.until).toLocaleString("vi-VN");
  showLockOverlay({
    title: "Tài khoản đang bị khóa",
    subtitle: `Bạn vi phạm cam kết học tập (quá 24h chưa hoàn thành bài). Còn lại <strong style="color:#fbbf24">${ban.daysLeft} ngày</strong>.`,
    hint: `Hết hạn lúc: ${until}`,
    actions: [
      { label: "← Về trang chủ", href: "home.html", primary: false },
      { label: "🏆 Xem bảng xếp hạng", href: "leaderboard.html", primary: true }
    ]
  });
}

// ============================================
// LOCKSCREEN OVERLAY (full-page mờ + icon ổ khóa lớn)
// ============================================
function showLockOverlay({ title, subtitle, hint, actions, dismissible }) {
  const old = document.getElementById("lock-overlay");
  if (old) old.remove();

  const overlay = document.createElement("div");
  overlay.id = "lock-overlay";
  overlay.className = "lock-overlay";
  overlay.innerHTML = `
    <div class="lock-overlay-inner">
      ${dismissible ? `<button class="lock-close" id="lock-close-btn" title="Đóng">×</button>` : ""}
      <div class="lock-icon-big">
        <svg viewBox="0 0 64 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 36V22C16 13.16 23.16 6 32 6C40.84 6 48 13.16 48 22V36" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
          <rect x="8" y="36" width="48" height="38" rx="6" stroke="currentColor" stroke-width="5" fill="none"/>
          <circle cx="32" cy="52" r="4" fill="currentColor"/>
          <path d="M32 56v8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        </svg>
      </div>
      <h1 class="lock-title">${title}</h1>
      <p class="lock-subtitle">${subtitle}</p>
      ${hint ? `<p class="lock-hint">${hint}</p>` : ""}
      <div class="lock-actions">
        ${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-primary' : 'btn-secondary'}" data-lock-action="${i}">${a.label}</button>`).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Bind actions
  actions.forEach((a, i) => {
    const btn = overlay.querySelector(`[data-lock-action="${i}"]`);
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (a.onClick) a.onClick();
      else if (a.href) location.href = a.href;
    });
  });

  // Close button
  const closeBtn = document.getElementById("lock-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => overlay.remove());
}

function hideLockOverlay() {
  const el = document.getElementById("lock-overlay");
  if (el) el.remove();
}

function renderExpiredNotice(lesson) {
  showLockOverlay({
    title: "⌛ Bài học đã khóa",
    subtitle: `Bài <strong>${escapeHtml(lesson.title)}</strong> đã quá 24h kể từ lúc được mở mà bạn chưa hoàn thành.`,
    hint: "Vi phạm này được ghi nhận. Liên hệ admin để mở lại.",
    dismissible: true,
    actions: [
      { label: "← Về trang chủ", primary: false, onClick: () => { hideLockOverlay(); location.href = "home.html"; } }
    ]
  });
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
      <p>Bạn không hoàn thành bài này trong 24h kể từ lúc được mở.</p>
      <p>Vui lòng liên hệ admin để được mở lại.</p>
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

function updatePausedHint(isPaused) {
  let hint = document.getElementById("timer-paused-hint");
  if (!hint) {
    const timerInfo = document.getElementById("timer-info");
    if (!timerInfo) return;
    hint = document.createElement("div");
    hint.id = "timer-paused-hint";
    hint.className = "timer-paused-hint";
    timerInfo.parentNode.insertBefore(hint, timerInfo.nextSibling);
  }
  if (isPaused) {
    hint.style.display = "block";
    hint.textContent = "⏸ Đang tạm dừng đếm — bạn đang ở tab khác hoặc cửa sổ khác. Quay lại trang này để tiếp tục đếm.";
  } else {
    hint.style.display = "none";
  }
}

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
    // Nếu bài kế tiếp là VIP, KHÔNG set timer (vì user phải pay trước)
    const nextId = (nextLesson && !nextLesson.isVip) ? nextLesson.id : null;
    const result = await markLessonCompleted(currentUser.uid, lesson.id, nextId);
    userProgress.completed = result.completed;
    userProgress.unlockedAt = result.unlockedAt;
    updateTimerUI();
    renderSidebar();

    const nextIdx = currentLessonIndex + 1;
    if (nextIdx < currentLessons.length) {
      flashMessage("✓ Đã hoàn thành! Chuyển sang bài tiếp theo...", "success");
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
    loadLesson(next); // loadLesson handle status check
  }
}
