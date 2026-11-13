import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');
const backupFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt.bak_round4');

console.log('=== BẮT ĐẦU ÁP DỤNG ĐỢT SỬA ĐỔI THỨ 4 CHO TRUYỆN ===');

let text = fs.readFileSync(combinedFile, 'utf8');
if (!fs.existsSync(backupFile)) {
  fs.writeFileSync(backupFile, text, 'utf8');
  console.log('Đã tạo bản backup an toàn:', backupFile);
}

const originalLength = text.length;
console.log('Độ dài ban đầu:', originalLength, 'ký tự.');

function replaceExact(find, replacement, expectedCount = 1, desc = '') {
  let count = 0;
  if (typeof find === 'string') {
    let pos = text.indexOf(find);
    while (pos !== -1) {
      count++;
      pos = text.indexOf(find, pos + find.length);
    }
    if (count !== expectedCount) {
      throw new Error(`[${desc}] Expected ${expectedCount} occurrences of "${find.slice(0, 40)}...", found ${count}`);
    }
    text = text.split(find).join(replacement);
  } else {
    const matches = [...text.matchAll(find)];
    count = matches.length;
    if (count !== expectedCount) {
      throw new Error(`[${desc}] Expected ${expectedCount} matches for ${find}, found ${count}`);
    }
    text = text.replace(find, replacement);
  }
  console.log(`✓ [${desc}]: Đã thay thế thành công (${count}/${expectedCount})`);
}

// 1. Dời câu dẫn thoại ở 3 chương bị cắt cơ học
// Ch.261 ↔ 262
replaceExact(
  'Cuối cùng, đối phương vẫn nhận lấy, vui vẻ cầm một quả cà chua lên cắn một miếng, vừa ăn vừa cười nói cảm ơn:\r\n\r\nChương 262\r\n\r\n“Cà chua này ngọt thật đấy!',
  'Cuối cùng, đối phương vẫn nhận lấy, vui vẻ cầm một quả cà chua lên cắn một miếng, vừa ăn vừa cười nói lời cảm ơn.\r\n\r\nChương 262\r\n\r\nNgười nọ vừa ăn vừa cười nói:\r\n\r\n“Cà chua này ngọt thật đấy!',
  1,
  'Ch.261 ↔ 262 Dời câu dẫn thoại'
);

// Ch.297 ↔ 298
replaceExact(
  'Diêu Cường Quốc cầm phiếu ăn trở về, bắt gặp ánh mắt tò mò của nhóm Kha Tiểu Hoa, liền cười giới thiệu:\r\n\r\nChương 298\r\n\r\n“Đó là em gái sinh đôi của tớ',
  'Diêu Cường Quốc cầm phiếu ăn trở về, bắt gặp ánh mắt tò mò của nhóm Kha Tiểu Hoa, liền cười mở lời giới thiệu.\r\n\r\nChương 298\r\n\r\nDiêu Cường Quốc cười nói:\r\n\r\n“Đó là em gái sinh đôi của tớ',
  1,
  'Ch.297 ↔ 298 Dời câu dẫn thoại'
);

// Ch.447 ↔ 448
replaceExact(
  'Trần Đại Phi nghiêm túc đáp:\r\n\r\nChương 448\r\n\r\n“Tôi cũng không chắc',
  'Trần Đại Phi nghiêm túc suy nghĩ một lát.\r\n\r\nChương 448\r\n\r\nTrần Đại Phi nghiêm túc đáp:\r\n\r\n“Tôi cũng không chắc',
  1,
  'Ch.447 ↔ 448 Dời câu dẫn thoại'
);

// 2. Yan -> Yến tại Ch.412 (2 lần)
replaceExact('bạn học kiêm đồng nghiệp của Yan.”', 'bạn học kiêm đồng nghiệp của Yến.”', 1, 'Yan 1 -> Yến');
replaceExact('“John Hughes Smith, bạn của Yan.”', '“John Hughes Smith, bạn của Yến.”', 1, 'Yan 2 -> Yến');

// 3. Hoa Quốc -> Trung Quốc (3 lần)
replaceExact('quần áo giá cả phải chăng mua từ Hoa Quốc sẽ trở thành món quà tốt nhất', 'quần áo giá cả phải chăng mua từ Trung Quốc sẽ trở thành món quà tốt nhất', 1, 'Hoa Quốc 1');
replaceExact('mục đích phụ trong chuyến đến Hoa Quốc lần này.', 'mục đích phụ trong chuyến đến Trung Quốc lần này.', 1, 'Hoa Quốc 2');
replaceExact('Ngày cuối cùng trong chuyến du lịch Hoa Quốc lần này, bốn người chia tay nhau tại sân bay', 'Ngày cuối cùng trong chuyến du lịch Trung Quốc lần này, bốn người chia tay nhau tại sân bay', 1, 'Hoa Quốc 3');

// 4. Trịnh lão nhị -> anh hai Trịnh (2 lần)
replaceExact('ba sau khi lá thư gửi về nhà, Trịnh lão nhị mới trở về.', 'ba sau khi lá thư gửi về nhà, anh hai Trịnh mới trở về.', 1, 'Trịnh lão nhị 1');
replaceExact('nhà họ Trịnh đã nói, sau khi Trịnh lão nhị xác định chuyện xem mắt thành công,', 'nhà họ Trịnh đã nói, sau khi anh hai Trịnh xác định chuyện xem mắt thành công,', 1, 'Trịnh lão nhị 2');

// 5. Kha lão tam -> anh ba Kha (2 lần)
replaceExact('Kha lão tam cũng chẳng biết nên khóc hay nên cười', 'anh ba Kha cũng chẳng biết nên khóc hay nên cười', 1, 'Kha lão tam 1');
replaceExact('Dù sao Kha lão tam vẫn đặt rất nhiều kỳ vọng vào chuyện này', 'Dù sao anh ba Kha vẫn đặt rất nhiều kỳ vọng vào chuyện này', 1, 'Kha lão tam 2');

// 6. Vương Đội Trưởng -> đội trưởng Vương (4 lần)
replaceExact('Hàng mà họ xếp do Vương Đội Trưởng phụ trách.', 'Hàng mà họ xếp do đội trưởng Vương phụ trách.', 1, 'Vương Đội Trưởng 1');
replaceExact('Vương Đội Trưởng là một người phụ nữ', 'Đội trưởng Vương là một người phụ nữ', 1, 'Vương Đội Trưởng 2');
replaceExact('chào tạm biệt Vương Đội Trưởng nào.”', 'chào tạm biệt đội trưởng Vương nào.”', 1, 'Vương Đội Trưởng 3');
replaceExact('không chỉ Vương Đội Trưởng mà cả những người xung quanh', 'không chỉ đội trưởng Vương mà cả những người xung quanh', 1, 'Vương Đội Trưởng 4');

// 7. thím hai họ Lữ -> chị dâu hai họ Lữ (12 lần thường + 6 lần viết hoa)
replaceExact('thím hai họ Lữ', 'chị dâu hai họ Lữ', 12, 'thím hai họ Lữ -> chị dâu hai họ Lữ');
replaceExact('Thím hai họ Lữ', 'Chị dâu hai họ Lữ', 6, 'Thím hai họ Lữ -> Chị dâu hai họ Lữ');

// 8. Ch.28 sửa con trai út thành con trai thứ hai
replaceExact(
  'Con trai út sau khi kết hôn sinh được một gái một trai. Cô con gái bằng tuổi Thư Thư, còn cậu con trai thì vẫn chưa được thụ thai.',
  'Con trai thứ hai sau khi kết hôn sinh được một gái một trai. Cô con gái bằng tuổi Thư Thư, còn cậu con trai thì vẫn chưa được thụ thai.',
  1,
  'Ch.28 Con trai út -> Con trai thứ hai'
);

// 9. Quy chuẩn đại từ "cô bé" / "Cô bé" -> "cô" / "Cô" từ Chương 415 đến 477
console.log('\n--- QUY CHUẨN ĐẠI TỪ CÔ BÉ -> CÔ TỪ CH.415 ĐẾN CH.477 ---');
const idx415 = text.indexOf('Chương 415');
const idx478 = text.indexOf('Chương 478');

if (idx415 === -1 || idx478 === -1) {
  throw new Error('Không tìm thấy ranh giới Chương 415 hoặc Chương 478');
}

let partBefore = text.slice(0, idx415);
let partAdult = text.slice(idx415, idx478);
let partAfter = text.slice(idx478);

// Riêng câu thoại nhân viên nhà hàng:
const waiterOriginal = '“Cảm ơn cô bé hào phóng, chúc cô sinh nhật vui vẻ!”';
const waiterReplacement = '“Cảm ơn quý cô hào phóng, chúc cô sinh nhật vui vẻ!”';
if (!partAdult.includes(waiterOriginal)) {
  throw new Error('Không tìm thấy câu thoại của bồi bàn');
}
partAdult = partAdult.replace(waiterOriginal, waiterReplacement);

// Đếm và thay thế
const countBeforeLower = (partAdult.match(/cô bé/g) || []).length;
const countBeforeUpper = (partAdult.match(/Cô bé/g) || []).length;
console.log(`Tìm thấy trong Ch.415-477: ${countBeforeLower} "cô bé", ${countBeforeUpper} "Cô bé".`);

partAdult = partAdult.replaceAll('Cô bé', 'Cô');
partAdult = partAdult.replaceAll('cô bé', 'cô');

const countAfterLower = (partAdult.match(/cô bé/g) || []).length;
const countAfterUpper = (partAdult.match(/Cô bé/g) || []).length;
console.log(`Sau khi thay thế: ${countAfterLower} "cô bé", ${countAfterUpper} "Cô bé".`);

if (countAfterLower !== 0 || countAfterUpper !== 0) {
  throw new Error(`Chưa thay thế triệt để cô bé/Cô bé trong Ch.415-477: còn ${countAfterLower} lower, ${countAfterUpper} upper`);
}

text = partBefore + partAdult + partAfter;
console.log(`✓ Đã quy chuẩn toàn bộ 171 đại từ xưng hô người dẫn chuyện từ Ch.415 đến Ch.477!`);

// Ghi đè file tổng hợp
fs.writeFileSync(combinedFile, text, 'utf8');
console.log('\n✓ ĐÃ GHI ĐÈ FILE TỔNG THÀNH CÔNG! Độ dài mới:', text.length, 'ký tự.');

// Đồng bộ hóa sang 478 file chương riêng biệt
console.log('\n--- ĐỒNG BỘ HÓA TẤT CẢ 478 FILE CHƯƠNG ---');
const headers = [...text.matchAll(/(?:^|\r?\n)Chương\s+(\d+)[:\s]*([^\r\n]*)/gi)];
console.log(`Tìm thấy ${headers.length} chương trong file tổng.`);

if (headers.length !== 478) {
  throw new Error(`Số lượng chương không khớp 478: tìm thấy ${headers.length}`);
}

for (let i = 0; i < headers.length; i++) {
  const chNum = parseInt(headers[i][1], 10);
  const startIdx = headers[i].index;
  const endIdx = (i + 1 < headers.length) ? headers[i + 1].index : text.length;
  const chContent = text.slice(startIdx, endIdx).trim();
  const chFilePath = path.join(novelDir, `Chương ${chNum}.txt`);
  fs.writeFileSync(chFilePath, chContent, 'utf8');
}
console.log('✓ ĐÃ ĐỒNG BỘ THÀNH CÔNG TOÀN BỘ 478 FILE CHƯƠNG TỪNG CHƯƠNG!');
