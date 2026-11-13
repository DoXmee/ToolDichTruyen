import fs from 'node:fs';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const text = fs.readFileSync(`${novelDir}/Tổng hợp từ chương 1-478.txt`, 'utf8');

const idx415 = text.indexOf('Chương 415');
const idx478 = text.indexOf('Chương 478');
const textAdult = text.slice(idx415, idx478);

const lines = textAdult.split(/\r?\n/);
const dialogueLines = [];
const proseLines = [];

for (const l of lines) {
  if (l.includes('cô bé')) {
    if (l.includes('“') || l.includes('"')) {
      dialogueLines.push(l.trim());
    } else {
      proseLines.push(l.trim());
    }
  }
}

console.log('Dialogue lines with "cô bé":', dialogueLines.length);
dialogueLines.forEach(l => console.log('  [THOẠI]', l));
console.log('\nProse lines with "cô bé":', proseLines.length);
