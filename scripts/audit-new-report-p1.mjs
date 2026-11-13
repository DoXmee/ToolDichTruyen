import fs from 'node:fs';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = `${novelDir}/Tổng hợp từ chương 1-478.txt`;
const rawFile = `${novelDir}/File tổng c.gốc (1-150)_c.mới (1-478).txt`;

const transText = fs.readFileSync(combinedFile, 'utf8');
const rawText = fs.readFileSync(rawFile, 'utf8');

console.log('Trans length:', transText.length, 'Raw length:', rawText.length);

// Helper to get chapter text
function getTransChapter(num) {
  const h = `Chương ${num}`;
  const idx = transText.indexOf(h);
  if (idx === -1) return '';
  const nextH = `Chương ${num + 1}`;
  const nextIdx = transText.indexOf(nextH, idx + h.length);
  return nextIdx !== -1 ? transText.slice(idx, nextIdx) : transText.slice(idx);
}

// Search in raw
function searchRaw(term) {
  const matches = [];
  let pos = 0;
  while ((pos = rawText.indexOf(term, pos)) !== -1) {
    matches.push({ pos, snippet: rawText.slice(Math.max(0, pos - 80), pos + term.length + 120).replace(/\r?\n/g, ' ') });
    pos += term.length;
  }
  return matches;
}

console.log('\n--- 1. Kiểm tra 5 dòng mồi đầu chương ---');
[10, 12, 29, 32, 47].forEach(num => {
  const ch = getTransChapter(num);
  const lines = ch.split(/\r?\n/).filter(l => l.trim().length > 0);
  console.log(`Ch.${num} Header + First 2 lines:`);
  console.log('  Line 0:', lines[0]);
  console.log('  Line 1:', lines[1]);
  console.log('  Line 2:', lines[2]);
});

console.log('\n--- 2. Tên nhân vật ---');
// #1 Ch.243 Gầy Nhỏ vs Khỉ Gầy
const ch243 = getTransChapter(243);
console.log('#1 Ch.243 có Gầy Nhỏ?:', ch243.includes('Gầy Nhỏ'));
ch243.split(/\r?\n/).filter(l => l.includes('Gầy Nhỏ') || l.includes('Khỉ Gầy')).forEach(l => console.log('  Trans:', l.trim()));
console.log('  Raw matches for 瘦猴 around Ch.79-80:');
searchRaw('小瘦猴').forEach(m => console.log('   小瘦猴:', m.snippet));

// #2 Ch.310 năm bông hoa vàng nhà họ Trần vs nhà họ Lưu
const ch310 = getTransChapter(310);
console.log('\n#2 Ch.310 năm bông hoa vàng:');
ch310.split(/\r?\n/).filter(l => l.includes('bông hoa vàng') || l.includes('nhà họ Trần') || l.includes('nhà họ Lưu') || l.includes('Hai Nữu') || l.includes('Nhị Nữu')).forEach(l => console.log('  Trans:', l.trim()));
console.log('  Raw matches for 金花 (hoa vàng):');
searchRaw('金花').forEach(m => console.log('   金花:', m.snippet));

// #4 Ch.212 chú út vs chú hai
const ch212 = getTransChapter(212);
console.log('\n#4 Ch.212 chú út:');
ch212.split(/\r?\n/).filter(l => l.includes('chú út') || l.includes('chú hai') || l.includes('Trịnh Chí Cao')).forEach(l => console.log('  Trans:', l.trim()));
console.log('  Raw matches for 鄭志高 (Trịnh Chí Cao):');
searchRaw('鄭志高').forEach(m => console.log('   鄭志高:', m.snippet));
searchRaw('小叔').forEach(m => console.log('   小叔:', m.snippet));
searchRaw('二叔').forEach(m => console.log('   二叔:', m.snippet));

// #5 Ch.245 y tá trưởng vs giáo viên mầm non (Kha Tiểu Hoa)
const ch245 = getTransChapter(245);
console.log('\n#5 Ch.245 Kha Tiểu Hoa y tá trưởng:');
ch245.split(/\r?\n/).filter(l => l.includes('y tá trưởng') || l.includes('doanh nhân lớn') || l.includes('Kha Tiểu Hoa')).forEach(l => console.log('  Trans:', l.trim()));
console.log('  Raw search 護士長 (y tá trưởng):');
searchRaw('護士長').forEach(m => console.log('   護士長:', m.snippet));

// #6 Ch.250 anh Tử Hàn
const ch250 = getTransChapter(250);
console.log('\n#6 Ch.250 anh Tử Hàn:');
ch250.split(/\r?\n/).filter(l => l.includes('Tử Hàn') || l.includes('Tử Bình')).forEach(l => console.log('  Trans:', l.trim()));
console.log('  Raw search 子寒 (Tử Hàn) & 子平 (Tử Bình):');
searchRaw('子寒').forEach(m => console.log('   子寒:', m.snippet));
searchRaw('子平').forEach(m => console.log('   子平:', m.snippet));

// #7 Ch.405 Thời Hà Thời Trang
const ch405 = getTransChapter(405);
console.log('\n#7 Ch.405 Thời Hà:');
ch405.split(/\r?\n/).filter(l => l.includes('Thời Hà') || l.includes('thương hiệu')).forEach(l => console.log('  Trans:', l.trim()));
console.log('  Raw search 時霞 / 舒霞 / 舒 / 服裝:');
searchRaw('服裝品牌').forEach(m => console.log('   服裝品牌:', m.snippet));
searchRaw('霞').slice(0, 10).forEach(m => console.log('   霞:', m.snippet));

