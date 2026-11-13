import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');

const text = fs.readFileSync(combinedFile, 'utf8');

console.log('--- 1. Kiểm tra Ch.405 Thời Hà ---');
const matches405 = [...text.matchAll(/Thời Hà/g)];
console.log('Thời Hà count:', matches405.length);
matches405.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

console.log('\n--- 2. Kiểm tra Ch.243 Gầy Nhỏ ---');
const matches243 = [...text.matchAll(/Gầy Nhỏ/g)];
console.log('Gầy Nhỏ count:', matches243.length);
matches243.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

console.log('\n--- 3. Kiểm tra Ch.310 Chị Hai Nữu ---');
const matches310 = [...text.matchAll(/Chị Hai Nữu/g)];
console.log('Chị Hai Nữu count:', matches310.length);
matches310.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

console.log('\n--- 4. Kiểm tra 5 dòng mồi ---');
const linesToCheck = [
  { ch: 10, pattern: /Chương 10\r?\n\r?\nHay là chúng ta mở một trường mẫu giáo cho Thư Thư nhé\?\r?\n\r?\n/ },
  { ch: 12, pattern: /Chương 12\r?\n\r?\nThư Thư nói, cô hy vọng tất cả mọi người trong thôn đều có thể sống một cuộc sống ấm no, hạnh phúc\.\r?\n\r?\n/ },
  { ch: 29, pattern: /Chương 29\r?\n\r?\nCô bé còn có cả những hình nhân gỗ biết đánh nhau nữa\.\r?\n\r?\n/ },
  { ch: 32, pattern: /Chương 32\r?\n\r?\nĐiều đó chứng tỏ các cô bé có ý thức tự bảo vệ bản thân rất tốt, đáng khen!\r?\n\r?\n/ },
  { ch: 47, pattern: /Chương 47\r?\n\r?\n“Cún ơi, chúng mình đi hái hoa nhé…”\r?\n\r?\n/ }
];

linesToCheck.forEach(item => {
  const m = text.match(item.pattern);
  console.log(`Ch.${item.ch} match:`, !!m, m ? JSON.stringify(m[0]) : 'NONE');
});

console.log('\n--- 5. Kiểm tra Ch.312 (Bragi) ---');
const matches312 = [...text.matchAll(/\(Bragi\)/g)];
console.log('(Bragi) count:', matches312.length);
matches312.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

console.log('\n--- 6. Kiểm tra Ch.212 chú út ---');
const matches212 = [...text.matchAll(/chú út/g)];
console.log('chú út count:', matches212.length);
matches212.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));
