import fs from 'node:fs';

const content = fs.readFileSync('C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt', 'utf8');

console.log('=== KIỂM CHỨNG CHI TIẾT BÁO CÁO ĐÁNH GIÁ MỚI NHẤT ===\n');

// 1. Ch.335: Dòng lặp loa & nháy đơn thẳng
console.log('1. Kiểm tra Ch.335 (Loa phát lặp lại & dấu nháy đơn):');
const p335 = content.indexOf('Áo bán mười lăm, quần bò hai mươi lăm');
if (p335 !== -1) {
  const excerpt = content.slice(p335 - 40, p335 + 280);
  console.log('   Trích dẫn thực tế:\n' + excerpt);
  const matchCount = (content.match(/Áo bán mười lăm, quần bò hai mươi lăm, tặng cái kẹp tóc keo kiệt quá/g) || []).length;
  console.log('   Số lần lặp:', matchCount);
  const hasStraightQuote = excerpt.includes("'");
  console.log('   Có dùng nháy đơn thẳng không:', hasStraightQuote);
} else {
  console.log('   Không tìm thấy đoạn Ch.335!');
}

// 2. Chức danh hoa/thường
console.log('\n2. Kiểm tra tính không nhất quán Hoa / Thường chức danh:');
const titles = [
  ['Đoàn trưởng', 'Đoàn Trưởng', 'đoàn trưởng'],
  ['Doanh trưởng', 'Doanh Trưởng', 'doanh trưởng'],
  ['Cục trưởng', 'Cục Trưởng', 'cục trưởng'],
  ['Thủ trưởng', 'Thủ Trưởng', 'thủ trưởng'],
  ['Xưởng trưởng', 'Xưởng Trưởng', 'xưởng trưởng'],
  ['Chủ nhiệm', 'Chủ Nhiệm', 'chủ nhiệm'],
  ['Sư phụ', 'Sư Phụ', 'sư phụ'],
  ['Bà chủ Lục', 'bà chủ Lục']
];

for (const group of titles) {
  const counts = group.map(t => {
    let count = 0, pos = 0;
    while ((pos = content.indexOf(t, pos)) !== -1) {
      count++;
      pos += t.length;
    }
    return `${t}: ${count}`;
  });
  console.log('   ' + counts.join(' | '));
}

// 3. Trợ lý Ninh Tranh Vinh
console.log('\n3. Kiểm tra biến thể gọi Trợ lý:');
const asst = [
  'Trợ lý đầu trọc', 'Trợ lý Đầu Trọc', 'trợ lý đầu trọc',
  'Tiêu Trợ Lý', 'Trợ lý Tiêu', 'trợ lý Tiêu'
];
for (const a of asst) {
  let count = 0, pos = 0;
  while ((pos = content.indexOf(a, pos)) !== -1) {
    count++;
    pos += a.length;
  }
  console.log(`   - ${a}: ${count} lần`);
}

// 4. Ngôi kể Lục Thời Quân & Chu Húc
console.log('\n4. Kiểm tra đại từ ngôi 3 trong lời dẫn:');
// Kiểm tra đại từ đứng ngay sau "Lục Thời Quân"
const ltqRegex = /Lục Thời Quân[^.?!…\n]{0,80}\b(anh|cậu|hắn)\b/gu;
let ltqCounts = { anh: 0, cậu: 0, hắn: 0 };
let m;
while ((m = ltqRegex.exec(content)) !== null) {
  const pronoun = m[1];
  if (ltqCounts[pronoun] !== undefined) ltqCounts[pronoun]++;
}
console.log('   Lục Thời Quân (cửa sổ gần sau tên):', ltqCounts);

// 5. Từ Hán-Việt cổ (nàng, nhị ca, tam ca, tứ ca, muội, đệ)
console.log('\n5. Kiểm tra các từ Hán-Việt cổ:');
const sinoViet = ['nàng', 'nhị ca', 'tam ca', 'tứ ca', 'muội', 'đệ', 'sư huynh', 'sư muội', 'đại ca'];
for (const sv of sinoViet) {
  const regex = new RegExp(`\\b${sv}\\b`, 'gi');
  const count = (content.match(regex) || []).length;
  console.log(`   - "${sv}": ${count} lần`);
}

// 6. Kiểm tra Ch.996 (Thụt lề 4 space & Marker Hoàn)
console.log('\n6. Kiểm tra Chương 996:');
const p996 = content.indexOf('Chương 996');
if (p996 !== -1) {
  const ch996Text = content.slice(p996);
  const lines = ch996Text.split('\n');
  const indented = lines.filter(l => l.startsWith('    '));
  console.log('   Số dòng thụt lề 4 khoảng trắng ở Ch.996:', indented.length);
  if (indented.length > 0) {
    console.log(`   Dòng mẫu: "${indented[0].trim()}"`);
  }
  const lastLines = lines.filter(l => l.trim().length > 0).slice(-4);
  console.log('   Các dòng kết thúc truyện:\n' + lastLines.map(l => '     > ' + l).join('\n'));
  const hasMarker = /—\s*Hoàn\s*—|Hết|Toàn văn hoàn/i.test(ch996Text);
  console.log('   Có marker [Hoàn] / [Hết] ở cuối truyện?:', hasMarker);
}
