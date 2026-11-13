import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  return fs.readFileSync(path.join(novelDir, `Chương ${n}.txt`), 'utf8');
}

console.log('=== KIỂM TRA TUỔI NỮ CHÍNH C132 & C184 ===');
console.log('--- C132 VI ---');
getViCh(132).split(/\r?\n/).filter(l => l.includes('tuổi') || l.includes('1970')).forEach(l => console.log('VI:', l.trim()));

console.log('--- C184 VI ---');
getViCh(184).split(/\r?\n/).filter(l => l.includes('tuổi') || l.includes('1972') || l.includes('mụ')).forEach(l => console.log('VI:', l.trim()));

// Search raw around C132 and C184
const m1 = [...textRaw.matchAll(/三歲|四歲|五歲|虛歲/g)];
console.log('\nRaw age matches count:', m1.length);
m1.filter(m => textRaw.slice(m.index - 20, m.index + 40).includes('舒舒')).slice(0, 10).forEach(m => {
  console.log('RAW:', JSON.stringify(textRaw.slice(m.index - 25, m.index + 45)));
});
