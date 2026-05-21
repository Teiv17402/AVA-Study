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

// Nếu đã đăng nhập thì redirect về home luôn
onAuthStateChanged(auth, async (user) => {
  if (user) {
    await ensureUserDoc(user);
    location.href = "home.html";
  }
});

const btn = document.getElementById("btn-google");
const btnText = document.getElementById("btn-google-text");

btn.addEventListener("click", async () => {
  btn.disabled = true;
  btnText.textContent = "Đang đăng nhập...";
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await ensureUserDoc(result.user);
    location.href = "home.html";
  } catch (err) {
    btn.disabled = false;
    btnText.textContent = "Đăng nhập bằng Google";
    if (err.code === "auth/popup-closed-by-user") return;
    alert("Lỗi đăng nhập: " + (err.message || err.code));
  }
});
