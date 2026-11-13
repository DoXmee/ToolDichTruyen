import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

console.log('=== KIỂM TRA MẸ THIẾT ĐẢN (HÀ) ===');
[174, 180, 181].forEach(c => {
  const text = fs.readFileSync(path.join(novelDir, `Chương ${c}.txt`), 'utf8');
  console.log(`\n--- Ch.${c} ---`);
  text.split(/\r?\n/).filter(l => l.includes('Hà') && (l.includes('bác') || l.includes('thím') || l.includes('Thiết Đản'))).forEach(l => console.log('VI:', l.trim()));
});

// Search raw for 何 (Hà)
const matches = [...textRaw.matchAll(/何嬸|何嫂|何大嬸/g)];
console.log('Raw 何嬸/何嫂 matches count:', matches.length);
matches.forEach(m => {
  console.log(m[0], ':', JSON.stringify(textRaw.slice(m.index - 20, m.index + 40)));
});
