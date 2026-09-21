# Changelog

Các thay đổi đáng chú ý của Tool Dịch Truyện được ghi lại tại đây.

## [Chưa phát hành]

### Thêm mới

- Thêm Gemini AI làm chatbot dịch thứ tư, ngang hàng ChatGPT/Kimi/DeepSeek: profile trình duyệt riêng, đăng nhập Google riêng và cùng cơ chế checkpoint.
- Nâng nhóm chatbot cố định lên tối đa bốn lựa chọn, mặc định bật cả bốn; Gemini tham gia đầy đủ vào retry, failover trong nhóm và bot cứu ngoài nhóm.

### Kiểm thử

- Bổ sung kiểm thử chọn/đổi sang Gemini, gửi prompt qua đúng phiên Gemini, nhãn lỗi riêng và lưu Gemini trong checkpoint cùng nhóm bốn chatbot.

### Đã xác minh bằng chạy thật với gemini.google.com

- Chương ngắn (`第一章 初次见面 / 你好。今天天气很好，我们一起去图书馆看书。`): dịch xong trong **13,3 giây**, bản dịch sạch, không lẫn chữ giao diện.
- Chương dài 1.725 chữ Hán: dịch xong trong **72 giây**, trả về 6.088 ký tự tiếng Việt trọn vẹn từ đầu đến cuối chương.
- Sửa hai lỗi chỉ lộ ra khi chạy thật: `div[aria-live="polite"]` khớp vào vùng đọc màn hình luôn tồn tại nên chat mới bị coi là còn nội dung cũ; và selector người dùng bị lồng nhau nên tool tưởng chat mới có nhiều tin nhắn.
- Bổ sung nhận diện nhãn tiếng Việt của giao diện Google (Gửi / Dừng / Sao chép), dùng cờ `aria-busy` để không cắt sớm phản hồi, và đổi tên bot trong cả chuỗi nguyên nhân của thông báo lỗi.
- Ghim model vào bản **Pro mới nhất**: trước mỗi lượt gửi, tool đọc bảng chọn model của Gemini, tự chuyển nếu đang ở Flash, Flash-Lite hoặc chế độ "Tư duy mở rộng", rồi đọc lại để xác minh. Nếu tài khoản không có model Pro nào, bảng chọn không mở được, hoặc chọn xong mà model không đổi, tool dừng và báo lỗi kèm danh sách model nó nhìn thấy — không tự ý dịch bằng model khác.
- Thí nghiệm 4 chương thật (1.150 / 2.008 / 5.047 chữ Hán) và một chương mẫu, mỗi cấu hình gửi y nguyên prompt của tool nhưng gửi tay một lần: **Flash lỗi 7/14 lần** (4 lần viết lại gây lặp nội dung, 3 lần từ chối trả lời ở các chương tình cảm), **Flash-Lite 0/14**, **Pro 0/8**. Đây là căn cứ để đổi ưu tiên sang Pro.
- Dọn phản hồi Gemini bị viết lại giữa chừng: khi chương dài, Gemini đôi lúc bỏ dở đoạn mở đầu rồi viết lại từ đầu và trang giữ cả hai, khiến bản dịch bị lặp đoạn đầu. Tool nhận diện tiêu đề chương bị lặp ở sát đầu văn bản và chỉ giữ bản hoàn chỉnh.
- Bỏ yêu cầu URL hội thoại cho Gemini: Google đã ngừng đưa ID chat vào địa chỉ trang (đo thật 2026-09-20: gửi tin xong URL vẫn là `gemini.google.com/app`), nên tool trước đó chặn mọi lượt gửi. Giờ chat được nhận diện bằng **dấu sở hữu** mà tool gắn vào prompt và đọc lại được từ trang.
- Hệ quả của thay đổi trên: tool **không tự xoá** chat Gemini nữa (không có URL để quay lại và chứng minh chat nào sắp xoá), và sau khi khởi động lại app giữa chừng thì tool mở chat mới rồi gửi lại prompt gốc thay vì quay về chat cũ.
- Đọc tên model Gemini từ `aria-label` của nút chọn model: Google chuyển tên model khỏi ô nhãn ngắn (ô đó giờ chỉ còn chữ "Gemini"), khiến tool tưởng chưa phải Pro và báo lỗi dù đã chọn đúng.
- Chờ DOM ổn định khi xác minh chat mới: hội thoại cũ có thể còn hiện trong lúc chat mới thay vào, trước đây tool coi đó là "chat có nhiều tin nhắn" và bỏ đoạn oan.
- Thêm bộ chẩn đoán tự động: khi kiểm tra model hoặc URL thất bại, tool ghi ảnh chụp trang vào `gemini-diagnostic.json` trong thư mục dữ liệu ứng dụng.
- Xử lý hết hạn mức Gemini: tool đọc mốc đặt lại hạn mức Gemini ghi trong bảng chọn và phản ứng theo nhóm AI của tiến trình — còn AI khác thì **tự chuyển sang AI đó** và dịch tiếp; chỉ có Gemini thì **tạm dừng kèm thông báo hết hạn mức và mốc thử lại**, giữ nguyên mọi đoạn đã dịch để bấm Tiếp tục là chạy tiếp. Trước đây trường hợp này báo lỗi kỹ thuật của trình duyệt rồi đánh dấu hỏng cả tiến trình.
- Quản lý nhiều tài khoản cho từng chatbot: nút `Tài khoản (n)` trên thanh công cụ mở bảng liệt kê tài khoản đã lưu kèm tên, email/gói và trạng thái hạn mức; chọn tay tài khoản nào thì dùng tài khoản đó.
- Thanh công cụ không còn nút `Kết nối`: nút `Tài khoản` nằm ở vị trí đó. Chọn chatbot chỉ đổi lựa chọn và **không mở trình duyệt**; chỉ nút `Thêm tài khoản` mới mở trình duyệt để đăng nhập.
- Đăng nhập tự động được ghi nhận: sau khi đăng nhập trong cửa sổ vừa mở và đóng cửa sổ đó, tool tự tiếp quản profile, đọc tài khoản và lưu vào danh sách — không cần bấm thêm.
- Chưa có tài khoản mà bấm `Bắt đầu dịch`: nút vẫn bấm được, tool hiện thông báo yêu cầu thêm tài khoản và tự mở bảng tài khoản.
- Trong bảng tài khoản có nút `Kiểm tra kết nối` thay cho nút cũ trên thanh công cụ.
- Xoay vòng tài khoản khi hết hạn mức: tài khoản 1 lỗi thì tự chuyển sang tài khoản 2 rồi 3, **không quay lại tài khoản đã lỗi**; hết cả danh sách mới chuyển sang chatbot khác nếu tiến trình có chọn bot đó, còn nếu chỉ có một bot thì tạm dừng kèm mốc đặt lại hạn mức. Mỗi tài khoản chỉ tốn đúng một lượt thử cho mỗi đoạn.
- Tài khoản được đọc tự động từ trình duyệt khi bấm `Kiểm tra kết nối` (Gemini lấy email, ChatGPT lấy tên và gói), nên phiên đăng nhập bạn vừa thực hiện sẽ được lưu ngay; Kimi và DeepSeek thì đặt tên thủ công khi thêm.
- Nút `Thêm tài khoản` mở trình duyệt để đăng nhập; nút thùng rác xoá tài khoản khỏi danh sách; nút `Dọn rác` chỉ dọn cache của mọi profile (không xoá tài khoản, không mất phiên đăng nhập).
- Bốn profile có sẵn từ các bản trước tự động trở thành "Tài khoản 1" của mỗi bot, không phải đăng nhập lại.

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
