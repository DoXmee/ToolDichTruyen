# Source sạch sẵn sàng cho GitHub

Thư mục này được tạo theo allowlist: chỉ có source, test, prompt mặc định, cấu hình build và tài liệu. Nó không chứa `userData`, cookie, browser profile, draft, job, bản dịch, khóa API, `node_modules`, build hoặc release artifact.

Repository giữ `private: true` và `UNLICENSED`. Trước khi công khai, chủ sở hữu cần chọn license nếu muốn cho phép người khác sao chép/sửa/phân phối.

Kiểm tra cục bộ:

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
pnpm run test:e2e
```

Tạo repository và push sau khi đã có URL GitHub:

```powershell
git init -b main
git add .
git commit -m "Initial clean source import"
git remote add origin <GITHUB_REPOSITORY_URL>
git push -u origin main
```

Không copy gói `Migration-PRIVATE`, `%APPDATA%\tool-dich-truyen` hoặc file `.env` thật vào repository.

Lần xác minh bản giao này đã cài lại dependency từ lockfile trong thư mục trống, chạy 246 test không-live, typecheck, production build và Electron smoke thành công. Xem `SOURCE-VALIDATION.md`.
