import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');

const text = fs.readFileSync(combinedFile, 'utf8');

console.log('=== BẮT ĐẦU KIỂM THỬ XÁC MINH TOÀN DIỆN ROUND 5 ===\n');

let passCount = 0;
let totalTests = 0;

function assertTest(condition, testName) {
  totalTests++;
  if (condition) {
    passCount++;
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}`);
  }
}

// Test 1: C250 Ông Kha -> Chú Kha
const matchOldC250 = text.includes('Ông Kha ăn một miếng');
const matchNewC250 = text.includes('“Chú Kha ăn một miếng, dì Cát ăn một miếng, chị Xuân Linh ăn một miếng, anh Tử Hàn ăn một miếng…”');
assertTest(!matchOldC250 && matchNewC250, 'Chương 250 đã sửa "Ông Kha" -> "Chú Kha", khớp vai vế với dì Cát và nguyên tác 柯叔');

// Test 2: bác Hà = 0
const bacHaCount = (text.match(/bác Hà/g) || []).length;
assertTest(bacHaCount === 0, `Không còn "bác Hà" nào trong truyện (còn: ${bacHaCount})`);

// Test 3: C180 & C181 thím Hà
const ch180Content = fs.readFileSync(path.join(novelDir, 'Chương 180.txt'), 'utf8');
const ch181Content = fs.readFileSync(path.join(novelDir, 'Chương 181.txt'), 'utf8');
assertTest(
  ch180Content.includes('y phải sang báo với thím Hà một tiếng.”') &&
  ch181Content.includes('“Chú Trụ Tử, thím Hà, nhà mình mua quạt sớm thế ạ?”'),
  'Chương 180 và 181 đã đồng bộ thành "thím Hà" đi cùng "chú Trụ Tử"'
);

// Test 4: Vợ đội trưởng Ngưu (C52 & C53)
const ch52Content = fs.readFileSync(path.join(novelDir, 'Chương 52.txt'), 'utf8');
const ch53Content = fs.readFileSync(path.join(novelDir, 'Chương 53.txt'), 'utf8');
assertTest(
  ch52Content.includes('Vợ đội trưởng Ngưu là thím Kha sợ ông làm rơi đứa trẻ,') &&
  !ch52Content.includes('chị Kha'),
  'Chương 52 đã đổi "chị Kha" -> "thím Kha"'
);
assertTest(
  ch53Content.includes('“Con à, hay là cứ đi kiểm tra thử đi.” Thím Kha cũng lên tiếng khuyên nhủ.') &&
  !ch53Content.includes('Bà Kha cũng lên tiếng khuyên nhủ.'),
  'Chương 53 đã đổi "Bà Kha" -> "Thím Kha"'
);

// Test 5: C2 Mẹ Trần Đại Phi
const ch2Content = fs.readFileSync(path.join(novelDir, 'Chương 2.txt'), 'utf8');
assertTest(
  ch2Content.includes('Thím Trương rót cho cháu nhé.”') &&
  !ch2Content.includes('Bác Trương rót cho cháu nhé.”'),
  'Chương 2 đã đổi "Bác Trương" -> "Thím Trương", đồng bộ 100% với 76 vị trí thím Trương khác'
);

// Test 6: Trần Chấn Hưng C29, C62, C292
const ch29Content = fs.readFileSync(path.join(novelDir, 'Chương 29.txt'), 'utf8');
const ch62Content = fs.readFileSync(path.join(novelDir, 'Chương 62.txt'), 'utf8');
const ch292Content = fs.readFileSync(path.join(novelDir, 'Chương 292.txt'), 'utf8');
assertTest(
  ch29Content.includes('Sau khi trọng sinh ở kiếp này, chú vẫn tiếp tục làm nghề thợ mộc.') &&
  ch62Content.includes('thì số tiền kiếm được sẽ hoàn toàn thuộc về chú.') &&
  ch292Content.includes('Trần Chấn Hưng làm. Chú ấy dựa theo dáng vẻ của Tang Bưu,'),
  'Trần Chấn Hưng đã được đồng bộ ngôi kể ngôi thứ ba thành "chú / chú ấy" ở C29, C62, C292'
);

// Test 7: Thằng Khỉ Gầy = 0
const tkgCount = (text.match(/Thằng Khỉ Gầy/g) || []).length;
assertTest(tkgCount === 0, `Không còn cụm "Thằng Khỉ Gầy" nào trong truyện (còn: ${tkgCount})`);

// Test 8: C373 viết hoa Anh ba Kha
const ch373Content = fs.readFileSync(path.join(novelDir, 'Chương 373.txt'), 'utf8');
assertTest(
  ch373Content.includes('Anh ba Kha cũng chẳng biết nên khóc hay nên cười') &&
  !ch373Content.includes('anh ba Kha cũng chẳng biết nên khóc hay nên cười'),
  'Chương 373 đã viết hoa chuẩn "Anh ba Kha" ở đầu câu'
);

// Test 9: Quét toàn bộ 478 chương - kiểm tra dòng bắt đầu bằng chữ thường = 0
let lowerLinesCount = 0;
for (let c = 1; c <= 478; c++) {
  const f = path.join(novelDir, `Chương ${c}.txt`);
  const cText = fs.readFileSync(f, 'utf8');
  const lines = cText.split(/\r?\n/).filter(l => l.trim().length > 0);
  lines.forEach(l => {
    const trimmed = l.trim();
    let pos = 0;
    while (pos < trimmed.length && '“"\'‘«([{ \t'.includes(trimmed[pos])) pos++;
    const char = trimmed[pos];
    if (char && ((char >= 'a' && char <= 'z') || 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'.includes(char))) {
      lowerLinesCount++;
      console.error(`Chương ${c} có dòng viết thường: ${trimmed.slice(0, 40)}`);
    }
  });
}
assertTest(lowerLinesCount === 0, `Toàn bộ 478 chương không còn bất kỳ dòng nào bắt đầu bằng chữ thường (còn: ${lowerLinesCount})`);

// Test 10: điểm công = 0
const diemCongCount = (text.match(/điểm công/g) || []).length;
assertTest(diemCongCount === 0, `Không còn từ "điểm công" nào trong toàn bộ tiểu thuyết (còn: ${diemCongCount})`);

// Test 11: công điểm đã chuẩn hóa
const congDiemCount = (text.match(/công điểm/g) || []).length;
assertTest(congDiemCount === 84, `Đã chuẩn hóa toàn bộ thành "công điểm" (tổng số: ${congDiemCount}/84)`);

console.log(`\n=== TỔNG KẾT: ${passCount}/${totalTests} BÀI TEST ĐẠT (PASS) ===`);
if (passCount === totalTests) {
  console.log('>>> TẤT CẢ CÁC BÀI TEST ROUND 5 ĐỀU THÀNH CÔNG 100%! <<<');
} else {
  process.exit(1);
}
