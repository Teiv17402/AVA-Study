// ============================================
// LOGIN PAGE LOGIC
// ============================================
import {
  auth,
  googleProvider,
  signInWithPopup,
  onAuthStateChanged,
  ensureUserDoc
} from "./firebase.js";

// Nếu đã đăng nhập thì redirect về Tổng quan luôn
onAuthStateChanged(auth, async (user) => {
  if (user) {
    await ensureUserDoc(user);
    location.href = "dashboard.html";
  }
});

const btn = document.getElementById("btn-google");
const btnText = document.getElementById("btn-google-text");

btn.addEventListener("click", async () => {
  btn.disabled = true;
  btnText.textContent = "Đang đăng nhập...";
  try {
    // signInWithPopup → wrapper signInWithGoogle → Supabase tự redirect browser sang Google
    // Sau khi login Google xong, Supabase callback redirect về dashboard.html
    // KHÔNG code thêm phía sau — page sẽ navigate đi
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    btn.disabled = false;
    btnText.textContent = "Đăng nhập bằng Google";
    if (err.code === "auth/popup-closed-by-user") return;
    alert("Lỗi đăng nhập: " + (err.message || err.code || err));
  }
});
