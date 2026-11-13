import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');

const text = fs.readFileSync(combinedFile, 'utf8');

const tests = [
  { name: 'Ch.405 Thư Hà Thời Trang (không còn Thời Hà)', check: text.includes('Thư Hà Thời Trang') && !text.includes('Thời Hà') },
  { name: 'Ch.243 Khỉ Gầy (không còn Gầy Nhỏ)', check: !text.includes('Gầy Nhỏ') && text.includes('Chỉ có Khỉ Gầy vì bất cẩn') },
  { name: 'Ch.310 Chị Nhị Nữu (không còn Chị Hai Nữu)', check: !text.includes('Chị Hai Nữu') && text.includes('“Chị Nhị Nữu, chị không sao chứ?”') },
  { name: 'Ch.312 sạch (Bragi)', check: !text.includes('(Bragi)') && text.includes('chiếc váy liền kiểu Liên Xô, nền trắng') },
  { name: 'Huyện không còn sót "Nhất Trung"', check: !text.includes('Nhất Trung') },
  { name: 'Ch.10 mở đầu sạch', check: text.includes('Chương 10\r\n\r\n“Đi học là gì ạ? Có vui không?”') },
  { name: 'Ch.12 mở đầu sạch', check: text.includes('Chương 12\r\n\r\nCon gà quay đột nhiên có thêm') },
  { name: 'Ch.29 mở đầu sạch', check: text.includes('Chương 29\r\n\r\nThư Thư bưng bát nước đường') },
  { name: 'Ch.32 mở đầu sạch', check: text.includes('Chương 32\r\n\r\nBan đầu, Trần Phát Triển không định') },
  { name: 'Ch.47 mở đầu sạch', check: text.includes('Chương 47\r\n\r\n“Ha ha ha…”') },
  { name: 'Ch.212 chú hai Trịnh Chí Cao chuẩn xác', check: text.includes('chuẩn bị hôn lễ cho chú hai. Buổi chiều tan học') && text.includes('Thế là cậu bỏ lỡ cảnh chú hai trở về thôn.') }
];

console.log('=== KIỂM THỬ TỔNG THỂ ĐỢT SỬA ĐỔI THỨ 3 ===');
let passCount = 0;
for (const t of tests) {
  const ok = t.check;
  if (ok) passCount++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${t.name}`);
}

// Kiểm tra 5 file chương độc lập
const ch10 = fs.readFileSync(path.join(novelDir, 'Chương 10.txt'), 'utf8');
const ch243 = fs.readFileSync(path.join(novelDir, 'Chương 243.txt'), 'utf8');
const ch310 = fs.readFileSync(path.join(novelDir, 'Chương 310.txt'), 'utf8');
const ch312 = fs.readFileSync(path.join(novelDir, 'Chương 312.txt'), 'utf8');
const ch405 = fs.readFileSync(path.join(novelDir, 'Chương 405.txt'), 'utf8');

const fileChecks = [
  ch10.startsWith('Chương 10\r\n\r\n“Đi học là gì ạ?'),
  ch243.includes('Chỉ có Khỉ Gầy vì bất cẩn'),
  ch310.includes('“Chị Nhị Nữu, chị không sao chứ?”'),
  ch312.includes('chiếc váy liền kiểu Liên Xô, nền trắng'),
  ch405.includes('Thư Hà Thời Trang')
];

console.log('\n--- Kiểm tra 5 file chương rời rạc ---');
console.log('Chương 10:', fileChecks[0]);
console.log('Chương 243:', fileChecks[1]);
console.log('Chương 310:', fileChecks[2]);
console.log('Chương 312:', fileChecks[3]);
console.log('Chương 405:', fileChecks[4]);

if (passCount === tests.length && fileChecks.every(Boolean)) {
  console.log('\n>>> TOÀN BỘ 100% CÁC HẠNG MỤC ĐỢT 3 ĐẠT CHUẨN HOÀN TOÀN! <<<');
} else {
  console.log('\n>>> CÓ HẠNG MỤC CHƯA ĐẠT! <<<');
}
