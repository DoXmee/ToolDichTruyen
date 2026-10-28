# QUY TẮC CẬP NHẬT / SỬA CHỮA / NÂNG CẤP TOOL DỊCH TRUYỆN

Khi người dùng yêu cầu "cập nhật để sửa", "nâng cấp" hoặc bất kỳ thay đổi mã nguồn nào cho Tool:

1. **Quy trình thực hiện bắt buộc (Definition of Done):**
   - **Bước 1: Cập nhật mã nguồn:** Sửa code chuẩn xác, không tạo tác dụng phụ.
   - **Bước 2: Kiểm thử toàn diện theo quy trình:**
     - Chạy đầy đủ các unit test liên quan (`vitest`).
     - Chạy kiểm tra kiểu dữ liệu (`tsc`) và build dự án (`npm run build`).
   - **Bước 3: Đóng gói và triển khai bản cài đặt thực tế:**
     - Nếu Tool đang mở hoặc đang chạy tiến trình:
       + Tạm dừng tiến trình sạch sẽ (bảo toàn checkpoint).
       + Tắt hẳn ứng dụng `ToolDichTruyen.exe` và các tiến trình liên quan.
     - Repack toàn bộ mã mới vào `app.asar`.
     - Ghi đè file `app.asar` mới nhất vào thư mục cài đặt thực tế trên máy:
       `%LOCALAPPDATA%\Programs\ToolDichTruyen\resources\app.asar`
       và đồng bộ `release\win-unpacked\resources\app.asar`.
     - Nếu có tiến trình dịch đang dở dang: Đồng bộ bổ sung ngay các thực thể/bộ nhớ mới vào file Job để khi người dùng mở lại và bấm "Tiếp tục" là chạy ngay trên cơ chế mới, không bị lỗi và không phải dịch lại từ đầu.
   - **Bước 4: Kiểm tra xác nhận cuối cùng:**
     - Xác nhận file thực tế trên máy đã cập nhật đúng timestamp và dung lượng mới.

2. **Tiêu chuẩn tính là HOÀN TẤT:**
   - Chỉ được tính là "cập nhật sửa chữa / nâng cấp hoàn tất" khi Tool trên máy người dùng ĐÃ THỰC SỰ CÓ BẢN MỚI HOÀN TOÀN và sẵn sàng khởi chạy không có lỗi.
   - Tuyệt đối KHÔNG chỉ sửa code trong file nguồn rồi báo hoàn tất khi app thực tế trên máy vẫn đang chạy bản cũ.
