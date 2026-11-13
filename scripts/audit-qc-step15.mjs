import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';

const targetChapters = [11, 33, 53, 110, 134, 244, 309, 318, 353, 360, 373, 432, 444, 448, 474, 478];

console.log('=== KIỂM TRA CHỮ THƯỜNG TRONG TOÀN BỘ 16 CHƯƠNG ĐƯỢC NÊU ===');
targetChapters.forEach(c => {
  const chFile = path.join(novelDir, `Chương ${c}.txt`);
  if (!fs.existsSync(chFile)) return;
  const content = fs.readFileSync(chFile, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  lines.forEach((l, idx) => {
    const trimmed = l.trim();
    // check first letter of line (skipping quotation marks)
    let char = trimmed[0];
    let pos = 0;
    while (pos < trimmed.length && '“"\'‘«([{ \t'.includes(trimmed[pos])) {
      pos++;
    }
    char = trimmed[pos];
    if (char && ((char >= 'a' && char <= 'z') || 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'.includes(char))) {
      console.log(`Ch.${c} (dòng ${idx + 1}):`, JSON.stringify(trimmed.slice(0, 60)));
    }
  });
});
