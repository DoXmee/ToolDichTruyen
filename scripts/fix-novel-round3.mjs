import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,';
const fullPath = path.join(novelDir, 'Tổng hợp từ chương 1-996.txt');

if (!fs.existsSync(fullPath)) {
  console.error('LỖI: Không tìm thấy file tổng hợp!');
  process.exit(1);
}

let content = fs.readFileSync(fullPath, 'utf8');
console.log(`Đọc file tổng hợp: ${content.length} ký tự`);

// 1. Xóa dòng nháp thừa ở C144
const c144_dup = 'Lục Thời Dã lười quản chuyện bao đồng của Lục Thời Quân, mặt không cảm xúc nhìn sang nữ y tá:\r?\n';
const c144_match = content.match(new RegExp(c144_dup));
if (c144_match) {
  content = content.replace(new RegExp(c144_dup), '');
  console.log('✓ Đã xóa dòng nháp thừa ở C144');
}

// 2. Sửa lặp từ dính chữ ở C129
if (content.includes('trong lúcTrong lúc')) {
  content = content.replaceAll('trong lúcTrong lúc', 'trong lúc');
  console.log('✓ Đã sửa "trong lúcTrong lúc" -> "trong lúc" ở C129');
}

// 3. Sửa định dạng câu điệp ý ở C35
const c35_target = 'Có đói bụng không? Chị về nấu cơm cho mấy đứa.”\r?\nCó đói bụng không? Chị về nấu cơm cho mấy đứa.\r?\nCâu nói này, từ sau khi bố mẹ qua đời, chị đã nói không biết bao nhiêu lần.';
const c35_replace = 'Có đói bụng không? Chị về nấu cơm cho mấy đứa.”\n“Có đói bụng không? Chị về nấu cơm cho mấy đứa.” — Câu nói này, từ sau khi bố mẹ qua đời, chị đã nói không biết bao nhiêu lần.';
content = content.replace(new RegExp('Có đói bụng không\\? Chị về nấu cơm cho mấy đứa\\.”\\r?\\nCó đói bụng không\\? Chị về nấu cơm cho mấy đứa\\.\\r?\\nCâu nói này, từ sau khi bố mẹ qua đời, chị đã nói không biết bao nhiêu lần\\.', 'g'), c35_replace);
console.log('✓ Đã chuẩn hóa câu điệp ý ở C35');

// 4. Sửa câu cụt "là lối:" ở C6
content = content.replace('cất giọng ồm ồm là lối:\r\nBa người đứng bên cạnh', 'cất giọng ồm ồm phàn nàn.\r\nBa người đứng bên cạnh');
content = content.replace('cất giọng ồm ồm là lối:\nBa người đứng bên cạnh', 'cất giọng ồm ồm phàn nàn.\nBa người đứng bên cạnh');
console.log('✓ Đã sửa "là lối:" ở C6');

// 5. Chuẩn hóa tên riêng sai / lặp âm tiết
content = content.replaceAll('tổng giám đốc Lam Lam Hạc Thanh', 'tổng giám đốc Lam Hạc Thanh');
content = content.replaceAll('Lam Lam Hạc Thanh', 'Lam Hạc Thanh');
content = content.replaceAll('vùng Gấu Trộn phía bắc', 'nước Gấu Trắng phía bắc');
content = content.replaceAll('Gấu Trộn', 'Gấu Trắng');
content = content.replaceAll('tiểu Văn Văn Điềm Điềm', 'tiểu Văn Điềm Điềm');
content = content.replaceAll('Năm bảy tám Tiểu Cương Thậm chí còn chẳng có gì cả', 'Năm 1978 thôn Tiểu Cương thậm chí còn chẳng có gì cả');
content = content.replaceAll('Tiểu Cương Thậm', 'thôn Tiểu Cương');
console.log('✓ Đã sửa tên riêng: Lam Hạc Thanh, Gấu Trắng, Văn Điềm Điềm, thôn Tiểu Cương');

// 6. Chuẩn hóa Điềm Điềm tính từ
content = content.replaceAll('cười Điềm Điềm nói:', 'cười ngọt ngào nói:');
content = content.replaceAll('cười Điềm Điềm:', 'cười ngọt ngào:');
content = content.replaceAll('cười Điềm Điềm', 'cười ngọt ngào');
content = content.replaceAll('Điềm Điềm miệng', 'cho ngọt miệng');
console.log('✓ Đã chuẩn hóa Điềm Điềm -> ngọt ngào / cho ngọt miệng');

// 7. Việt hóa từ lạc thời & pinyin
content = content.replaceAll('đài phát thanh online, quảng cáo tivi, báo chí offline', 'đài phát thanh, quảng cáo tivi, báo chí');
content = content.replaceAll('đài phát thanh online', 'đài phát thanh');
content = content.replaceAll('báo chí offline', 'báo chí');
content = content.replaceAll('chiếm hết spotlight của người khác', 'chiếm hết sự chú ý của người khác');
content = content.replaceAll('chiếm hết spotlight', 'chiếm hết sự chú ý');
content = content.replaceAll('chiếc giường kang', 'chiếc giường sưởi');
content = content.replaceAll('chiếc kang', 'chiếc giường sưởi');
content = content.replaceAll('giường kang', 'giường sưởi');
content = content.replaceAll('hậu sơn', 'núi phía sau');
content = content.replaceAll('Hậu sơn', 'Núi phía sau');
content = content.replaceAll('vẻ mặt cao lãnh', 'vẻ mặt lạnh lùng');
content = content.replaceAll('cao lãnh', 'lạnh lùng');
content = content.replaceAll('nhà máy điện máy Văn Đạt', 'nhà máy điện khí Văn Đạt');
console.log('✓ Đã Việt hóa online/offline, spotlight, giường sưởi, núi phía sau, lạnh lùng, điện khí');

// 8. Chuẩn hóa trợ lý Ninh Tranh Vinh
content = content.replaceAll('Quang Đầu Trợ lý đảo mắt: “Tôi không họ Quang, xin hãy gọi tôi là Tiêu Trợ Lý.”', 'Trợ lý đầu trọc đảo mắt: “Tôi không họ Quang, xin hãy gọi tôi là Tiêu Trợ Lý.”');
content = content.replaceAll('Quang Đầu Trợ lý', 'Trợ lý đầu trọc');
content = content.replaceAll('Trợ lý Quang Đầu', 'Trợ lý đầu trọc');
content = content.replaceAll('trợ lý Quang Đầu', 'trợ lý đầu trọc');
content = content.replaceAll('Quang đầu trợ lý', 'trợ lý đầu trọc');
console.log('✓ Đã chuẩn hóa trợ lý đầu trọc');

// 9. Sửa 5 lỗi chính tả / dính chữ
content = content.replaceAll('giãy giy', 'giãy giụa');
content = content.replaceAll('táo nhaim giòn rụm', 'táo nhai giòn rụm');
content = content.replaceAll('nhaim', 'nhai');
content = content.replaceAll('sự mặt củaanh Chu', 'sự có mặt của anh Chu');
content = content.replaceAll('vừaểnh tai', 'vừa nghểnh tai');
content = content.replace(/(?:^|\n)ông chủ Đoạn/g, '\nÔng chủ Đoạn');
console.log('✓ Đã sửa 5 lỗi chính tả dính chữ & viết hoa đầu C924');

// 10. Sửa lỗi dấu câu
// C253
content = content.replace(
  'Đối tượng chinh phục tân thủ Lục Thời Hoài đã mất kiểm soát, không thể tiếp tục chinh phục, mời ký chủ tập trung chinh phục Quý Tri Miễn!】',
  '【Đối tượng chinh phục tân thủ Lục Thời Hoài đã mất kiểm soát, không thể tiếp tục chinh phục, mời ký chủ tập trung chinh phục Quý Tri Miễn!】'
);
// C86
content = content.replace(
  'Anh suy nghĩ một lúc, rồi thẳng thắn hỏi:\r\nLục Thời Quân, ba anh em bọn họ cùng với Thẩm Thương Tuyết…”',
  'Anh suy nghĩ một lúc, rồi thẳng thắn hỏi:\r\n“Lục Thời Quân, ba anh em bọn họ cùng với Thẩm Thương Tuyết…”'
);
content = content.replace(
  'Anh suy nghĩ một lúc, rồi thẳng thắn hỏi:\nLục Thời Quân, ba anh em bọn họ cùng với Thẩm Thương Tuyết…”',
  'Anh suy nghĩ một lúc, rồi thẳng thắn hỏi:\n“Lục Thời Quân, ba anh em bọn họ cùng với Thẩm Thương Tuyết…”'
);
// C141 x 3
content = content.replace(
  'tuyệt đối không thể thiếu phần của họ được.”\r\nTiểu Lục này, cháu thật sự không ở lại ăn cơm sao?',
  'tuyệt đối không thể thiếu phần của họ được.”\r\n“Tiểu Lục này, cháu thật sự không ở lại ăn cơm sao?'
);
content = content.replace(
  'tuyệt đối không thể thiếu phần của họ được.”\nTiểu Lục này, cháu thật sự không ở lại ăn cơm sao?',
  'tuyệt đối không thể thiếu phần của họ được.”\n“Tiểu Lục này, cháu thật sự không ở lại ăn cơm sao?'
);
content = content.replace(
  'đến chính sách còn chẳng ủng hộ cơ mà.”\r\nBây giờ thì khác rồi, chính sách đã nới lỏng',
  'đến chính sách còn chẳng ủng hộ cơ mà.”\r\n“Bây giờ thì khác rồi, chính sách đã nới lỏng'
);
content = content.replace(
  'đến chính sách còn chẳng ủng hộ cơ mà.”\nBây giờ thì khác rồi, chính sách đã nới lỏng',
  'đến chính sách còn chẳng ủng hộ cơ mà.”\n“Bây giờ thì khác rồi, chính sách đã nới lỏng'
);
content = content.replace(
  'hơn nữa lại chẳng có đầu mối tiêu thụ.”\r\nHồi còn ở quê, tôi từng nghe nói',
  'hơn nữa lại chẳng có đầu mối tiêu thụ.”\r\n“Hồi còn ở quê, tôi từng nghe nói'
);
content = content.replace(
  'hơn nữa lại chẳng có đầu mối tiêu thụ.”\nHồi còn ở quê, tôi từng nghe nói',
  'hơn nữa lại chẳng có đầu mối tiêu thụ.”\n“Hồi còn ở quê, tôi từng nghe nói'
);
// C162 x 2
content = content.replace(
  'thì có chút ngạc nhiên:\r\nĐoàn trưởng, sao anh lại… mau vào nhà đi, bên ngoài lạnh lắm.”',
  'thì có chút ngạc nhiên:\r\n“Đoàn trưởng, sao anh lại… mau vào nhà đi, bên ngoài lạnh lắm.”'
);
content = content.replace(
  'thì có chút ngạc nhiên:\nĐoàn trưởng, sao anh lại… mau vào nhà đi, bên ngoài lạnh lắm.”',
  'thì có chút ngạc nhiên:\n“Đoàn trưởng, sao anh lại… mau vào nhà đi, bên ngoài lạnh lắm.”'
);
content = content.replace(
  'dẹp ngay sự tò mò xuống.\r\nKhương Đoàn trưởng, sao anh lại tới đây?”',
  'dẹp ngay sự tò mò xuống.\r\n“Khương Đoàn trưởng, sao anh lại tới đây?”'
);
content = content.replace(
  'dẹp ngay sự tò mò xuống.\nKhương Đoàn trưởng, sao anh lại tới đây?”',
  'dẹp ngay sự tò mò xuống.\n“Khương Đoàn trưởng, sao anh lại tới đây?”'
);
// C281
content = content.replace(
  'đi tìm Khương Đoàn trưởng.”\r\nKhông lâu sau đâu, họ liền dẫn theo Thẩm Thương Tuyết',
  'đi tìm Khương Đoàn trưởng.”\r\n“Không lâu sau đâu, họ liền dẫn theo Thẩm Thương Tuyết'
);
content = content.replace(
  'đi tìm Khương Đoàn trưởng.”\nKhông lâu sau đâu, họ liền dẫn theo Thẩm Thương Tuyết',
  'đi tìm Khương Đoàn trưởng.”\n“Không lâu sau đâu, họ liền dẫn theo Thẩm Thương Tuyết'
);
// C173
content = content.replace(
  'thấp giọng hỏi:\r\nPhó doanh trưởng, chuyện này…\r\nLục Thời Quân',
  'thấp giọng hỏi:\r\n“Phó doanh trưởng, chuyện này…”\r\nLục Thời Quân'
);
content = content.replace(
  'thấp giọng hỏi:\nPhó doanh trưởng, chuyện này…\nLục Thời Quân',
  'thấp giọng hỏi:\n“Phó doanh trưởng, chuyện này…”\nLục Thời Quân'
);
console.log('✓ Đã sửa 10 lỗi dấu ngoặc');

// 11. Xóa dấu --- đôi ở C10, C22, C123
content = content.replace(/---\s*\r?\n\s*---/g, '---');
console.log('✓ Đã xóa dấu --- đôi');

// Kiểm tra toàn vẹn số chương
const chMatches = [...content.matchAll(/(?:^|\n)Chương (\d+)/g)];
console.log(`Số chương nhận diện sau khi sửa: ${chMatches.length}`);
if (chMatches.length !== 996) {
  console.error(`LỖI: Số chương khác 996 (${chMatches.length})! Dừng ghi file.`);
  process.exit(1);
}
for (let i = 0; i < chMatches.length; i++) {
  const num = Number(chMatches[i][1]);
  if (num !== i + 1) {
    console.error(`LỖI: Lệch số thứ tự chương: mong muốn ${i+1}, thực tế ${num}`);
    process.exit(1);
  }
}

// Ghi file tổng hợp
fs.writeFileSync(fullPath, content, 'utf8');
console.log(`✓ Đã lưu file tổng hợp: ${fullPath} (${content.length} ký tự, ${Buffer.byteLength(content, 'utf8')} bytes)`);

// Đồng bộ 996 file chương lẻ
const chapterBlocks = content.split(/(?:^|\n)(?=Chương \d+)/g).filter(Boolean);
let synced = 0;
for (let i = 0; i < chapterBlocks.length; i++) {
  const chapText = chapterBlocks[i].trim();
  const m = chapText.match(/^Chương (\d+)/);
  if (m) {
    const chNum = m[1];
    const outChapterFile = path.join(novelDir, `Chương ${chNum}.txt`);
    fs.writeFileSync(outChapterFile, chapText + '\n', 'utf8');
    synced++;
  }
}
console.log(`✓ Đã đồng bộ ${synced}/996 file chương lẻ thành công!`);
