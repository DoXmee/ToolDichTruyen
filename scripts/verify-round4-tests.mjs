import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');

const text = fs.readFileSync(combinedFile, 'utf8');

console.log('=== BẮT ĐẦU KIỂM THỬ XÁC MINH TOÀN DIỆN ROUND 4 ===\n');

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

// Test 1: Yan = 0
const yanMatches = [...text.matchAll(/\bYan\b/g)];
assertTest(yanMatches.length === 0, `Không còn chữ "Yan" nào trong truyện (tìm thấy: ${yanMatches.length})`);

// Test 2: Hoa Quốc = 0
const hqMatches = [...text.matchAll(/Hoa Quốc/g)];
assertTest(hqMatches.length === 0, `Không còn chữ "Hoa Quốc" nào trong truyện (tìm thấy: ${hqMatches.length})`);

// Test 3: Trịnh lão nhị = 0
const tlnMatches = [...text.matchAll(/Trịnh lão nhị/g)];
assertTest(tlnMatches.length === 0, `Không còn cụm "Trịnh lão nhị" nào (tìm thấy: ${tlnMatches.length})`);

// Test 4: Kha lão tam = 0
const kltMatches = [...text.matchAll(/Kha lão tam/g)];
assertTest(kltMatches.length === 0, `Không còn cụm "Kha lão tam" nào (tìm thấy: ${kltMatches.length})`);

// Test 5: Vương Đội Trưởng = 0
const vdtMatches = [...text.matchAll(/Vương Đội Trưởng/g)];
assertTest(vdtMatches.length === 0, `Không còn cụm "Vương Đội Trưởng" nào (tìm thấy: ${vdtMatches.length})`);

// Test 6: thím hai họ Lữ / Thím hai họ Lữ = 0
const thlMatches = [...text.matchAll(/[Tt]hím hai họ Lữ/g)];
assertTest(thlMatches.length === 0, `Không còn cụm "thím hai họ Lữ" nào (tìm thấy: ${thlMatches.length})`);

// Test 7: Ch.28 con trai thứ hai
const ch28Content = fs.readFileSync(path.join(novelDir, 'Chương 28.txt'), 'utf8');
assertTest(
  ch28Content.includes('Con trai thứ hai sau khi kết hôn sinh được một gái một trai.') &&
  !ch28Content.includes('Con trai út sau khi kết hôn sinh được một gái một trai.'),
  'Chương 28 đã sửa thành "Con trai thứ hai sau khi kết hôn..." loại bỏ mâu thuẫn cốt truyện'
);

// Test 8: Ch.261 & Ch.262
const ch261Content = fs.readFileSync(path.join(novelDir, 'Chương 261.txt'), 'utf8');
const ch262Content = fs.readFileSync(path.join(novelDir, 'Chương 262.txt'), 'utf8');
assertTest(
  ch261Content.endsWith('vừa ăn vừa cười nói lời cảm ơn.') &&
  ch262Content.includes('Người nọ vừa ăn vừa cười nói:\r\n\r\n“Cà chua này ngọt thật đấy!'),
  'Chương 261 và 262 đã dời câu dẫn thoại chuẩn xác, không còn bị cắt ngang dấu hai chấm'
);

// Test 9: Ch.297 & Ch.298
const ch297Content = fs.readFileSync(path.join(novelDir, 'Chương 297.txt'), 'utf8');
const ch298Content = fs.readFileSync(path.join(novelDir, 'Chương 298.txt'), 'utf8');
assertTest(
  ch297Content.endsWith('liền cười mở lời giới thiệu.') &&
  ch298Content.includes('Diêu Cường Quốc cười nói:\r\n\r\n“Đó là em gái sinh đôi của tớ'),
  'Chương 297 và 298 đã dời câu dẫn thoại chuẩn xác, không còn bị cắt ngang dấu hai chấm'
);

// Test 10: Ch.447 & Ch.448
const ch447Content = fs.readFileSync(path.join(novelDir, 'Chương 447.txt'), 'utf8');
const ch448Content = fs.readFileSync(path.join(novelDir, 'Chương 448.txt'), 'utf8');
assertTest(
  ch447Content.endsWith('Trần Đại Phi nghiêm túc suy nghĩ một lát.') &&
  ch448Content.includes('Trần Đại Phi nghiêm túc đáp:\r\n\r\n“Tôi cũng không chắc'),
  'Chương 447 và 448 đã dời câu dẫn thoại chuẩn xác, không còn bị cắt ngang dấu hai chấm'
);

// Test 11: Adult Thư Thư (Ch.415 to Ch.477)
const idx415 = text.indexOf('Chương 415');
const idx478 = text.indexOf('Chương 478');
const adultSlice = text.slice(idx415, idx478);
const adultCoBeLower = (adultSlice.match(/cô bé/g) || []).length;
const adultCoBeUpper = (adultSlice.match(/Cô bé/g) || []).length;
assertTest(
  adultCoBeLower === 0 && adultCoBeUpper === 0,
  `Chương 415 đến 477 sạch hoàn toàn "cô bé"/"Cô bé" khi Thư Thư trưởng thành (còn: ${adultCoBeLower} thường, ${adultCoBeUpper} hoa)`
);

// Test 12: Individual chapter files for adult range
let individualClean = true;
for (let c = 415; c <= 477; c++) {
  const content = fs.readFileSync(path.join(novelDir, `Chương ${c}.txt`), 'utf8');
  if (content.includes('cô bé') || content.includes('Cô bé')) {
    individualClean = false;
    console.error(`Chương ${c}.txt vẫn còn chứa "cô bé"!`);
  }
}
assertTest(individualClean, 'Toàn bộ các file đơn Chương 415.txt đến Chương 477.txt sạch 100% "cô bé"');

// Test 13: Ch.478 preserves cô bé for daughter Yến Hiểu Hạ
const ch478Content = fs.readFileSync(path.join(novelDir, 'Chương 478.txt'), 'utf8');
assertTest(
  ch478Content.includes('cô bé') || ch478Content.includes('Cô bé'),
  'Chương 478 bảo toàn đúng từ "cô bé" cho con gái nhỏ Yến Hiểu Hạ'
);

// Test 14: Check Yến in Ch.412
const ch412Content = fs.readFileSync(path.join(novelDir, 'Chương 412.txt'), 'utf8');
assertTest(
  ch412Content.includes('bạn học kiêm đồng nghiệp của Yến.') &&
  ch412Content.includes('“John Hughes Smith, bạn của Yến.”'),
  'Chương 412 đã đổi "Yan" thành "Yến" chuẩn xác'
);

// Test 15: Check Trung Quốc
assertTest(
  text.includes('quần áo giá cả phải chăng mua từ Trung Quốc sẽ trở thành món quà tốt nhất') &&
  text.includes('mục đích phụ trong chuyến đến Trung Quốc lần này.') &&
  text.includes('Ngày cuối cùng trong chuyến du lịch Trung Quốc lần này, bốn người chia tay nhau tại sân bay'),
  'Các đoạn "Hoa Quốc" đã chuyển thành "Trung Quốc" chuẩn xác'
);

// Test 16: Check anh hai Trịnh and anh ba Kha
assertTest(
  text.includes('ba sau khi lá thư gửi về nhà, anh hai Trịnh mới trở về.') &&
  text.includes('anh ba Kha cũng chẳng biết nên khóc hay nên cười'),
  'Các từ Hán-Việt thô "Trịnh lão nhị", "Kha lão tam" đã thuần Việt hóa thành "anh hai Trịnh", "anh ba Kha"'
);

// Test 17: Check chị dâu hai họ Lữ
const cdhCount = (text.match(/chị dâu hai họ Lữ/g) || []).length;
const cdhUpperCount = (text.match(/Chị dâu hai họ Lữ/g) || []).length;
assertTest(
  cdhCount === 12 && cdhUpperCount === 6,
  `Đã chuyển chuẩn xác 18 vị trí thành "chị dâu hai họ Lữ" (12 thường, 6 hoa)`
);

console.log(`\n=== TỔNG KẾT: ${passCount}/${totalTests} BÀI TEST ĐẠT (PASS) ===`);
if (passCount === totalTests) {
  console.log('>>> TẤT CẢ CÁC BÀI TEST ĐỀU THÀNH CÔNG 100%! <<<');
} else {
  process.exit(1);
}
