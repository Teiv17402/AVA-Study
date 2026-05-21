// ============================================
// LANDING PAGE — show 2 buttons OR auto-redirect to home
// ============================================
import { auth, onAuthStateChanged } from "./firebase.js";

const loading = document.getElementById("landing-loading");
const content = document.getElementById("landing-content");

// Nếu đã đăng nhập rồi (session Firebase còn) → vào thẳng trang home
// Nếu chưa → hiện landing với 2 button
onAuthStateChanged(auth, (user) => {
  if (user) {
    location.href = "home.html";
  } else {
    if (loading) loading.style.display = "none";
    if (content) content.style.display = "flex";
  }
});
