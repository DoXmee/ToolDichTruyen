import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  return fs.readFileSync(path.join(novelDir, `Chương ${n}.txt`), 'utf8');
}

console.log('=== KIỂM TRA KẾ TOÁN THÔN TRONG C107 & C208 ===');
const ch107 = getViCh(107);
console.log('--- C107 VI ---');
ch107.split(/\r?\n/).filter(l => l.includes('kế toán')).forEach(l => console.log('  VI:', l.trim()));

const ch208 = getViCh(208);
console.log('--- C208 VI ---');
ch208.split(/\r?\n/).filter(l => l.includes('kế toán')).forEach(l => console.log('  VI:', l.trim()));

// Search raw for 会计 (kế toán)
const matches = [...textRaw.matchAll(/會計/g)];
console.log('\nRaw matches for 會計:', matches.length);
matches.forEach(m => {
  console.log('RAW 會計:', JSON.stringify(textRaw.slice(Math.max(0, m.index - 30), Math.min(textRaw.length, m.index + 50))));
});
