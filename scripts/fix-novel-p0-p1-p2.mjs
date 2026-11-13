import fs from 'node:fs';
import path from 'node:path';

const novelPath = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt';
const backupPath = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996_Backup_BeforeP0P1P2.txt';

if (!fs.existsSync(novelPath)) {
  console.error('Novel file not found:', novelPath);
  process.exit(1);
}

const originalContent = fs.readFileSync(novelPath, 'utf8');
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, originalContent, 'utf8');
  console.log('Created backup at:', backupPath);
}

let content = originalContent;

// 1. Delete 7 author note lines at C345, C405, C529, C736, C831
const authorNotes = [
  '? Cảm ơn mọi người đã bình chọn, đánh giá tốt, tặng quà và khích lệ, tôi sẽ tiếp tục cố gắng!',
  '? Đồng thời chúc mọi người đêm giao thừa vui vẻ, năm mới bình an hạnh phúc, vạn sự như ý, mọi việc đều thuận lợi, phát tài phát lộc!',
  '? Cảm ơn mọi người đã bình chọn, tặng thưởng, đánh giá tốt, tôi sẽ tiếp tục cố gắng!',
  '? Ngày 7, ngày 8 mỗi ngày thêm một chương!',
  '? Rất cảm ơn sự ủng hộ, bình chọn và đánh giá tốt của mọi người, sự khích lệ và ủng hộ tôi đều đã nhận được, tôi sẽ tiếp tục cố gắng!',
  '? Ngoài ra, ai còn phiếu tháng, phiếu đề cử thì làm phiền bình chọn cho tôi nhé, nếu số phiếu vượt quá số lượng nhất định, ngày Quốc tế Thiếu nhi 1/6 tôi sẽ đăng thêm một chương nữa!',
  '? Cảm ơn, cảm ơn rất nhiều!'
];

const lines = content.split('\n');
const filteredLines = lines.filter(l => {
  const trimmed = l.trim();
  if (authorNotes.includes(trimmed)) {
    console.log(`Deleted author note: "${trimmed.slice(0, 40)}..."`);
    return false;
  }
  return true;
});
content = filteredLines.join('\n');

// 2. Fix spelling typos in proper names (P0)
const typoMap = [
  ['Thâm Puyến', 'Thâm Quyến'],
  ['Thâm Cuyến', 'Thâm Quyến'],
  ['Thường Tuyết', 'Thương Tuyết'],
  ['Tú Ngọc Trân', 'Từ Ngọc Trân'],
  ['đồng chí Thử', 'đồng chí Thẩm'],
  ['Đồng chí Thử', 'Đồng chí Thẩm'],
  ['thím Hà', 'thím Hạ'],
  ['Thím Hà', 'Thím Hạ'],
];

for (const [wrong, right] of typoMap) {
  const count = (content.match(new RegExp(wrong, 'g')) || []).length;
  content = content.replaceAll(wrong, right);
  console.log(`Replaced typo: ${wrong} -> ${right} (${count} occurrences)`);
}

// 3. Chu Húc surname standardization: replace Châu with Chu, strictly excluding Quảng Châu
let chauReplaced = 0;
content = content.replace(/(Quảng Châu)|(\bChâu\b)/gu, (match, p1, p2) => {
  if (p1) return p1; // keep Quảng Châu intact
  chauReplaced++;
  return 'Chu';
});
console.log(`Replaced surname Châu -> Chu: ${chauReplaced} occurrences (Quảng Châu preserved)`);

// 4. Fix Pronouns (P0): Em trai xưng em với chị & Chu Húc <-> Lục Thời Du
const pronounFixes = [
  // C282
  ['sao cậu lại nhéo tôi? Không được, tôi phải nhéo lại!', 'sao cậu lại nhéo em? Không được, em phải nhéo lại!'],
  // C379
  ['“Tôi cũng không đồng ý! Chị, chị biết mà, tôi đã muốn đấm hắn từ lâu rồi, bắt tôi trơ mắt nhìn chị', '“Em cũng không đồng ý! Chị, chị biết mà, em đã muốn đấm hắn từ lâu rồi, bắt em trơ mắt nhìn chị'],
  // C250
  ['rõ ràng là đang nói đỡ cho tôi. Có phải chuyện tôi đánh bài bị cấm túc lần trước bị chị biết rồi không?', 'rõ ràng là đang nói đỡ cho em. Có phải chuyện em đánh bài bị cấm túc lần trước bị chị biết rồi không?'],
  // C267
  ['chị biết đấy, vì một vài chuyện nên tôi không tiện trực tiếp lộ diện.', 'chị biết đấy, vì một vài chuyện nên em không tiện trực tiếp lộ diện.'],
  // C332
  ['bảo tôi đích thân đưa anh ấy về xưởng may. Đợi tôi đưa chị về nhà xong thì vẫn còn việc phải làm đây.', 'bảo em đích thân đưa anh ấy về xưởng may. Đợi em đưa chị về nhà xong thì vẫn còn việc phải làm đây.'],
  // C499
  ['“Hai tiếng trước, chị hỏi tôi thích Thẩm Thương Tuyết ở điểm nào. Trên đường về, tôi cứ suy nghĩ mãi…', '“Hai tiếng trước, chị hỏi em thích Thẩm Thương Tuyết ở điểm nào. Trên đường về, em cứ suy nghĩ mãi…'],
  // C546
  ['tôi nói với Hồ Lão Bản và hai người họ là chị đã đồng ý rồi.', 'em nói với Hồ Lão Bản và hai người họ là chị đã đồng ý rồi.'],
  ['“Tôi chỉ đầu tư hai vạn tệ, đến lúc chia lợi nhuận cũng chẳng được nhiều bằng chị', '“Em chỉ đầu tư hai vạn tệ, đến lúc chia lợi nhuận cũng chẳng được nhiều bằng chị'],
  // C749
  ['Mấy ngày nay dường như cô có tâm sự, có tiện nói cho tôi nghe không?', 'Mấy ngày nay dường như em có tâm sự, có tiện nói cho anh nghe không?'],
  // C983 kiss scene
  ['Sau khi vị lão trung y đó đến, hãy để ông ấy bắt mạch cho cô, cô không được từ chối đâu đấy.”', 'Sau khi vị lão trung y đó đến, hãy để ông ấy bắt mạch cho em, em không được từ chối đâu đấy.”'],
  ['“Nếu tôi từ chối thì sao?”', '“Nếu em từ chối thì sao?”'],
  ['“Vậy… tôi chỉ đành hôn cô thôi.”', '“Vậy… anh chỉ đành hôn em thôi.”'],
  // C705
  ['ngày ba mươi Tết, tôi có vinh hạnh được mời cô xem chương trình đón giao thừa không?', 'ngày ba mươi Tết, anh có vinh hạnh được mời em xem chương trình đón giao thừa không?']
];

for (const [wrong, right] of pronounFixes) {
  const count = (content.match(new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  content = content.replace(wrong, right);
  console.log(`Fixed pronoun: "${wrong.slice(0, 30)}..." -> "${right.slice(0, 30)}..." (${count} occurrences)`);
}

// 5. P1 Standardizations
// Village: Bắp Ngô Tấn / Bào Mễ Đồn / thôn Bào Mễ -> thôn Bắp Ngô
content = content.replaceAll('thôn Bắp Ngô Tấn', 'thôn Bắp Ngô');
content = content.replaceAll('Bắp Ngô Tấn', 'thôn Bắp Ngô');
content = content.replaceAll('thôn Bào Mễ Đồn', 'thôn Bắp Ngô');
content = content.replaceAll('Bào Mễ Đồn', 'thôn Bắp Ngô');
content = content.replaceAll('thôn Bào Mễ', 'thôn Bắp Ngô');

// Sư anh -> sư huynh
content = content.replaceAll('Sư anh', 'Sư huynh');
content = content.replaceAll('sư anh', 'sư huynh');

// Hong Kong: Hương Cảng -> Hồng Kông
const hkCount = (content.match(/Hương Cảng/g) || []).length;
content = content.replaceAll('Hương Cảng', 'Hồng Kông');
console.log(`Replaced Hương Cảng -> Hồng Kông: ${hkCount} occurrences`);

// Furniture & Tech
content = content.replaceAll('sofa', 'sô pha');
content = content.replaceAll('Sofa', 'Sô pha');
content = content.replace(/\bti vi\b/gi, 'tivi');
content = content.replace(/\bTV\b/g, 'tivi');

// Banh tra & orphan note in C21
content = content.replaceAll('banh tra (1)', 'ban kiểm tra quân phong');
content = content.replaceAll('banh tra', 'ban kiểm tra quân phong');

// C141 trailing .*
content = content.replaceAll('không thể thiếu phần của họ được.*', 'không thể thiếu phần của họ được.”');
content = content.replaceAll('chẳng ủng hộ cơ mà.*', 'chẳng ủng hộ cơ mà.”');
content = content.replaceAll('đầu mối tiêu thụ.*', 'đầu mối tiêu thụ.”');

// 6. P2 Technical formatting
// Full-width characters
content = content.replaceAll('＊', '*');
content = content.replaceAll('！', '!');
content = content.replaceAll('《Hoặc》', '“Hoặc”');
content = content.replaceAll('《Sóng Hoàng Hà cuồn cuộn》', '“Sóng Hoàng Hà cuồn cuộn”');
// C253 missing opening bracket
content = content.replace('Đối tượng chinh phục tân thủ Lục Thời Hoài đã mất kiểm soát… Quý Tri Miễn!】', '【Đối tượng chinh phục tân thủ Lục Thời Hoài đã mất kiểm soát… Quý Tri Miễn!】');

// Ellipses normalization
content = content.replace(/\.{4,}/g, '…');
content = content.replaceAll('……', '…');
content = content.replaceAll('...', '…');

// Remove double empty lines (>=3 newlines -> 2 newlines)
content = content.replace(/\r?\n{3,}/g, '\n\n');

// 7. Split dense paragraphs >800 chars in narrative blocks at dialogue/sentence boundaries
const chapterParts = content.split(/(?:^|\n)(?=Chương \d+)/g);
console.log(`Total chapters parsed: ${chapterParts.length}`);

const reformedChapters = chapterParts.map((chap, cIdx) => {
  const lines = chap.split('\n');
  const newLines = [];
  for (let line of lines) {
    if (line.length > 800 && line.includes('“')) {
      // Split before dialogue opening quotation mark
      line = line.replace(/([.?!…])\s+(“)/g, '$1\n\n$2');
      // Split after dialogue closing quotation mark
      line = line.replace(/(”)\s+([A-ZÀ-ỸĐ])/g, '$1\n\n$2');
      newLines.push(...line.split('\n\n'));
    } else {
      newLines.push(line);
    }
  }
  return newLines.join('\n');
});

content = reformedChapters.join('\n');

// Verify chapter count & structure
const chapterMatches = [...content.matchAll(/(?:^|\n)Chương (\d+)/g)];
console.log(`Final verified chapters: ${chapterMatches.length}`);
if (chapterMatches.length !== 996) {
  console.error(`ERROR: Expected 996 chapters, found ${chapterMatches.length}! Aborting write.`);
  process.exit(1);
}

for (let i = 0; i < chapterMatches.length; i++) {
  const num = Number(chapterMatches[i][1]);
  if (num !== i + 1) {
    console.error(`ERROR: Chapter numbering gap at index ${i}: expected ${i+1}, found ${num}`);
    process.exit(1);
  }
}

// Write the repaired full file
fs.writeFileSync(novelPath, content, 'utf8');
console.log(`Successfully saved repaired full text to: ${novelPath}`);

// Resync individual chapter files in C:\Users\dthuo\Downloads\chị gái ác,\Chương N.txt
const chapterDir = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,';
let syncedChapters = 0;
for (let i = 0; i < chapterParts.length; i++) {
  const chapText = reformedChapters[i].trim();
  const m = chapText.match(/^Chương (\d+)/);
  if (m) {
    const chNum = m[1];
    const outChapterFile = path.join(chapterDir, `Chương ${chNum}.txt`);
    fs.writeFileSync(outChapterFile, chapText + '\n', 'utf8');
    syncedChapters++;
  }
}
console.log(`Successfully resynchronized ${syncedChapters}/996 individual chapter files in ${chapterDir}`);
