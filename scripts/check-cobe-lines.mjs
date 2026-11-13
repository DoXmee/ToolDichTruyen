import fs from 'node:fs';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const text = fs.readFileSync(`${novelDir}/Tổng hợp từ chương 1-478.txt`, 'utf8');

const idx415 = text.indexOf('Chương 415');
const idx478 = text.indexOf('Chương 478');
const textAdult = text.slice(idx415, idx478);

const lines = textAdult.split(/\r?\n/).filter(l => l.includes('cô bé') || l.includes('Cô bé'));

console.log('Total lines with cô bé in Ch.415-477:', lines.length);
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // check if line mentions another female child
  console.log(`[${i+1}] ${l.trim().slice(0, 100)}...`);
}
