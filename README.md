# Personal Manager Hub

Ứng dụng quản lý cá nhân cao cấp tích hợp quản lý tài chính (thu nhập, nợ), kế hoạch tương lai, quản lý công việc (Kanban) kết hợp lưu trữ và đồng bộ hóa đám mây thông qua **Google Sheets**, tích hợp quét hóa đơn thông minh bằng AI OCR và đăng nhập bảo mật mã hóa cục bộ.

## 🚀 Các Tính Năng Chính
- **Dashboard Tổng Quan**: Theo dõi doanh số tài chính, tiến độ công việc, nợ nần qua biểu đồ trực quan (Chart.js).
- **Quản lý Thu nhập & Chi tiêu**: Thêm, sửa, xóa các khoản thu chi, phân loại chi tiết.
- **Quản lý Khoản nợ hai chiều**: Quản lý nợ phải trả và cho vay, theo dõi đợt thanh toán kèm thanh tiến độ.
- **Kế hoạch Tương lai**: Thiết lập mục tiêu ngắn/trung/dài hạn với danh sách milestone và phần trăm hoàn thành.
- **Công việc & Lưu trữ**: Bảng Kanban kéo thả, viết ghi chú nhanh, lưu tài liệu và tích hợp cẩm nang "Mẹo lưu trữ" khoa học.
- **Hỏi đáp cùng NotebookLM**: Xuất dữ liệu Markdown chuẩn hóa hoặc liên kết trực tiếp file Google Sheet làm nguồn học máy cho trợ lý AI NotebookLM.
- **Quét ảnh giao dịch (OCR)**: Trích xuất tự động thông tin từ hóa đơn/ảnh giao dịch ngân hàng (Tesseract.js) để tự điền form.
- **Bảo mật tuyệt đối**: Đăng nhập bằng Master Password, mã hóa AES (CryptoJS) toàn bộ dữ liệu lưu trữ cục bộ.

## 📂 Cấu Trúc Dự Án
- `index.html`: Cấu trúc trang web và giao diện các Tab.
- `style.css`: Giao diện Obsidian Dark Mode, Glassmorphism, animations và Responsive (Mobile Bottom Bar).
- `app.js`: Logic cốt lõi (State, LocalStorage, Mã hóa, Đồng bộ Sheets, OCR Tesseract.js, Kanban, Charts).

## 🛠️ Hướng Dẫn Sử Dụng Nhanh
1. Mở tệp `index.html` trực tiếp trên bất kỳ trình duyệt web nào (Chrome, Edge, Safari, Firefox).
2. Khi mở ứng dụng lần đầu tiên, hãy thiết lập **Mật khẩu chủ (Master Password)** để kích hoạt mã hóa bảo mật dữ liệu.
3. Để đồng bộ đám mây, chuyển sang Tab **Cài đặt**, copy mã Apps Script được cung cấp sẵn, dán vào một trang tính Google Sheet mới của bạn, xuất bản Web App và dán link vào ứng dụng!
