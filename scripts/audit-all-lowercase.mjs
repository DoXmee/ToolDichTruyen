import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';

console.log('=== KIỂM TRA CHỮ THƯỜNG ĐẦU DÒNG TRONG TẤT CẢ 478 CHƯƠNG ===');
let totalLower = 0;
for (let c = 1; c <= 478; c++) {
  const chFile = path.join(novelDir, `Chương ${c}.txt`);
  if (!fs.existsSync(chFile)) continue;
  const content = fs.readFileSync(chFile, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  lines.forEach((l, idx) => {
    const trimmed = l.trim();
    let pos = 0;
    while (pos < trimmed.length && '“"\'‘«([{ \t'.includes(trimmed[pos])) {
      pos++;
    }
    const char = trimmed[pos];
    if (char && ((char >= 'a' && char <= 'z') || 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'.includes(char))) {
      totalLower++;
      console.log(`Ch.${c} (dòng ${idx + 1}):`, JSON.stringify(trimmed.slice(0, 60)));
    }
  });
}
console.log('Total lines starting with lowercase in entire novel:', totalLower);
