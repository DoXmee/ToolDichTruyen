import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');
const backupFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt.bak_audit_v2');

console.log('=== BẮT ĐẦU ÁP DỤNG CÁC SỬA ĐỔI CHO TRUYỆN ===');

// Đọc nội dung từ file backup để luôn có dữ liệu gốc sạch
let text = fs.readFileSync(backupFile, 'utf8');
const originalLength = text.length;
console.log('Độ dài file gốc:', originalLength, 'ký tự.');

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

// 1. Ch.469 rác gõ máy
replaceExact('Không chỉ một lma cao lập hai công ty đốt tiền', 'Không chỉ một lúc thành lập hai công ty đốt tiền', 1, 'Ch.469 rác gõ máy');

// 2. Ch.125 trưởng thôn gia gia (2 lần)
replaceExact('trưởng thôn gia gia', 'ông nội trưởng thôn', 2, 'Ch.125 trưởng thôn gia gia -> ông nội trưởng thôn');

// 3. Ch.454 ông nội La
replaceExact('“Nhưng em nhớ ông nội La chẳng phải rất nghiêm túc sao?”', '“Nhưng em nhớ ông nội Yến chẳng phải rất nghiêm túc sao?”', 1, 'Ch.454 ông nội La -> ông nội Yến');

// 4. Ch.451 Trịnh Đông Lâm & Thư Thư
replaceExact('“Tôi biết rồi, cô cứ yên tâm.”', '“Anh biết rồi, em cứ yên tâm.”', 1, 'Ch.451 Trịnh Đông Lâm xưng Tôi cô');

replaceExact(
  '“Tôi góp ba triệu, anh Đông Lâm góp một trăm nghìn, đồng thời đưa toàn bộ khách sạn đứng tên anh ấy vào công ty. Hai bên cùng thành lập một công ty khách sạn chuỗi.”',
  '“Em góp ba triệu, anh Đông Lâm góp một trăm nghìn, đồng thời đưa toàn bộ khách sạn đứng tên anh ấy vào công ty. Hai bên cùng thành lập một công ty khách sạn chuỗi.”',
  1,
  'Ch.451 Thư Thư đoạn 1 xưng Em'
);

replaceExact(
  '“Anh ấy nắm giữ 51% cổ phần, tôi nắm giữ 49%. Hai bên cùng sở hữu công ty, anh ấy đảm nhiệm vị trí người đại diện pháp luật kiêm chủ tịch hội đồng quản trị. Tôi không tham gia quản lý công việc thường ngày, nhưng có quyền được biết và quyền quyết định đối với tất cả những quyết sách quan trọng của công ty. Sau này, khi công ty mở rộng quy mô và cần thêm vốn, tôi phải tiếp tục đầu tư cho công ty căn cứ theo tỷ lệ cổ phần mình đang nắm giữ.”',
  '“Anh ấy nắm giữ 51% cổ phần, em nắm giữ 49%. Hai bên cùng sở hữu công ty, anh ấy đảm nhiệm vị trí người đại diện pháp luật kiêm chủ tịch hội đồng quản trị. Em không tham gia quản lý công việc thường ngày, nhưng có quyền được biết và quyền quyết định đối với tất cả những quyết sách quan trọng của công ty. Sau này, khi công ty mở rộng quy mô và cần thêm vốn, em phải tiếp tục đầu tư cho công ty căn cứ theo tỷ lệ cổ phần mình đang nắm giữ.”',
  1,
  'Ch.451 Thư Thư đoạn 2 xưng Em'
);

// 5. Ch.433 Tử An
replaceExact('“Tôi không quen ở chung với người lạ.”', '“Anh không quen ở chung với người lạ.”', 1, 'Ch.433 Tử An xưng Anh');

// 6. Ch.434 Thư Thư
replaceExact('“Tôi cũng không mệt lắm.”', '“Em cũng không mệt lắm.”', 1, 'Ch.434 Thư Thư xưng Em');

// 7. Ch.436 Tử An
replaceExact('“Ăn khuya không? Tôi nấu mì nhé?”', '“Ăn khuya không? Anh nấu mì nhé?”', 1, 'Ch.436 Tử An xưng Anh');

// 8. Ch.410 Câu treo “Yến Tử An?” ngay sau tiêu đề Chương 410
replaceExact(/Chương 410\r?\n\r?\n“Yến Tử An\?”\r?\n\r?\n/g, 'Chương 410\r\n\r\n', 1, 'Ch.410 Bỏ câu mồi lạc chỗ sau tiêu đề');

// 9. Ch.232 Mèo Tang Bưu (mèo mướp)
replaceExact('Còn trước bậc thềm nhà chính có một con mèo tam thể đang nằm lười biếng phơi nắng.', 'Còn trước bậc thềm nhà chính có một con mèo mướp đang nằm lười biếng phơi nắng.', 1, 'Ch.232 mèo tam thể 1 -> mèo mướp');
replaceExact('Con mèo tam thể bị vuốt ve mở mắt, ngẩng đầu liếc nhìn người đang sờ mình.', 'Con mèo mướp bị vuốt ve mở mắt, ngẩng đầu liếc nhìn người đang sờ mình.', 1, 'Ch.232 mèo tam thể 2 -> mèo mướp');

// 10. Ch.307 Nhà máy xà phòng
replaceExact(
  'Vừa hay, nhà máy phân bón hóa học có cung cấp ký túc xá cho công nhân. Khi thâm niên công tác tích lũy đến một mức nhất định, họ còn có thể xin được phân nhà ở dành cho công nhân viên. Chế độ phúc lợi vô cùng tốt.',
  'Vừa hay, nhà máy xà phòng có cung cấp ký túc xá cho công nhân. Khi thâm niên công tác tích lũy đến một mức nhất định, họ còn có thể xin được phân nhà ở dành cho công nhân viên. Chế độ phúc lợi vô cùng tốt.',
  1,
  'Ch.307 Thống nhất nhà máy xà phòng 1'
);

replaceExact(
  'Nhưng Kha Xuân Linh biết chén cơm này chẳng hề vững chắc. Thậm chí chưa đầy mười năm nữa, nhà máy phân bón hóa học của huyện sẽ vì kinh doanh thua lỗ, lại chịu sự cạnh tranh từ tư bản nước ngoài mà phá sản. Toàn bộ công nhân trong nhà máy đều sẽ mất việc, bị sa thải.',
  'Nhưng Kha Xuân Linh biết chén cơm này chẳng hề vững chắc. Thậm chí chưa đầy mười năm nữa, nhà máy xà phòng của huyện sẽ vì kinh doanh thua lỗ, lại chịu sự cạnh tranh từ tư bản nước ngoài mà phá sản. Toàn bộ công nhân trong nhà máy đều sẽ mất việc, bị sa thải.',
  1,
  'Ch.307 Thống nhất nhà máy xà phòng 2'
);

// 11. Ch.44
replaceExact('Trần Đại Phi, gầy như khỉ và những người khác đều có mặt.', 'Trần Đại Phi, Khỉ Gầy và những người khác đều có mặt.', 1, 'Ch.44 Chuẩn hóa biệt danh Khỉ Gầy');

replaceExact(
  /(Trần Đại Phi, Khỉ Gầy và những người khác đều có mặt\.)\r?\n\r?\nHôm nay là ngày khai giảng đầu tiên của lớp mẫu giáo thôn Phong Dương\.\r?\n\r?\n(Dưới sự đề xuất của Kha Tiểu Hoa)/g,
  '$1\r\n\r\n$2',
  1,
  'Ch.44 Xóa câu lặp thừa'
);

// 12. Dấu câu & Viết hoa
replaceExact('……', '…', 1, 'Ch.472 chuẩn hóa dấu ba chấm');
replaceExact(/(^|\r?\n)thôn Phong Dương có rất nhiều ruộng nước/g, '$1Thôn Phong Dương có rất nhiều ruộng nước', 1, 'Ch.76 Viết hoa đầu câu Thôn');

// 13. 10 vị trí "thím Trương" đầu dòng viết hoa
replaceExact(/(^|\r?\n)thím Trương\b/g, '$1Thím Trương', 10, 'Viết hoa 10 vị trí Thím Trương đầu câu');

// Ghi đè file tổng
fs.writeFileSync(combinedFile, text, 'utf8');
console.log('\n✓ ĐÃ GHI ĐÈ FILE TỔNG THÀNH CÔNG! Độ dài mới:', text.length, 'ký tự.');

// 2. Đồng bộ hóa sang 478 file chương riêng biệt
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
