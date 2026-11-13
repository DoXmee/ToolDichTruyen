import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textVi = fs.readFileSync(path.join(novelDir, 'Tổng hợp từ chương 1-478.txt'), 'utf8');
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  return fs.readFileSync(path.join(novelDir, `Chương ${n}.txt`), 'utf8');
}

console.log('=== KIỂM TRA C250 VI VÀ RAW ===');
const ch250 = getViCh(250);
ch250.split(/\r?\n/).filter(l => l.includes('Cát') || l.includes('Kha ăn')).forEach(l => console.log('VI:', l.trim()));

// Search raw for 葛
const matches = [...textRaw.matchAll(/葛[^\n]{0,30}(?:吃|咬)/g)];
console.log('Raw 葛 matches:', matches.length);
matches.forEach(m => console.log('RAW:', m[0]));

// Let's also search around 葛 in raw
const matchesG = [...textRaw.matchAll(/葛倩|葛嬸|葛姨|葛奶奶/g)];
console.log('Raw 葛 names matches:', matchesG.length);
matchesG.forEach(m => console.log(m[0], ':', JSON.stringify(textRaw.slice(m.index - 20, m.index + 40))));
