# Bảo mật và dữ liệu cục bộ

Không commit hoặc đính kèm vào issue công khai các dữ liệu sau:

- thư mục `userData` của Electron/Chromium;
- cookie, profile ChatGPT, `Local State`, `Login Data` hoặc cơ sở dữ liệu trình duyệt;
- `draft.json`, checkpoint trong `jobs/`, nội dung truyện và bản dịch;
- `.env`, Gemini API key hay bất kỳ token/mật khẩu nào;
- gói chuyển máy và log chẩn đoán có dữ liệu người dùng.

Khóa Gemini được mã hóa bằng Electron `safeStorage`/Windows DPAPI và không nên giải mã để di chuyển. Trên máy mới, hãy nhập lại khóa nếu cần dùng Gemini.

Khi báo lỗi bảo mật, hãy gửi mô tả đã lược che dữ liệu nhạy cảm cho chủ sở hữu repository qua kênh riêng. Repository này chưa công bố kênh tiếp nhận bảo mật cố định.
