# QUY TẮC BẮT BUỘC KHI CẬP NHẬT / SỬA CHỮA / NÂNG CẤP TOOL DỊCH TRUYỆN

Khi người dùng gửi bất kỳ yêu cầu nào liên quan đến "cập nhật để sửa", "nâng cấp", "sửa lỗi", "tối ưu" hoặc bất kỳ thay đổi mã nguồn nào cho Tool:

---

## 1. QUY TẮC TIÊN QUYẾT: KHẢO SÁT, NÊU QUY TRÌNH & ĐỢI XÁC NHẬN (BẮT BUỘC)
**TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ Ý SỬA CODE NGAY KHI VỪA NHẬN YÊU CẦU.** 
Trước khi đụng vào bất kỳ file code nào, Agent BẮT BUỘC phải thực hiện đủ các bước sau và **DỪNG LẠI CHỜ NGƯỜI DÙNG PHÊ DUYỆT**:

1. **Nêu lại quy trình nâng cấp / sửa chữa dự kiến:**
   - Tóm tắt ngắn gọn các bước thực hiện theo quy chuẩn (Khảo sát -> Sửa code -> Chạy test & build -> Repack app.asar & triển khai bản thực tế).
2. **Khoanh vùng phạm vi ảnh hưởng (Root Cause & Location):**
   - Chỉ rõ chính xác file nào, module nào, hàm nào hoặc component / CSS layout nào chịu trách nhiệm (Ví dụ: lỗi bố cục thì khoanh vùng rõ component/file CSS nào; lỗi logic adapter thì chỉ rõ adapter/selector nào).
3. **Nêu chi tiết điểm cần sửa (Detailed Plan):**
   - Phân tích nguyên nhân cụ thể.
   - Nêu chi tiết phương án chỉnh sửa (dự kiến đổi dòng nào/đoạn nào, logic cũ chuyển sang logic mới ra sao, có tác dụng phụ hay rủi ro gì không).
4. **Chờ xác nhận từ người dùng:**
   - Trình bày toàn bộ thông tin trên một cách rõ ràng, mạch lạc và **dừng lại chờ người dùng phản hồi xác nhận** ("Đồng ý", "OK", "Tiến hành sửa"...).
   - **CHỈ ĐƯỢC PHÉP CHẠM VÀO CODE VÀ TIẾN HÀNH SỬA KHI VÀ CHỈ KHI NGƯỜI DÙNG ĐÃ XÁC NHẬN ĐỒNG Ý.**

---

## 2. QUY TRÌNH THỰC HIỆN KHI ĐÃ ĐƯỢC NGƯỜI DÙNG PHÊ DUYỆT (Definition of Done)

- **Bước 1: Cập nhật mã nguồn:** Sửa code chuẩn xác theo đúng phương án đã được duyệt, không tạo tác dụng phụ.
- **Bước 2: Kiểm thử toàn diện theo quy trình:**
  - Chạy đầy đủ các unit test / integration test liên quan (`vitest`).
  - Chạy kiểm tra kiểu dữ liệu (`tsc --noEmit`) và build dự án (`npm run build`).
- **Bước 3: Đóng gói và triển khai bản cài đặt thực tế:**
  - Nếu Tool đang mở hoặc đang chạy tiến trình:
    + Tạm dừng tiến trình sạch sẽ (bảo toàn checkpoint, không làm mất tiến độ của người dùng).
    + Tắt hẳn ứng dụng `ToolDichTruyen.exe` và các tiến trình liên quan.
  - Repack toàn bộ mã mới vào `app.asar`.
  - Ghi đè file `app.asar` mới nhất vào thư mục cài đặt thực tế trên máy:
    `%LOCALAPPDATA%\Programs\ToolDichTruyen\resources\app.asar`
    và đồng bộ `release\win-unpacked\resources\app.asar`.
  - Đồng bộ sang ổ `D:\Tool dịch truyện` và cập nhật gói cài đặt ZIP mới nhất `Downloads\ToolDichTruyen-v1.3.0-MoiNhat.zip`, chạy `node scripts/test-transfer-package.mjs` đạt 100%.
  - Nếu có tiến trình dịch đang dở dang: Đồng bộ bổ sung ngay các thực thể/bộ nhớ mới vào file Job để khi người dùng mở lại và bấm "Tiếp tục" là chạy ngay trên cơ chế mới, không bị lỗi và không phải dịch lại từ đầu.
- **Bước 4: Kiểm tra xác nhận cuối cùng:**
  - Xác nhận file thực tế trên máy đã cập nhật đúng timestamp và dung lượng mới.

---

## 3. TIÊU CHUẨN TÍNH LÀ HOÀN TẤT
- Chỉ được tính là "cập nhật sửa chữa / nâng cấp hoàn tất" khi Tool trên máy người dùng ĐÃ THỰC SỰ CÓ BẢN MỚI HOÀN TOÀN và sẵn sàng khởi chạy không có lỗi.
- Tuyệt đối KHÔNG chỉ sửa code trong file nguồn rồi báo hoàn tất khi app thực tế trên máy vẫn đang chạy bản cũ.
