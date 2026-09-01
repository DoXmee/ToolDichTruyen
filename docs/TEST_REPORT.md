# Báo cáo kiểm thử — Tool Dịch Truyện 1.3.0

Ngày xác minh: **01/09/2026**
Môi trường: Windows x64, Electron 43.3.0, React 19.2.8, Node.js 24, TypeScript 7.

## Kết quả phát hành hiện tại

| Hạng mục | Kết quả | Ghi chú |
|---|---:|---|
| TypeScript main/preload/renderer | **Đạt** | `pnpm run typecheck` |
| Unit, integration và renderer | **597 đạt** | 27 ca live/phụ thuộc môi trường được bỏ qua theo cấu hình |
| Nhóm chatbot và failover | **81 đạt** | ChatGPT/Kimi/DeepSeek, nhóm 1–3 bot, khóa lựa chọn, bot cứu một lượt và checkpoint |
| Electron smoke | **Đạt** | 47 phương thức preload; bản packaged 1.3.0 mở và nạp đủ prompt |
| Production build | **Đạt** | Main, preload và renderer production được build lại |
| Portable 1.3.0 | **Đạt** | SHA-256 `CAE9B106A3FBA645305F479FF53ECB5E5D0965EEDB03B33FEA5253542F7B5F2B` |
| ZIP chuyển máy | **Đạt** | SHA-256 `F37ECE3E2E5FBF38F432D9739F95F1F4F1D45AAA7DB16213BD2CDBD3BBFCB897` |
| Payload ZIP so với app | **Trùng khớp** | `app.asar` cùng SHA-256 `39DA8B26C38C819CA83F1AF0FD34DFF3E6F164A2B03D501C40C39DC5C82A8AC7` |
| Browser Helper | **Đạt** | Manifest 1.0.7, có Novel543 helper và có cả cạnh app lẫn ngoài cùng gói ZIP |
| Cài đặt trên đường dẫn Unicode | **Đạt** | Xóa marker bản cũ, cài bản mới, tạo shortcut và xác minh Target/Icon |
| Logo Desktop sau nâng cấp | **Đạt** | Xóa ba biến thể shortcut cũ; shortcut mới dùng ICO tên theo hash `29B307D1186E` và làm mới cache Explorer |

## Phạm vi kiểm tra bắt buộc

- Checkpoint, pause/resume, retry và khôi phục sau khi renderer/app khởi động lại.
- Retry ChatGPT/Kimi/DeepSeek, xử lý phản hồi chữ Hán còn sót, lặp nội dung, tiêu đề sai và phản hồi an toàn.
- Nhóm chatbot cố định, khóa lựa chọn khi chạy, mở cả ba khi lỗi và bot ngoài nhóm cứu đúng một lượt.
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
7. Kiểm tra shortcut Unicode; bộ cài tự đọc ngược shortcut để xác nhận đúng executable và file ICO.
8. Giả lập Desktop có cả ba tên shortcut cũ (liền chữ, có dấu và không dấu); sau cập nhật chỉ còn một shortcut mới.

Live test gọi website/chatbot thật không chạy trong bộ mặc định vì cần phiên đăng nhập, mạng và thao tác xác minh của người dùng. Không coi test mock là bằng chứng vượt CAPTCHA hoặc xác minh website.
