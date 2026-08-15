# Cài Huli Browser Helper vào Microsoft Edge hoặc Google Chrome

Tiện ích này cho phép Tool Dịch Truyện đọc đúng trang Huliwang trong **hồ sơ trình duyệt bạn đang dùng hằng ngày**. Tiện ích không dùng Playwright, remote debugging hay trình duyệt ẩn danh; không đọc/xuất cookie, lịch sử hoặc mật khẩu; không tự bấm CAPTCHA.

## Chrome

1. Mở `chrome://extensions`.
2. Bật **Chế độ dành cho nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén**.
4. Chọn nguyên thư mục `Huli Browser Helper` này (thư mục nằm ngay cạnh `ToolDichTruyen.exe`).

## Sau khi cập nhật tool

Nếu Huli Browser Helper đã được tải trước đó, mở trang tiện ích của trình duyệt và bấm **Tải lại / Reload** ở thẻ `Tool Dịch Truyện - Huli Browser Helper` trước khi dùng lại. Việc này nạp các cải tiến như đọc nút **Trang sau** JavaScript trong mục lục Huliwang; không cần cài lại hay cấp thêm quyền.

## Edge

1. Mở `edge://extensions`.
2. Bật **Chế độ nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén**.
4. Chọn nguyên thư mục `Huli Browser Helper` này (thư mục nằm ngay cạnh `ToolDichTruyen.exe`).

ID cố định của tiện ích là `pnokdbiaajanoohgcaleeedhijgjkmhd`.

## Sử dụng

1. Mở Tool Dịch Truyện và chọn kết nối Huliwang bằng Microsoft Edge hoặc Google Chrome mặc định.
2. Tool mở một trang ghép nối cục bộ `127.0.0.1`; tiện ích lấy phiên ghép nối rồi xóa phần bí mật khỏi thanh địa chỉ ngay lập tức.
3. Tool yêu cầu tiện ích mở Huliwang trong chính tab đó. Nếu Cloudflare chỉ kiểm tra trình duyệt, hãy chờ trang tự tải xong. Tiện ích không bấm CAPTCHA.
4. Sau khi ghép nối, các chương tiếp theo được đọc tuần tự trong cùng tab/profile thường; tab không bị đưa ra trước màn hình.

Nếu biểu tượng tiện ích báo mất kết nối, giữ Tool Dịch Truyện đang mở rồi ghép nối lại. Phiên ghép nối chỉ lưu trong `chrome.storage.session`, không đồng bộ lên tài khoản trình duyệt.

## Quyền riêng tư

- Quyền API duy nhất là `storage`, chỉ dùng `chrome.storage.session` cho phiên ghép nối tạm thời.
- Tiện ích chỉ có quyền trên `m.huliwang.net`, `www.huliwang.net` và bridge cục bộ `127.0.0.1`.
- Không xin quyền `tabs`: theo [tài liệu Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs), thao tác tạo/chuyển URL tab không cần quyền này; quyền host hẹp ở trên đủ để đọc URL của đúng tab Huli/ghép nối.
- Không có quyền cookie, lịch sử, mật khẩu, debugger, webRequest hoặc scripting.
