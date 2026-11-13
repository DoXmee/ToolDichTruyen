import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedVi = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');
const combinedRaw = path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt');

const textVi = fs.readFileSync(combinedVi, 'utf8');
const textRaw = fs.readFileSync(combinedRaw, 'utf8');

console.log('Vi text length:', textVi.length);
console.log('Raw text length:', textRaw.length);

// Helper to get Vi chapter
function getViChapter(num) {
  const chFile = path.join(novelDir, `Chương ${num}.txt`);
  if (fs.existsSync(chFile)) return fs.readFileSync(chFile, 'utf8');
  const start = textVi.indexOf(`Chương ${num}\r\n`) !== -1 ? textVi.indexOf(`Chương ${num}\r\n`) : textVi.indexOf(`Chương ${num}\n`);
  const nextNum = num + 1;
  const end = textVi.indexOf(`Chương ${nextNum}\r\n`) !== -1 ? textVi.indexOf(`Chương ${nextNum}\r\n`) : textVi.indexOf(`Chương ${nextNum}\n`);
  return end !== -1 ? textVi.slice(start, end) : textVi.slice(start);
}

// 1. Kiểm tra "thím Trần" (mẹ Kha Tiểu Hoa vs mẹ Phương Kiều Kiều)
console.log('\n=== 1. KIỂM TRA "THÍM TRẦN" ===');
const ch14Vi = getViChapter(14);
console.log('Ch.14 mẹ Kha Tiểu Hoa Vi:');
ch14Vi.split(/\r?\n/).filter(l => l.includes('Trần') || l.includes('thím') || l.includes('Kha')).slice(0, 8).forEach(l => console.log('  VI:', l.trim()));

// Let's find Ch.14 in raw or search for Kha Tiểu Hoa's mother in raw
console.log('\nTìm kiếm mẹ Kha Tiểu Hoa trong raw:');
// Search for 柯小花 and 陳 or 嬸
const rawMatches = [...textRaw.matchAll(/柯小花[^\n]{0,80}(?:陳|嬸|媽|娘)[^\n]{0,80}/g)];
console.log('Raw matches count near 柯小花:', rawMatches.length);
rawMatches.slice(0, 5).forEach(m => console.log('  RAW:', m[0]));
