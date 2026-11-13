import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  return fs.readFileSync(path.join(novelDir, `Chương ${n}.txt`), 'utf8');
}

console.log('=== KIỂM TRA C55 VAI VẾ ===');
const ch55 = getViCh(55);
ch55.split(/\r?\n/).filter(l => l.includes('vai vế') || l.includes('trưởng thôn')).forEach(l => console.log('VI:', l.trim()));

// Search raw around 輩分
const matches = [...textRaw.matchAll(/輩分/g)];
console.log('\nRaw 輩分 matches count:', matches.length);
matches.forEach(m => {
  console.log('RAW 輩分:', JSON.stringify(textRaw.slice(Math.max(0, m.index - 30), Math.min(textRaw.length, m.index + 50))));
});
