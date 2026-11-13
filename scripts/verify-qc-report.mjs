import fs from 'node:fs';

const content = fs.readFileSync('C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt', 'utf8');

console.log('=== XÁC MINH CÁC LỖI TRONG BÁO CÁO QC MỚI NHẤT ===\n');

// 1. Dấu --- đôi
const doubleDashes = content.match(/---\s*\r?\n\s*---/g) || [];
console.log('1. Dấu --- đôi (C10, C22, C123):', doubleDashes.length, 'vị trí');

// 2. Chính tả / dính chữ
const typos = [
  ['giãy giy', 'giãy giy (C46)'],
  ['nhaim', 'cắn một miếng táo nhaim (C90)'],
  ['trong lúcTrong lúc', 'trong lúcTrong lúc (C129)'],
  ['sự mặt củaanh Chu', 'sự mặt củaanh Chu (C163)'],
  ['vừaểnh tai', 'vừaểnh tai (C168)']
];

console.log('\n2. Lỗi chính tả / dính chữ:');
for (const [t, desc] of typos) {
  const p = content.indexOf(t);
  console.log(`- ${desc}: ${p !== -1 ? 'CÓ THẬT' : 'KHÔNG TỒN TẠI'}`);
  if (p !== -1) {
    console.log(`  Minh chứng: "${content.slice(Math.max(0, p - 30), Math.min(content.length, p + t.length + 30)).replace(/\r?\n/g, ' ')}"`);
  }
}

// 3. Mở đầu C924 chữ thường
console.log('\n3. Mở đầu C924:');
const p924 = content.indexOf('Chương 924');
if (p924 !== -1) {
  const excerpt = content.slice(p924, p924 + 100).replace(/\r?\n/g, ' ');
  console.log(`  Minh chứng: "${excerpt}"`);
}

// 4. Các câu thiếu ngoặc kép mở
console.log('\n4. Thiếu ngoặc kép mở:');
const quoteChecks = [
  'Lục Thời Quân, ba anh em bọn họ cùng với Thẩm Thương Tuyết',
  'Tiểu Lục này, cháu thật sự không ở lại ăn cơm sao?',
  'Bây giờ thì khác rồi, chính sách đã nới lỏng',
  'Hồi còn ở quê, tôi từng nghe nói',
  'Đoàn trưởng, sao anh lại… mau vào nhà đi',
  'Khương Đoàn trưởng, sao anh lại tới đây?',
  'Không lâu sau đâu, họ liền dẫn theo',
  'Phó doanh trưởng, chuyện này'
];

for (const q of quoteChecks) {
  const p = content.indexOf(q);
  console.log(`- "${q.slice(0, 35)}...": ${p !== -1 ? 'CÓ THẬT' : 'KHÔNG TỒN TẠI'}`);
  if (p !== -1) {
    console.log(`  Minh chứng: "${content.slice(Math.max(0, p - 10), Math.min(content.length, p + q.length + 20)).replace(/\r?\n/g, ' ')}"`);
  }
}

// 5. C253 ngoặc hệ thống
console.log('\n5. C253 ngoặc hệ thống:');
const p253 = content.indexOf('Đối tượng chinh phục tân thủ Lục Thời Hoài đã mất kiểm soát');
if (p253 !== -1) {
  console.log(`  Minh chứng C253: "${content.slice(Math.max(0, p253 - 10), Math.min(content.length, p253 + 120)).replace(/\r?\n/g, ' ')}"`);
}

// 6. C6 thiếu thoại sau 'là lối:'
console.log('\n6. C6 lời dẫn kết thúc bằng "là lối:":');
const p6 = content.indexOf('là lối:');
if (p6 !== -1) {
  console.log(`  Minh chứng C6: "${content.slice(Math.max(0, p6 - 40), Math.min(content.length, p6 + 100)).replace(/\r?\n/g, ' ')}"`);
}
