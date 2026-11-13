import fs from 'fs';
import path from 'path';

const novelPath = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt';
const dir = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,';

const content = fs.readFileSync(novelPath, 'utf8');

// Match all chapters: starts with "Chương " followed by number
// Chapters can be split by finding the indices of "\nChương " or "^Chương "
const regex = /(?:^|\r?\n)(Chương\s+(\d+)[^\r\n]*)/gu;
const matches = [...content.matchAll(regex)];

console.log('Total chapter headers found:', matches.length);

if (matches.length !== 996) {
  throw new Error(`Expected 996 chapters, found ${matches.length}`);
}

let written = 0;
for (let i = 0; i < matches.length; i++) {
  const match = matches[i];
  const chapterNum = parseInt(match[2], 10);
  const startIdx = match.index + (match[0].startsWith('\n') ? 1 : match[0].startsWith('\r\n') ? 2 : 0);
  const endIdx = (i + 1 < matches.length) ? matches[i + 1].index : content.length;
  
  const chapterContent = content.slice(startIdx, endIdx).trimEnd() + '\n';
  const outPath = path.join(dir, `Chương ${chapterNum}.txt`);
  fs.writeFileSync(outPath, chapterContent, 'utf8');
  written++;
}

console.log(`Successfully resynced ${written} chapter files!`);
