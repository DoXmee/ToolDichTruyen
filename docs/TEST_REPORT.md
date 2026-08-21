# Báo cáo kiểm thử — Tool Dịch Truyện 1.2.0

Ngày xác minh: **21/08/2026**
Môi trường: Windows x64, Electron 43.3.0, React 19.2.8, Node.js 24, TypeScript 7.

## Kết quả phát hành hiện tại

| Hạng mục | Kết quả | Ghi chú |
|---|---:|---|
| TypeScript main/preload/renderer | **Đạt** | `pnpm run typecheck` |
| Unit, integration và renderer | **469 đạt** | 13 ca live/phụ thuộc môi trường được bỏ qua theo cấu hình |
| Electron smoke | **Đạt** | 41 phương thức preload; sáng/tối, link truyện, màn hình hẹp và công cụ chia chương |
| Production build | **Đạt** | Main, preload và renderer production được build lại |
| App đang cài | **Đạt** | SHA-256 `13FE69F0E1904A1FB51DAF7E99E0DAB469983A2C609B47CA958CA4669BC6409C` |
| ZIP chuyển máy | **Đạt** | SHA-256 `0256D536D980B5C52706670AE69D4A3987075119BBD4EE90FD64206545F79891` |
| Payload ZIP so với app | **Trùng khớp** | `app.asar` trong ZIP có cùng SHA-256 với app đang chạy |
| Browser Helper | **Đạt** | Manifest 1.0.6; có cả cạnh app và ngoài cùng gói ZIP |
| Cài đặt trên đường dẫn Unicode | **Đạt** | Xóa marker bản cũ, cài bản mới, tạo shortcut và mở đúng executable |

## Phạm vi kiểm tra bắt buộc

- Checkpoint, pause/resume, retry và khôi phục sau khi renderer/app khởi động lại.
- Retry ChatGPT, xử lý phản hồi chữ Hán còn sót, lặp nội dung, tiêu đề sai và phản hồi an toàn.
- Tải mục lục/chương và lọc nội dung cho các adapter nguồn truyện được hỗ trợ.
- Ghép đủ các trang con của cùng một chương và chặn chuyển nhầm sang chương kế tiếp.
- Chia chương, đánh lại số, bỏ tên chương, chỉnh preview và xuất UTF-8/NFC.
- Xuất chương lẻ, bản dịch gốc chưa chia, file tổng bản dịch và file tổng chương nguồn.
- File tổng chương nguồn giữ nội dung chưa dịch, dải chương gốc và dải chương mới; tiếp tục tạo được sau khi khôi phục checkpoint.
- Xuất tự động không ghi đè file người dùng khác nội dung; xung đột được đưa vào thư mục khôi phục riêng.
- Giao diện sáng/tối, bố cục desktop/compact/narrow và preload IPC trong Electron thật.
- Gói chuyển máy xóa sạch thư mục app cũ nhưng giữ `%APPDATA%\tool-dich-truyen`, tạo shortcut Desktop và đặt extension ở ngoài cùng.

## Kiểm tra ZIP chuyển máy

Quy trình đã chạy trên chính file ZIP cuối cùng:

1. Tạo gói từ thư mục `win-unpacked` cùng bản build với app đang chạy.
2. Kiểm tra các entry bắt buộc, không có thư mục smoke test và không có lớp thư mục bọc thừa.
3. Đọc hash trực tiếp của `APP/ToolDichTruyen/resources/app.asar` trong ZIP.
4. Giải nén ZIP vào đường dẫn chứa dấu tiếng Việt.
5. Tạo một thư mục app cũ giả lập và marker cũ.
6. Chạy script cài đặt: marker cũ bị xóa, app/helper mới được chép đầy đủ.
7. Kiểm tra shortcut Unicode và mở shortcut để xác nhận đúng executable.

Live test gọi website/ChatGPT thật không chạy trong bộ mặc định vì cần phiên đăng nhập, mạng và thao tác xác minh của người dùng. Không coi test mock là bằng chứng vượt CAPTCHA hoặc xác minh website.
