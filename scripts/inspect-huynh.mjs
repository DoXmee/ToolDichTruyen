import fs from 'fs';

const novelPath = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt';
const content = fs.readFileSync(novelPath, 'utf8');

const lines = content.split('\n');
console.log('--- HUYNH OCCURRENCES ---');
lines.forEach((l, idx) => {
  if (/\b(huynh|Huynh)\b/u.test(l)) {
    console.log(`Line ${idx + 1}: ${l.trim()}`);
  }
});
