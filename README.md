# Học Online — Website học trực tuyến

Website học online với khóa học mở khóa bài tuần tự, host miễn phí trên GitHub Pages.

## Tính năng

- Trang chủ liệt kê khóa học dạng card đen-vàng
- Trang học có sidebar bên trái list bài + video bên phải
- Bài học mở khóa tuần tự — chỉ hoàn thành bài 1 mới mở bài 2
- Video embed từ Google Drive
- Tiến độ học lưu trên trình duyệt (LocalStorage)
- Responsive đẹp trên cả mobile/tablet/desktop

## Cấu trúc file

```
learning-site/
├── index.html          ← Trang chủ
├── course.html         ← Trang học chi tiết
├── data/
│   └── courses.json    ← TOÀN BỘ DỮ LIỆU KHÓA HỌC Ở ĐÂY
├── assets/
│   ├── style.css       ← Giao diện
│   └── app.js          ← Logic
└── README.md
```

## Cách thêm/sửa khóa học

Mở file `data/courses.json`. Mỗi khóa học có cấu trúc:

```json
{
  "id": "course-1",
  "title": "Tên khóa học",
  "description": "Mô tả ngắn",
  "level": "Cơ bản",
  "lessons": [
    {
      "id": "lesson-1-1",
      "title": "Bài 1: Tên bài",
      "driveFileId": "1abc...XYZ",
      "duration": 600,
      "description": "Mô tả bài học"
    }
  ]
}
```

**Lưu ý quan trọng:**
- `id` phải **duy nhất** cho mỗi khóa và mỗi bài (không trùng nhau)
- `driveFileId` là ID file Google Drive (xem hướng dẫn bên dưới)
- `duration` là thời lượng video tính bằng **giây** (ví dụ 10 phút = 600)
- Sau khi xem video 80% thời lượng, nút "Hoàn thành bài" sẽ hoạt động

## Cách lấy Google Drive File ID

1. Upload video MP4 lên Google Drive
2. Click chuột phải vào file → **Chia sẻ (Share)**
3. Đổi quyền sang **"Bất kỳ ai có liên kết" (Anyone with the link)** → quyền Viewer
4. Nhấn **Sao chép liên kết**, sẽ có dạng:
   ```
   https://drive.google.com/file/d/1abcDEFghiJKLmnoPQRstuVWXyz/view?usp=sharing
   ```
5. Phần **`1abcDEFghiJKLmnoPQRstuVWXyz`** chính là `driveFileId`

## Cách triển khai lên GitHub Pages

Xem hướng dẫn chi tiết trong chat. Tóm tắt:

1. Tạo tài khoản GitHub (nếu chưa có) tại github.com
2. Tạo repo mới (đặt public)
3. Upload toàn bộ folder `learning-site/` vào repo
4. Vào **Settings** → **Pages** → chọn nhánh `main` → bấm Save
5. Đợi ~1 phút, website sẽ chạy tại `https://<username>.github.io/<repo-name>/`

## Cách yêu cầu chỉnh sửa

Chỉ cần nhắn qua chat, ví dụ:
- "Thêm bài 6 vào khóa học 1, tên là 'Bài tập tổng hợp', drive ID là `1xyz...`, dài 12 phút"
- "Đổi tên khóa học 1 thành 'Khóa Excel cơ bản'"
- "Thêm 1 khóa học mới tên 'Photoshop nâng cao' có 8 bài"

Tôi sẽ sửa file `courses.json`, bạn chỉ cần upload file mới lên GitHub là website tự cập nhật.

## Test thử trên máy

Mở Terminal/Command Prompt tại folder này, chạy:

```bash
python -m http.server 8000
```

Sau đó mở trình duyệt vào `http://localhost:8000`.

## Reset tiến độ học

Nhấn nút **"↺ Reset tiến độ"** ở góc phải trên cùng để xóa toàn bộ tiến độ và học lại từ đầu.
