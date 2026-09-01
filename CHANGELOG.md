# Changelog

Các thay đổi đáng chú ý của Tool Dịch Truyện được ghi lại tại đây.

## [1.3.0] - 2026-09-01

### Thêm mới

- Thêm DeepSeek AI bên cạnh ChatGPT và Kimi AI, dùng cùng cơ chế checkpoint, kiểm tra phản hồi và tiếp tục tiến trình.
- Cho phép chọn nhóm cố định gồm một, hai hoặc ba chatbot; mặc định bật cả ba.
- Mở cả ba chatbot khi tiến trình lỗi để người dùng chọn bot cứu một lượt cho đúng đoạn, sau đó tự quay về nhóm cố định.
- Thêm nguồn Novel543, đọc mục lục an toàn và ghép đầy đủ các trang con của cùng chương.

### Sửa lỗi và cải thiện

- Giữ chatbot người dùng vừa chọn khi tạm dừng rồi tiếp tục, không tự nhảy về chatbot cũ.
- Ngăn DeepSeek reload và dịch lại từ đầu sau khi phản hồi hợp lệ đã hoàn tất.
- Chặn vòng lặp failover/retry giữa các chatbot đã hết lượt cho cùng một đoạn.
- Cải thiện xác minh phản hồi để loại nội dung lặp, phản hồi lỗi của AI và chương không khớp nguồn.
- Cảnh báo khi thư mục xuất đã chứa nội dung của truyện khác và bảo vệ file người dùng khỏi bị ghi đè.
- Sửa tải chương Xbanxia/Novel543, nội dung nhiều trang và các trường hợp chương đầu hoặc chương giữa bị thiếu/lặp.

### Kiểm thử

- 597 kiểm thử unit/integration/renderer đạt; 27 ca live phụ thuộc website, tài khoản hoặc thao tác xác minh được bỏ qua mặc định.
- 81 kiểm thử riêng cho chọn nhóm chatbot, khóa/mở lựa chọn, failover, bot cứu ngoài nhóm và checkpoint đều đạt.
- Production build, packaged Electron smoke và kiểm tra đồng bộ payload ZIP đều đạt.

## [1.2.0] - 2026-08-21

### Thêm mới

- Nhập link và tải chương từ Huliwang, XSZJ/爱下电子书, TimoTXT, Qingrenyouxi và Xbanxia.
- Bốn phong cách dịch đóng gói sẵn: niên đại, hiện đại, cổ trang và tu tiên.
- Nhật ký tiến trình, lịch sử checkpoint và thao tác tiếp tục/bắt đầu lại.
- Giao diện sáng/tối và zoom thích nghi theo vùng làm việc Windows.
- Đánh lại số chương, bỏ tên chương và chỉnh nội dung từng chương sau khi chia.
- Xuất file tổng chương nguồn theo mẫu dải số chương gốc và chương mới.

### Cải thiện

- Retry ChatGPT có khôi phục trang, chat mới và trình duyệt mới theo loại lỗi.
- Khôi phục xuất file sau khi tiến trình bị ngắt hoặc tiếp tục từ checkpoint.
- Lọc chặt nội dung đầu/cuối chương và ghép các trang con cùng chương.
- Gói chuyển máy đặt Browser Helper ngoài cùng và tạo shortcut Unicode an toàn.
- Shortcut Desktop dùng ICO độc lập có tên theo hash, xóa các shortcut cũ và làm mới cache icon Windows khi cập nhật.

### Kiểm thử

- 469 kiểm thử unit/integration/renderer đạt; 13 ca live được bỏ qua mặc định.
- Electron smoke xác minh 41 phương thức preload và các bố cục sáng/tối/compact/narrow.
- ZIP được giải nén và cài thử trên đường dẫn có dấu tiếng Việt; payload khớp app đang chạy.
