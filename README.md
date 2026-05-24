# Học Online v2 — Có đăng nhập + Trang quản trị

Website học trực tuyến với:

- Đăng nhập bằng Google (Firebase Auth)
- Khóa học, bài học lưu trên Firestore
- Trang admin quản lý khóa học, bài học, người dùng
- Tiến độ học đồng bộ giữa các thiết bị
- Video host trên Google Drive

Toàn bộ MIỄN PHÍ. Không cần backend riêng.

## Cấu trúc file

```
learning-site/
├── index.html         ← Trang chủ (list khóa học)
├── course.html        ← Trang học (sidebar + video)
├── admin.html         ← Trang quản trị (chỉ admin)
├── login.html         ← Trang đăng nhập
├── assets/
│   ├── firebase.js    ← Khởi tạo Firebase + helpers
│   ├── app.js         ← Header, utils
│   ├── home.js        ← Logic trang chủ
│   ├── course.js      ← Logic trang học
│   ├── login.js       ← Logic đăng nhập
│   ├── admin.js       ← Logic admin
│   └── style.css      ← Giao diện đen-vàng
├── firebase-setup/
│   └── firestore.rules  ← Security Rules (copy vào Firebase Console)
└── README.md
```

## Hướng dẫn deploy

### 1. Upload lên GitHub

- Vào repo `AVA-Study` trên GitHub
- Xóa các file cũ (giữ lại `.git` nếu có)
- Upload toàn bộ file mới (đè lên)
- Commit changes
- GitHub Pages tự build lại sau ~1 phút

### 2. Set Firestore Security Rules

⚠️ **BƯỚC NÀY QUAN TRỌNG** — Nếu không set rules, web không đọc được data.

1. Vào https://console.firebase.google.com → project `ava-study`
2. Menu trái → **Firestore Database** → tab **Rules**
3. Xóa toàn bộ nội dung cũ
4. Mở file `firebase-setup/firestore.rules` (trong repo này), copy toàn bộ nội dung
5. Paste vào Firebase Rules editor
6. Bấm **Publish**

### 3. Đăng nhập lần đầu

1. Mở web: `https://teiv17402.github.io/AVA-Study/`
2. Tự động redirect sang `login.html`
3. Bấm "Đăng nhập bằng Google" → đăng nhập bằng tài khoản `lehoangviet.17042002@gmail.com`
4. Vì email này là admin nên header sẽ có thêm nút **"⚙ Quản trị"**

### 4. Tạo khóa học đầu tiên

1. Bấm **Quản trị** trên header
2. Bấm **+ Thêm khóa học** → nhập tên + mô tả → Lưu
3. Trong khóa vừa tạo, bấm **+ Thêm bài** → nhập:
   - Tên bài
   - Google Drive File ID (xem hướng dẫn bên dưới)
   - Thời lượng (giây)
   - Mô tả
4. Lưu. Quay lại trang chủ là thấy.

## Cách lấy Google Drive File ID

1. Upload video MP4 lên Google Drive
2. Click chuột phải → **Chia sẻ** → đổi thành **"Bất kỳ ai có liên kết"** quyền **Người xem**
3. Bấm **Sao chép liên kết** — sẽ có dạng:
   ```
   https://drive.google.com/file/d/1abcDEFghiJKLmnoPQRstuVWXyz/view?usp=sharing
   ```
4. Phần giữa `/d/` và `/view` là File ID — copy vào ô "Google Drive File ID"

## Phân quyền

- **Admin:** chỉ email `lehoangviet.17042002@gmail.com` (cấu hình trong `assets/firebase.js`, mục `ADMIN_EMAILS`)
- **User:** mọi email khác đăng nhập Google đều thành user thường, chỉ học được, không vào được admin

### Thêm admin mới

Mở `assets/firebase.js`, sửa:

```javascript
export const ADMIN_EMAILS = [
  "lehoangviet.17042002@gmail.com",
  "newadmin@gmail.com"  // ← thêm dòng này
];
```

Đồng thời sửa `firebase-setup/firestore.rules` cho phép admin mới:

```
function isAdmin() {
  return isSignedIn() && (
    request.auth.token.email == "lehoangviet.17042002@gmail.com" ||
    request.auth.token.email == "newadmin@gmail.com"
  );
}
```

Rồi publish lại Rules trên Firebase Console.

## Các vấn đề thường gặp

### "Permission denied" khi load khóa học
→ Chưa set Firestore Rules. Làm lại Bước 2 phần Deploy.

### Đăng nhập xong vẫn redirect về login
→ Domain `teiv17402.github.io` chưa được add vào **Authorized domains** của Firebase Auth. Vào Firebase Console → Authentication → Settings → Authorized domains → Add domain.

### Bấm "Quản trị" thấy báo không có quyền
→ Email đang đăng nhập KHÁC với email trong `ADMIN_EMAILS`. Đăng xuất, đăng nhập lại bằng đúng email admin.

### Video không play
→ Kiểm tra:
1. File Drive đã share **"Bất kỳ ai có liên kết"** chưa?
2. File ID có đúng không? (copy chính xác phần giữa `/d/` và `/view`)


<!-- supabase-migration build trigger 1779560264215 -->

<!-- deploy trigger: 2026-05-24T08:25:44.1176781Z -->
