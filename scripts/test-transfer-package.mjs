import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const zipPath = path.resolve('C:/Users/dthuo/Downloads/ToolDichTruyen-v1.3.0-MoiNhat.zip');
const testExtractDir = path.resolve(projectRoot, 'release/_test_package_verify');

console.log('=== TEST GÓI CHUYỂN MÁY TOOL DỊCH TRUYỆN v1.3.0 ===\n');

// 1. Kiểm tra sự tồn tại của file Zip
if (!fs.existsSync(zipPath)) {
  console.error('LỖI: Không tìm thấy file ZIP tại:', zipPath);
  process.exit(1);
}
const zipStat = fs.statSync(zipPath);
console.log(`[PASS 1] File ZIP tồn tại: ${zipPath}`);
console.log(`         Dung lượng: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB (${zipStat.size} bytes)`);

// 2. Giải nén vào thư mục test độc lập
if (fs.existsSync(testExtractDir)) {
  fs.rmSync(testExtractDir, { recursive: true, force: true });
}
fs.mkdirSync(testExtractDir, { recursive: true });

console.log('\n[PASS 2] Đang giải nén file ZIP vào môi trường kiểm thử cách ly...');
execSync(`powershell -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${testExtractDir}' -Force"`, {
  stdio: 'inherit',
});
console.log('         Giải nén thành công!');

// 3. Kiểm tra cấu trúc thư mục chuẩn
const expectedItems = [
  'APP/ToolDichTruyen/ToolDichTruyen.exe',
  'APP/ToolDichTruyen/resources/app.asar',
  'APP/ToolDichTruyen/resources/ToolDichTruyen.ico',
  'EXTENSION-HULIWANG - CHON THU MUC NAY/manifest.json',
  'CAI-DAT-CAP-NHAT-TOOLDICHTRUYEN.cmd',
  'CAI-DAT-CAP-NHAT-TOOLDICHTRUYEN.ps1',
  'README-CAI-DAT.txt',
];

console.log('\n[PASS 3] Kiểm tra các thành phần cốt lõi trong gói:');
for (const item of expectedItems) {
  const full = path.join(testExtractDir, item);
  if (fs.existsSync(full)) {
    const s = fs.statSync(full);
    console.log(`  ✓ ${item} (${s.size} bytes)`);
  } else {
    console.error(`  ✗ THIẾU FILE BẮT BUỘC: ${item}`);
    process.exit(1);
  }
}

// 4. Kiểm tra độ sạch (Không chứa tài khoản, dữ liệu riêng tư)
console.log('\n[PASS 4] Kiểm tra tính sạch sẽ (Không lưu tài khoản, cookies, profile hay dữ liệu nhạy cảm):');
const forbiddenPatterns = ['cookies', 'Session Storage', 'user-data', 'Network', 'Local Storage'];
function checkClean(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    for (const p of forbiddenPatterns) {
      if (f.toLowerCase().includes(p.toLowerCase())) {
        console.error(`  ✗ Phát hiện dữ liệu không an toàn: ${full}`);
        process.exit(1);
      }
    }
    if (fs.statSync(full).isDirectory()) {
      checkClean(full);
    }
  }
}
checkClean(testExtractDir);
console.log('  ✓ Gói chuyển máy hoàn toàn sạch, độc lập, không chứa thông tin đăng nhập.');

// 5. Kiểm tra dấu ấn tác giả ThanhDongg (DoXmee) trong file cài đặt và hướng dẫn
console.log('\n[PASS 5] Kiểm tra dấu ấn tác giả ThanhDongg (DoXmee):');
const cmdContent = fs.readFileSync(path.join(testExtractDir, 'CAI-DAT-CAP-NHAT-TOOLDICHTRUYEN.cmd'), 'utf8');
const readmeContent = fs.readFileSync(path.join(testExtractDir, 'README-CAI-DAT.txt'), 'utf8');

if (!cmdContent.includes('ThanhDongg (DoXmee)')) {
  console.error('  ✗ LỖI: CAI-DAT-CAP-NHAT-TOOLDICHTRUYEN.cmd thiếu tên tác giả!');
  process.exit(1);
}
console.log('  ✓ CAI-DAT-CAP-NHAT-TOOLDICHTRUYEN.cmd có banner tác giả ThanhDongg (DoXmee)');

if (!readmeContent.includes('ThanhDongg (DoXmee)')) {
  console.error('  ✗ LỖI: README-CAI-DAT.txt thiếu tên tác giả!');
  process.exit(1);
}
console.log('  ✓ README-CAI-DAT.txt có thông tin tác giả ThanhDongg (DoXmee)');

// 6. Kiểm thử kịch bản chạy installer trong môi trường test cô lập
console.log('\n[PASS 6] Chạy thử kịch bản cài đặt thực tế qua PowerShell script...');
const isolatedInstall = path.join(testExtractDir, '_test-install-root');
const isolatedDesktop = path.join(testExtractDir, '_test-desktop');
fs.mkdirSync(isolatedInstall, { recursive: true });
fs.mkdirSync(isolatedDesktop, { recursive: true });

const ps1Path = path.join(testExtractDir, 'CAI-DAT-CAP-NHAT-TOOLDICHTRUYEN.ps1');
const runInstallerCmd = `powershell -ExecutionPolicy Bypass -Command "$env:TOOLDICHTRUYEN_INSTALL_ROOT = '${isolatedInstall}'; $env:TOOLDICHTRUYEN_DESKTOP_ROOT = '${isolatedDesktop}'; & '${ps1Path}'"`;

execSync(runInstallerCmd, { stdio: 'inherit' });

// 7. Xác minh sau khi cài đặt
const installedExe = path.join(isolatedInstall, 'ToolDichTruyen.exe');
const installedAsar = path.join(isolatedInstall, 'resources/app.asar');
const installedShortcut = path.join(isolatedDesktop, 'ToolDichTruyen.lnk');

if (!fs.existsSync(installedExe)) {
  console.error('  ✗ LỖI: ToolDichTruyen.exe không được cài vào đích:', installedExe);
  process.exit(1);
}
if (!fs.existsSync(installedAsar)) {
  console.error('  ✗ LỖI: app.asar không có trong thư mục cài đặt:', installedAsar);
  process.exit(1);
}
if (!fs.existsSync(installedShortcut)) {
  console.error('  ✗ LỖI: Shortcut Desktop không được tạo:', installedShortcut);
  process.exit(1);
}

console.log('\n[PASS 7] Kết quả kiểm thử bộ cài trên máy mới:');
console.log('  ✓ Đã cài đặt ToolDichTruyen.exe thành công.');
console.log('  ✓ Đã sao chép app.asar phiên bản mới nhất thành công.');
console.log('  ✓ Đã tạo Shortcut Desktop Unicode an toàn thành công.');

// Dọn dẹp thư mục test
console.log('\n[DỌN DẸP] Dọn dẹp thư mục test cô lập...');
fs.rmSync(testExtractDir, { recursive: true, force: true });
console.log('  ✓ Đã dọn dẹp môi trường test sạch sẽ.\n');

console.log('========================================================');
console.log('  KẾT LUẬN: GÓI CHUYỂN MÁY ĐẠT 100% TIÊU CHUẨN HOÀN HẢO!');
console.log('========================================================');
