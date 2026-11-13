import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

console.log('=== KIỂM TRA TRẦN CHẤN HƯNG (C29, C62, C292) ===');
[29, 62, 292].forEach(c => {
  const text = fs.readFileSync(path.join(novelDir, `Chương ${c}.txt`), 'utf8');
  console.log(`\n--- Ch.${c} ---`);
  text.split(/\r?\n/).filter(l => l.includes('Chấn Hưng')).forEach(l => console.log('VI:', l.trim()));
});

const matches = [...textRaw.matchAll(/陳振興/g)];
console.log('\nRaw matches for 陳振興:', matches.length);
matches.forEach(m => {
  console.log('RAW:', JSON.stringify(textRaw.slice(m.index - 20, m.index + 60)));
});
