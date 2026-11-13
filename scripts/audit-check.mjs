import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,';
const fullPath = path.join(novelDir, 'Tổng hợp từ chương 1-996.txt');

console.log('=== BẮT ĐẦU KIỂM TRA SƠ BỘ TOÀN DIỆN BỘ TRUYỆN ===');

// 1. Kiểm tra file tổng hợp tồn tại & kích thước
if (!fs.existsSync(fullPath)) {
  console.error('LỖI: Không tìm thấy file tổng hợp!');
  process.exit(1);
}
const fullContent = fs.readFileSync(fullPath, 'utf8');
console.log(`1. File tổng hợp: TỒN TẠI (${fullContent.length} ký tự, ${Buffer.byteLength(fullContent, 'utf8')} bytes)`);

// 2. Kiểm tra dãy chương 1 -> 996
const chapterMatches = [...fullContent.matchAll(/(?:^|\n)Chương (\d+)/g)];
console.log(`2. Số lượng marker Chương nhận diện trong file tổng hợp: ${chapterMatches.length}`);
if (chapterMatches.length !== 996) {
  console.error('LỖI: Số chương khác 996!');
}
let seqOk = true;
for (let i = 0; i < chapterMatches.length; i++) {
  const num = Number(chapterMatches[i][1]);
  if (num !== i + 1) {
    console.error(`LỖI: Lệch số thứ tự chương tại vị trí ${i}: mong muốn ${i+1}, thực tế ${num}`);
    seqOk = false;
    break;
  }
}
if (seqOk) console.log('   ✓ Dãy chương liên tục 100% từ 1 đến 996, không khuyết, không lặp, không nhảy cóc.');

// 3. Kiểm tra 996 file chương lẻ
let missingCount = 0;
let emptyCount = 0;
let mismatchCount = 0;

const chapterBlocks = fullContent.split(/(?:^|\n)(?=Chương \d+)/g).filter(Boolean);

for (let i = 1; i <= 996; i++) {
  const chFile = path.join(novelDir, `Chương ${i}.txt`);
  if (!fs.existsSync(chFile)) {
    missingCount++;
  } else {
    const chContent = fs.readFileSync(chFile, 'utf8');
    if (chContent.trim().length === 0) emptyCount++;
    const expectedBlock = (chapterBlocks[i - 1] || '').trim();
    if (chContent.trim() !== expectedBlock) {
      mismatchCount++;
    }
  }
}
console.log('3. Kiểm tra 996 file chương lẻ:');
console.log(`   - File thiếu: ${missingCount}`);
console.log(`   - File rỗng: ${emptyCount}`);
console.log(`   - File lệch nội dung so với file tổng: ${mismatchCount}`);

// 4. Quét ký tự Hán còn sót
const hanRegex = /[\u4E00-\u9FFF\u3400-\u4DBF]/gu;
const hanMatches = fullContent.match(hanRegex) || [];
console.log(`4. Ký tự chữ Hán còn sót trong bài dịch: ${hanMatches.length}`);

// 5. Quét các lỗi tên riêng / thuật ngữ đã báo cáo
const suspicious = [
  'Thâm Puyến', 'Thâm Cuyến', 'Thường Tuyết', 'Tú Ngọc Trân',
  'đồng chí Thử', 'Đồng chí Thử', 'thím Hà', 'Thím Hà',
  'Bắp Ngô Tấn', 'Bào Mễ Đồn', 'thôn Bào Mễ',
  'Sư anh', 'sư anh', 'Hương Cảng', 'banh tra'
];
console.log('5. Quét các lỗi tên riêng / thuật ngữ:');
let typoFound = false;
for (const s of suspicious) {
  const count = (fullContent.match(new RegExp(s, 'g')) || []).length;
  if (count > 0) {
    console.log(`   ⚠️ Còn sót: ${s} (${count} lần)`);
    typoFound = true;
  }
}
if (!typoFound) {
  console.log('   ✓ Hoàn toàn sạch tất cả các lỗi tên riêng / biến thể đã báo cáo.');
}

// 6. Quét họ Chu vs Châu
const chauMatches = [...fullContent.matchAll(/(Quảng Châu)|(\bChâu\b)/gu)];
let qc = 0, cOnly = 0;
for (const m of chauMatches) {
  if (m[1]) qc++;
  else cOnly++;
}
console.log(`6. Kiểm tra họ Chu vs Châu: Quảng Châu = ${qc} (chuẩn), Châu sai = ${cOnly}`);

// 7. Quét dòng rác tác giả
const trashLines = fullContent.split('\n').filter(l => /^\s*\?\s+/u.test(l));
console.log(`7. Số dòng rác bắt đầu bằng emoji/dấu hỏi: ${trashLines.length}`);

// 8. Kiểm tra ngoặc kép và định dạng kỹ thuật
const openQuotes = (fullContent.match(/“/g) || []).length;
const closeQuotes = (fullContent.match(/”/g) || []).length;
console.log(`8. Định dạng dấu ngoặc kép: Mở “ = ${openQuotes}, Đóng ” = ${closeQuotes} (Chênh lệch: ${Math.abs(openQuotes - closeQuotes)})`);

const fullwidthStar = (fullContent.match(/＊/g) || []).length;
const fullwidthExcl = (fullContent.match(/！/g) || []).length;
const bookMarks = (fullContent.match(/[《》]/g) || []).length;
console.log(`   - Ký tự full-width ＊: ${fullwidthStar}`);
console.log(`   - Ký tự full-width ！: ${fullwidthExcl}`);
console.log(`   - Ký hiệu sách Trung 《 》: ${bookMarks}`);

console.log('=== KẾT THÚC KIỂM TRA SƠ BỘ ===');
