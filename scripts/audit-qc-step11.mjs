import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  return fs.readFileSync(path.join(novelDir, `Chương ${n}.txt`), 'utf8');
}

console.log('=== KIỂM TRA QUỐC DANH C422 & C437 ===');
console.log('--- C422 VI ---');
getViCh(422).split(/\r?\n/).filter(l => l.includes('Nga') || l.includes('Liên Xô')).forEach(l => console.log('VI:', l.trim()));

console.log('--- C437 VI ---');
getViCh(437).split(/\r?\n/).filter(l => l.includes('Liên Xô') || l.includes('Nga')).forEach(l => console.log('VI:', l.trim()));

// Search raw around C422 and C437
const m1 = [...textRaw.matchAll(/俄羅斯|蘇聯|前蘇聯/g)];
console.log('\nRaw Russia/Soviet matches count:', m1.length);
m1.forEach(m => console.log(m[0], ':', JSON.stringify(textRaw.slice(m.index - 20, m.index + 40))));
