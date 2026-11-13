import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');

const text = fs.readFileSync(combinedFile, 'utf8');

const tests = [
  { name: 'Ch.469 rác gõ máy sạch', check: !text.includes('lma cao lập') && text.includes('một lúc thành lập hai công ty') },
  { name: 'Ch.125 sạch gia gia', check: !text.includes('trưởng thôn gia gia') && text.includes('ông nội trưởng thôn') },
  { name: 'Ch.454 ông nội Yến', check: text.includes('“Nhưng em nhớ ông nội Yến chẳng phải rất nghiêm túc sao?”') },
  { name: 'Ch.451 Trịnh Đông Lâm xưng Anh', check: text.includes('“Anh biết rồi, em cứ yên tâm.”') },
  { name: 'Ch.451 Thư Thư xưng Em', check: text.includes('“Em góp ba triệu, anh Đông Lâm góp một trăm nghìn') },
  { name: 'Ch.433 Tử An xưng Anh', check: text.includes('“Anh không quen ở chung với người lạ.”') },
  { name: 'Ch.434 Thư Thư xưng Em', check: text.includes('“Em cũng không mệt lắm.”') },
  { name: 'Ch.436 Tử An xưng Anh', check: text.includes('“Ăn khuya không? Anh nấu mì nhé?”') },
  { name: 'Ch.410 sạch câu mồi Yến Tử An', check: text.includes('Chương 410\r\n\r\n“Thư Thư, lâu lắm rồi không gặp em') },
  { name: 'Ch.232 Tang Bưu mèo mướp', check: text.includes('con mèo mướp đang nằm lười biếng phơi nắng') && text.includes('Con mèo mướp bị vuốt ve mở mắt') },
  { name: 'Ch.307 thống nhất nhà máy xà phòng', check: text.includes('Vừa hay, nhà máy xà phòng có cung cấp ký túc xá cho công nhân') && text.includes('nhà máy xà phòng của huyện sẽ vì kinh doanh thua lỗ') },
  { name: 'Ch.44 Khỉ Gầy & sạch lặp', check: text.includes('Trần Đại Phi, Khỉ Gầy và những người khác đều có mặt.') && (text.match(/Hôm nay là ngày khai giảng đầu tiên của lớp mẫu giáo thôn Phong Dương\./g) || []).length === 1 },
  { name: 'Ch.472 dấu ba chấm chuẩn', check: !text.includes('……') },
  { name: 'Ch.76 viết hoa Thôn', check: text.includes('Thôn Phong Dương có rất nhiều ruộng nước') }
];

console.log('=== KẾT QUẢ KIỂM TRA LẠI SAU KHI SỬA ===');
let allPassed = true;
for (const t of tests) {
  console.log(`[${t.check ? 'PASS' : 'FAIL'}] ${t.name}`);
  if (!t.check) allPassed = false;
}

// Kiểm tra ngẫu nhiên 3 file chương rời rạc
const ch125Text = fs.readFileSync(path.join(novelDir, 'Chương 125.txt'), 'utf8');
const ch232Text = fs.readFileSync(path.join(novelDir, 'Chương 232.txt'), 'utf8');
const ch451Text = fs.readFileSync(path.join(novelDir, 'Chương 451.txt'), 'utf8');

console.log('\n--- Kiểm tra đồng bộ file rời rạc ---');
console.log('Chương 125 chứa "ông nội trưởng thôn":', ch125Text.includes('ông nội trưởng thôn'));
console.log('Chương 232 chứa "con mèo mướp":', ch232Text.includes('con mèo mướp đang nằm'));
console.log('Chương 451 chứa "Anh biết rồi, em cứ yên tâm":', ch451Text.includes('Anh biết rồi, em cứ yên tâm'));

if (allPassed && ch125Text.includes('ông nội trưởng thôn') && ch232Text.includes('con mèo mướp') && ch451Text.includes('Anh biết rồi, em cứ yên tâm')) {
  console.log('\n>>> TẤT CẢ 100% CÁC HẠNG MỤC ĐÃ ĐƯỢC CẬP NHẬT HOÀN HẢO! <<<');
} else {
  console.log('\n>>> CÓ HẠNG MỤC CHƯA ĐẠT! <<<');
}
