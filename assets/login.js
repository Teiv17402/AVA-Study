// ============================================
// LOGIN PAGE — Supabase OAuth redirect flow
// ============================================
import {
  signInWithGoogle,
  waitForAuth,
  ensureUserDoc
} from "./firebase.js";

// Nếu đã có session → redirect về home luôn
(async () => {
  const user = await waitForAuth();
  if (user) {
    await ensureUserDoc(user);
    location.href = "home.html";
  }
})();

const btn = document.getElementById("btn-google");
const btnText = document.getElementById("btn-google-text");

btn.addEventListener("click", async () => {
  btn.disabled = true;
  btnText.textContent = "Đang chuyển hướng...";
  try {
    await signInWithGoogle();
  } catch (err) {
    btn.disabled = false;
    btnText.textContent = "Đăng nhập bằng Google";
    alert("Lỗi đăng nhập: " + (err.message || err.code || err));
  }
});
