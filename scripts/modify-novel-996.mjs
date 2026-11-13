import fs from 'fs';
import path from 'path';

const novelPath = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt';
let content = fs.readFileSync(novelPath, 'utf8');

console.log('Original length:', content.length);

// 1. Check "nàng"
const nangMatches = [...content.matchAll(/\b(nàng|Nàng)\b/gu)];
console.log('Total nang matches:', nangMatches.length);
const nangTho = [...content.matchAll(/\b(nàng|Nàng)\s+thơ\b/gu)];
console.log('nàng thơ matches:', nangTho.length);
const coNang = [...content.matchAll(/\b(cô|Cô)\s+(nàng|Nàng)\b/gu)];
console.log('cô nàng matches:', coNang.length);

// 2. Check "chàng"
const changMatches = [...content.matchAll(/\b(chàng|Chàng)\b/gu)];
console.log('Total chang matches:', changMatches.length);
const changTrai = [...content.matchAll(/\b(chàng|Chàng)\s+trai\b/gu)];
console.log('chàng trai matches:', changTrai.length);

// 3. Check Ch.753 La Vân dialogue
const ch753Pos = content.indexOf('Chương 753');
const ch754Pos = content.indexOf('Chương 754');
if (ch753Pos !== -1 && ch754Pos !== -1) {
  const ch753Text = content.slice(ch753Pos, ch754Pos);
  console.log('Ch.753 found. Length:', ch753Text.length);
  const laVanLines = ch753Text.split('\n').filter(l => l.includes('hợp tác với') || l.includes('La Vân') || l.includes('công lao của'));
  console.log('La Van lines in Ch.753:', laVanLines);
}

// 4. Check Ch.335 megaphone
const ch335Pos = content.indexOf('Chương 335');
const ch336Pos = content.indexOf('Chương 336');
if (ch335Pos !== -1 && ch336Pos !== -1) {
  const ch335Text = content.slice(ch335Pos, ch336Pos);
  const megaphoneLines = ch335Text.split('\n').filter(l => l.includes('Áo bán mười lăm') || l.includes('đừng mắc lừa'));
  console.log('Megaphone lines in Ch.335:', megaphoneLines);
}

// 5. Check Trợ lý Đầu Trọc
const dauTrocMatches = [...content.matchAll(/Trợ lý Đầu Trọc/gu)];
console.log('Trợ lý Đầu Trọc matches:', dauTrocMatches.length);

// 6. Check Ch.996 end
const ch996Pos = content.indexOf('Chương 996');
if (ch996Pos !== -1) {
  const ch996End = content.slice(content.length - 300);
  console.log('End of novel preview:\n', ch996End);
}
