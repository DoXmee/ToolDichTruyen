import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  return fs.readFileSync(path.join(novelDir, `Chương ${n}.txt`), 'utf8');
}

console.log('=== KIỂM TRA NGHỀ KIẾP TRƯỚC KHA TIỂU HOA ===');
console.log('--- C10 VI ---');
getViCh(10).split(/\r?\n/).filter(l => l.includes('mầm non') || l.includes('giáo viên')).forEach(l => console.log('VI:', l.trim()));

console.log('--- C43 VI ---');
getViCh(43).split(/\r?\n/).filter(l => l.includes('mầm non') || l.includes('giáo viên')).forEach(l => console.log('VI:', l.trim()));

console.log('--- C245 VI ---');
getViCh(245).split(/\r?\n/).filter(l => l.includes('y tá') || l.includes('Kha Tiểu Hoa')).forEach(l => console.log('VI:', l.trim()));

// Search raw for 幼師 (giáo viên mầm non) and 護士長 (y tá trưởng)
const m1 = [...textRaw.matchAll(/幼師|幼兒園老師/g)];
console.log('\nRaw 幼師 matches:', m1.length);
m1.forEach(m => console.log('RAW 幼師:', JSON.stringify(textRaw.slice(m.index - 20, m.index + 50))));

const m2 = [...textRaw.matchAll(/護士長/g)];
console.log('\nRaw 護士長 matches:', m2.length);
m2.forEach(m => console.log('RAW 護士長:', JSON.stringify(textRaw.slice(m.index - 40, m.index + 60))));
