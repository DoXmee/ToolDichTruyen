# Kết quả xác minh source sạch 1.2.0

Thời điểm: 2026-08-12 (Asia/Saigon).

- Tạo bản sao cách ly chỉ từ allowlist: đạt.
- `pnpm install --frozen-lockfile` với pnpm 11.16.0: đạt.
- Typecheck Node + Web: đạt.
- Vitest: **24 file đạt, 3 live file bỏ qua; 246 test đạt, 7 live test bỏ qua**.
- Production build (main/preload/renderer): đạt.
- Electron E2E smoke: đạt, preload bridge 29 method, UI desktop/link/chia chương/narrow đều được kiểm tra.
- Quét token OpenAI/Google/GitHub/AWS, private key, email iCloud và password assignment: không phát hiện bí mật thật.
- Kiểm tra file Git staged: không có `node_modules`, build/release, userData, profile, draft, job, cookie hay file nén.

Các test live không chạy trong CI vì cần profile/phiên mạng riêng. Dữ liệu đó không thuộc repository.
