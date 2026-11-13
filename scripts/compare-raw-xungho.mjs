import fs from 'node:fs';

const viContent = fs.readFileSync('C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt', 'utf8');

const chapters = viContent.split(/(?:^|\n)(?=Chương \d+)/g).filter(Boolean);

console.log('=== PHÂN BỔ ĐẠI TỪ CỦA LỤC THỜI QUÂN THEO CÁC CHẶNG CHƯƠNG ===\n');

const ranges = [
  [1, 100],
  [101, 200],
  [201, 300],
  [301, 400],
  [401, 500],
  [501, 600],
  [601, 700],
  [701, 800],
  [801, 900],
  [901, 996]
];

for (const [start, end] of ranges) {
  let anh = 0, cau = 0, han = 0;
  for (let ch = start; ch <= end; ch++) {
    const chapText = chapters[ch - 1] || '';
    const paragraphs = chapText.split('\n');
    for (const p of paragraphs) {
      const narrativeOnly = p.replace(/“[^”]*”/g, '').replace(/"[^"]*"/g, '');
      if (narrativeOnly.includes('Lục Thời Quân')) {
        const after = narrativeOnly.slice(narrativeOnly.indexOf('Lục Thời Quân'), narrativeOnly.indexOf('Lục Thời Quân') + 120);
        if (/\b(anh|anh ta)\b/.test(after)) anh++;
        if (/\b(cậu|cậu ta)\b/.test(after)) cau++;
        if (/\b(hắn|hắn ta)\b/.test(after)) han++;
      }
    }
  }
  console.log(`Chương ${start.toString().padStart(3, ' ')} - ${end.toString().padStart(3, ' ')}:  cậu = ${cau.toString().padStart(2, ' ')}  |  anh = ${anh.toString().padStart(2, ' ')}  |  hắn = ${han.toString().padStart(2, ' ')}`);
}
