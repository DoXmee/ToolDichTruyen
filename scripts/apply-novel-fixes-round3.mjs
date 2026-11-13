import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');
const backupFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt.bak_round3');

console.log('=== BẮT ĐẦU ÁP DỤNG ĐỢT SỬA ĐỔI THỨ 3 CHO TRUYỆN ===');

let text = fs.readFileSync(combinedFile, 'utf8');
if (!fs.existsSync(backupFile)) {
  fs.writeFileSync(backupFile, text, 'utf8');
  console.log('Đã tạo bản backup:', backupFile);
}

const originalLength = text.length;
console.log('Độ dài ban đầu:', originalLength, 'ký tự.');

// Helper replace exact
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

// 1. Ch.405 Thương hiệu Thư Hà Thời Trang
replaceExact('Thời Hà Thời Trang', 'Thư Hà Thời Trang', 1, 'Ch.405 Thời Hà -> Thư Hà Thời Trang');

// 2. Ch.243 Gầy Nhỏ -> Khỉ Gầy
replaceExact('Chỉ có Gầy Nhỏ vì bất cẩn, viết sai một chữ nên bị trừ một điểm.', 'Chỉ có Khỉ Gầy vì bất cẩn, viết sai một chữ nên bị trừ một điểm.', 1, 'Ch.243 Gầy Nhỏ -> Khỉ Gầy');

// 3. Ch.310 Chị Hai Nữu -> Chị Nhị Nữu
replaceExact('“Chị Hai Nữu, chị không sao chứ?”', '“Chị Nhị Nữu, chị không sao chứ?”', 1, 'Ch.310 Chị Hai Nữu -> Chị Nhị Nữu');

// 4. Ch.312 Xóa (Bragi)
replaceExact('chiếc váy liền kiểu Liên Xô (Bragi),', 'chiếc váy liền kiểu Liên Xô,', 1, 'Ch.312 Xóa phiên âm (Bragi)');

// 5. Ch.212 Chú út -> Chú hai Trịnh Chí Cao
replaceExact(
  'Gần đây, gia đình cậu bé bận tối mắt tối mũi vì chuẩn bị hôn lễ cho chú út. Buổi chiều tan học, cậu lập tức về nhà phụ giúp, nên không đi chơi cùng nhóm Thư Thư.\r\n\r\nThế là cậu bỏ lỡ cảnh chú út trở về thôn.',
  'Gần đây, gia đình cậu bé bận tối mắt tối mũi vì chuẩn bị hôn lễ cho chú hai. Buổi chiều tan học, cậu lập tức về nhà phụ giúp, nên không đi chơi cùng nhóm Thư Thư.\r\n\r\nThế là cậu bỏ lỡ cảnh chú hai trở về thôn.',
  1,
  'Ch.212 Chú út -> chú hai Trịnh Chí Cao'
);

// 6. Xóa 5 dòng mồi đầu chương
replaceExact(/Chương 10\r?\n\r?\nHay là chúng ta mở một trường mẫu giáo cho Thư Thư nhé\?\r?\n\r?\n/g, 'Chương 10\r\n\r\n', 1, 'Ch.10 Xóa dòng mồi mở trường');
replaceExact(/Chương 12\r?\n\r?\nThư Thư nói, cô hy vọng tất cả mọi người trong thôn đều có thể sống một cuộc sống ấm no, hạnh phúc\.\r?\n\r?\n/g, 'Chương 12\r\n\r\n', 1, 'Ch.12 Xóa dòng mồi ấm no hạnh phúc');
replaceExact(/Chương 29\r?\n\r?\nCô bé còn có cả những hình nhân gỗ biết đánh nhau nữa\.\r?\n\r?\n/g, 'Chương 29\r\n\r\n', 1, 'Ch.29 Xóa dòng mồi hình nhân gỗ');
replaceExact(/Chương 32\r?\n\r?\nĐiều đó chứng tỏ các cô bé có ý thức tự bảo vệ bản thân rất tốt, đáng khen!\r?\n\r?\n/g, 'Chương 32\r\n\r\n', 1, 'Ch.32 Xóa dòng mồi bảo vệ bản thân');
replaceExact(/Chương 47\r?\n\r?\n“Cún ơi, chúng mình đi hái hoa nhé…”\r?\n\r?\n/g, 'Chương 47\r\n\r\n', 1, 'Ch.47 Xóa dòng mồi hái hoa');

// 7. Chuẩn hóa "Nhất Trung của huyện" -> "trường cấp hai số 1 huyện"
replaceExact('thức ăn ở nhà ăn trường Nhất Trung của huyện', 'thức ăn ở nhà ăn trường cấp hai số 1 huyện', 1, 'Nhất Trung 1');
replaceExact('Nhà ăn trường Nhất Trung của huyện có hai tầng', 'Nhà ăn trường cấp hai số 1 huyện có hai tầng', 1, 'Nhất Trung 2');
replaceExact('Đúng là trường Nhất Trung của huyện!', 'Đúng là trường cấp hai số 1 huyện!', 1, 'Nhất Trung 3');
replaceExact('Bàn ăn trong nhà ăn trường Nhất Trung của huyện', 'Bàn ăn trong nhà ăn trường cấp hai số 1 huyện', 1, 'Nhất Trung 4');
replaceExact('trước cổng trường Nhất Trung của huyện.', 'trước cổng trường cấp hai số 1 huyện.', 1, 'Nhất Trung 5');

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
