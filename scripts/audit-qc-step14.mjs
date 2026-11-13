import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textVi = fs.readFileSync(path.join(novelDir, 'Tổng hợp từ chương 1-478.txt'), 'utf8');

const targetChapters = [11, 33, 53, 110, 134, 244, 309, 318, 353, 360, 373, 432, 444, 448, 474, 478];

console.log('=== KIỂM TRA 17 CÂU VIẾT THƯỜNG ĐẦU DÒNG ===');
targetChapters.forEach(c => {
  const chFile = path.join(novelDir, `Chương ${c}.txt`);
  if (!fs.existsSync(chFile)) return;
  const content = fs.readFileSync(chFile, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  // Find lines starting with lowercase
  const lowerLines = lines.filter(l => {
    const trimmed = l.trim();
    const firstChar = trimmed[0];
    return firstChar >= 'a' && firstChar <= 'z' || 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'.includes(firstChar);
  });
  if (lowerLines.length > 0) {
    console.log(`Ch.${c} (${lowerLines.length} lines):`);
    lowerLines.forEach(l => console.log('  ', JSON.stringify(l.slice(0, 50))));
  }
});
