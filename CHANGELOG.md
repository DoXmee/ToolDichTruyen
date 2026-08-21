# Changelog

Các thay đổi đáng chú ý của Tool Dịch Truyện được ghi lại tại đây.

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
