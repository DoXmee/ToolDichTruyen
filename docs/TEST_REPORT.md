# Báo cáo kiểm thử — Tool dịch truyện 1.2.0

Ngày kiểm thử: 12/08/2026
Môi trường: Windows x64, Electron 43.3.0, React 19.2.8, Node.js 24.14.0, TypeScript 7.0.2.

Trạng thái mã nguồn và bản ZIP dạng thư mục: **Đạt**. Hai wrapper EXE không ký được giữ làm lựa chọn phụ nhưng có thể bị Smart App Control chặn trước khi khởi chạy.

## Kết quả tự động

| Hạng mục | Kết quả | Phạm vi |
|---|---:|---|
| TypeScript strict | **Đạt** | `tsconfig.node.json` và `tsconfig.web.json` |
| Unit/integration/component | **275/275 đạt; 7 live test bỏ qua mặc định** | 24 file chạy đạt, 3 file live opt-in |
| Coverage tổng | **92,45% dòng** | 87,99% statement; 78,31% branch; 91,72% function |
| Coverage core | **98,50% dòng** | Splitter, parser, language, chunker, validator, prompt/retry |
| Electron E2E | **Đạt** | Renderer thật, preload 31 API, IPC, link importer, bố cục 1366 × 720 ở zoom 100%, font CJK, nhập liệu và chia chương |
| Live nguồn truyện | **5/5 đạt** | TimoTXT, Qingrenyouxi, Huliwang fail-safe; Xbanxia đạt riêng link bộ và link chương, gồm mẫu chương 1/82/164 |
| Live ChatGPT + cleanup | **2/2 đạt** | Dịch thật không còn chữ Hán; xóa đúng TARGET do test tạo, CONTROL còn nguyên trước khi được dọn riêng |
| ChatGPT clean-profile smoke | **Đạt** | Mở Edge thường, không cờ automation, trả `login-required`, không nhập tài khoản/cookie và không gửi nội dung |
| Production build | **Đạt** | Main ESM, preload CommonJS sandboxed, renderer production |
| Portable folder/ZIP | **Cần đóng gói lại khi được yêu cầu** | ZIP 1.2.0 hiện chưa nhận hotfix mới; bản thư mục kiểm thử production dùng 31 API. |
| NSIS và portable một file | **Bị chính sách máy chặn** | Smart App Control từ chối EXE `NotSigned`; không tắt/bypass bảo vệ Windows để ép chạy |

Coverage chi tiết:

```text
All files          Statements 87.99%  Branches 78.31%  Functions 91.72%  Lines 92.45%
Core               Statements 95.57%  Branches 83.10%  Functions 100%    Lines 98.50%
Translation runner Statements 80.31%  Branches 73.80%  Functions 84.50%  Lines 86.09%
```

## Phạm vi ca kiểm thử bắt buộc

- Chia tại 749/750/800/1.499/1.500/1.599/1.600/2.249/2.250/2.399/2.400 chữ và stress đến 10.000 chữ; chỉ dùng ranh giới đoạn xuống dòng, không cắt từ, câu hoặc lời thoại; CRLF/blank line và Unicode được giữ nguyên.
- Tiêu đề chương số Ả Rập/La Mã, Markdown, Unicode NFD và các false-positive “Chương trình”, “Bài học”, “Tập thể”.
- Phát hiện chữ Hán theo vị trí, phản hồi trống/lỗi/từ chối, lời dẫn, quá ngắn, bị cắt, lặp và echo nguyên văn.
- Một chat cho toàn job/book; prompt gốc chỉ xuất hiện một lần trong chat, các segment sau dùng continuation prompt.
- Sửa cục bộ đúng câu chứa 1–2 chữ Hán, thay theo offset ngay cả khi câu trùng; không fallback gửi lại toàn segment.
- Retry lỗi nặng, retry thủ công/restart với ngữ cảnh khôi phục tối đa 3.000 ký tự.
- Pause/resume đang chờ phản hồi, cancel lúc đang kết nối và checkpoint sau từng trạng thái.
- Đồng bộ snapshot nhẹ khi bỏ lỡ event, lần dịch thứ hai không bị `jobId` cũ chặn và renderer reload tự phục hồi job đang chạy.
- Sau từng segment hoàn tất, checkpoint/output được lưu bền và worker chia chương cập nhật preview song song khi segment tiếp theo còn đang dịch.
- Prompt UTF-8 có BOM/không BOM, chế độ prompt tùy chỉnh và ưu tiên chọn “Khác”.
- Draft UTF-8 ghi nguyên tử; Gemini key mã hóa; Gemini JSON thiếu/thừa/sai tiêu đề không ghi đè dữ liệu cũ.
- UI compact ở 1366 × 720/zoom 100%, chiều rộng hẹp, autosave, output editable, splitter non-destructive và tô chữ Hán.
- URL allowlist và parser cho bốn website; link bộ/chương, mục lục phân trang, default selection và ID selection validation.
- Xbanxia chỉ đọc `.book-list` và `#nr1`, loại mục `作品相關` khỏi lựa chọn mặc định, loại watermark/ghi chú tác giả cuối chương, chặn canonical sai và soft-200.
- Xbanxia live xác minh 165 mục/164 chương mặc định, tải sạch chương 1/82/164, link chương chọn đúng một mục; không dính watermark, navigation, đề xuất, form lỗi, HTML, Hangul, PUA hoặc U+FFFD.
- Huliwang passive/interactive Cloudflare, trang con `下一页`, merge overlap; TimoTXT transcode + font hash; Qingrenyouxi canonical/soft-200/GBK và container nội dung.
- Continuation liền kề cùng số được ghép cho Huliwang/Qingrenyouxi/TimoTXT chỉ khi có marker phần/tiếp rõ ràng; chương trùng số nhưng tiêu đề khác không bị ghép nhầm.
- Chương không số, trùng hoặc lùi số được cấp số header xuất tăng nghiêm ngặt để không mất ranh giới/file.
- Xuất UTF-8/NFC từng chương, sanitize tên Windows, atomic publish, không ghi đè file tồn tại và khôi phục auto-export sau restart.
- Font nội dung nguồn, bản dịch và chương có fallback CJK; kiểm tra computed style không còn dùng font serif cho nội dung biên tập.
- Ownership state v3 lưu URL/ID, thời điểm ghi nhận và SHA-256 của marker ngẫu nhiên `TDTOWN_<32 ký tự hex>`; không dùng hash toàn bộ prompt để đối chiếu DOM.
- Không có bản ghi cuộc chat thì không xóa; bản ghi hỏng, sai phiên bản, sai origin, sai ID hoặc thiếu ownership hash đều bị từ chối theo cơ chế fail-safe.
- Xóa cuộc chat chỉ sau khi URL/ID chính xác và marker sở hữu đang hiển thị cho ra SHA-256 khớp state; lỗi điều hướng, selector hoặc xác minh giữ nguyên bản ghi và không chuyển sang chat khác.
- Bản ghi cuộc chat do tool tạo tồn tại qua lần khởi động lại; cuộc chat vẫn được ghi nhận nếu phản hồi ChatGPT hết thời gian sau khi gửi thành công.
- Nút Stop ẩn/hiện, Copy ẩn hoặc đến muộn, DOM virtualize và Stop bị treo; chỉ Copy hiển thị trong đúng assistant turn mới được dùng làm tín hiệu hoàn tất.
- Khi một chat dài virtualize marker của turn cũ, phiên browser đã xác minh vẫn chỉ dùng/xóa đúng URL chat tool; browser/context mới vẫn buộc marker DOM để fail-safe.
- Sau khi mở chat mới, tool chờ turn cũ rời hẳn DOM React trước khi chụp baseline; regression và live chứng minh phản hồi đầu tiên không còn bị bỏ lỡ.
- Race hủy tại checkpoint khởi tạo/gửi/validate, lỗi click Stop, retry job cũ sau job mới; trạng thái `cancelled` được lưu bền và không retry chồng response.
- Bản build production hiện nạp preload bridge 31 API. ZIP 1.2.0 cũ không bị thay đổi trong hotfix này theo yêu cầu; chỉ đóng gói ZIP mới khi người dùng yêu cầu.

## Kết quả kiểm thử nguồn truyện live

- TimoTXT: catalog 37 chương; chương đầu decode sạch, không còn PUA/Hangul/U+FFFD.
- Qingrenyouxi: catalog 49 chương; direct chapter đúng canonical, nội dung sạch.
- Huliwang: phân tích và tải chương qua xác minh tự động; khi Cloudflare không tự qua thì trả trạng thái cần người dùng xác minh thay vì giả mạo CAPTCHA.
- Xbanxia: link bộ 165 mục/164 chương mặc định; ba mẫu đầu/giữa/cuối và link chương riêng đều sạch phần lề/watermark.

## Kết quả ChatGPT live và cleanup

- Profile sạch trả `login-required` mà không gửi nội dung hay đọc cookie.
- Profile xác thực dịch smoke thành công, validator không còn ký tự Hán.
- TARGET/CONTROL cho kết quả `targetDeleted=true`, `controlPreservedBeforeCleanup=true`, `controlCleaned=true`.
- Chỉ exact chat có URL/ID và ownership hash khớp được xóa; chat cá nhân không thuộc phạm vi.

## Đóng gói và chữ ký

- Bản portable dạng thư mục và ZIP đã được smoke trực tiếp; đây là đường chạy được khuyến nghị trên máy mới.
- Hai wrapper EXE có Authenticode `NotSigned`, vì vậy SmartScreen/Smart App Control có thể cảnh báo hoặc chặn. Không vô hiệu hóa bảo vệ Windows để ép chạy.
- SHA-256 phát hành được lưu trong `release/SHA256SUMS.txt`.

## Gemini

Gemini đạt bằng client mô phỏng cho batch, timeout và kiểm tra schema. Không gọi Gemini API thật vì workspace không có API key kiểm thử riêng.
