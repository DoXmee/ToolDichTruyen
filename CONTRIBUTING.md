# Đóng góp

## Trước khi tạo pull request

1. Không đưa cookie, profile trình duyệt, checkpoint, bản dịch, khóa API hoặc gói build vào Git.
2. Cài dependency bằng `pnpm install --frozen-lockfile`.
3. Chạy `pnpm run typecheck`, `pnpm test` và `pnpm run build`.
4. Nếu thay đổi hành vi người dùng, bổ sung hoặc cập nhật test tương ứng.

## Quy ước thay đổi

- Giữ pull request nhỏ, mô tả rõ hành vi cũ và mới.
- Không thay đổi cơ chế tự động hoá trình duyệt để vượt CAPTCHA, đăng nhập hay xác minh của website.
- Thay đổi nguồn truyện cần nêu rõ URL mẫu, nhưng không đính kèm dữ liệu phiên đăng nhập.
