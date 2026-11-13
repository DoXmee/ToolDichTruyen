import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');
const backupFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt.bak_round5');

console.log('=== BẮT ĐẦU ÁP DỤNG ĐỢT SỬA ĐỔI THỨ 5 CHO TRUYỆN ===\n');

let text = fs.readFileSync(combinedFile, 'utf8');
if (!fs.existsSync(backupFile)) {
  fs.writeFileSync(backupFile, text, 'utf8');
  console.log('Đã tạo bản backup an toàn:', backupFile);
}

const originalLength = text.length;
console.log('Độ dài ban đầu:', originalLength, 'ký tự.\n');

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

// 1. C250: Ông Kha -> Chú Kha (khớp nguyên tác 柯叔)
replaceExact(
  '“Ông Kha ăn một miếng, dì Cát ăn một miếng, chị Xuân Linh ăn một miếng, anh Tử Hàn ăn một miếng…”',
  '“Chú Kha ăn một miếng, dì Cát ăn một miếng, chị Xuân Linh ăn một miếng, anh Tử Hàn ăn một miếng…”',
  1,
  'C250 Ông Kha -> Chú Kha'
);

// 2. C180 & C181: bác Hà -> thím Hà (khớp 何嬸子 và chú Trụ Tử)
replaceExact(
  'y phải sang báo với bác Hà một tiếng.”',
  'y phải sang báo với thím Hà một tiếng.”',
  1,
  'C180 bác Hà -> thím Hà'
);
replaceExact(
  '“Chú Trụ Tử, bác Hà, nhà mình mua quạt sớm thế ạ?”',
  '“Chú Trụ Tử, thím Hà, nhà mình mua quạt sớm thế ạ?”',
  1,
  'C181 bác Hà -> thím Hà'
);

// 3. C52 & C53: vợ đội trưởng Ngưu (khớp 柯嫂子)
replaceExact(
  'Vợ đội trưởng Ngưu là chị Kha sợ ông làm rơi đứa trẻ,',
  'Vợ đội trưởng Ngưu là thím Kha sợ ông làm rơi đứa trẻ,',
  1,
  'C52 chị Kha -> thím Kha'
);
replaceExact(
  '“Con à, hay là cứ đi kiểm tra thử đi.” Bà Kha cũng lên tiếng khuyên nhủ.',
  '“Con à, hay là cứ đi kiểm tra thử đi.” Thím Kha cũng lên tiếng khuyên nhủ.',
  1,
  'C53 Bà Kha -> Thím Kha'
);

// 4. C2: Bác Trương -> Thím Trương (đồng bộ 76 lần thím Trương)
replaceExact(
  'Bác Trương rót cho cháu nhé.”',
  'Thím Trương rót cho cháu nhé.”',
  1,
  'C2 Bác Trương -> Thím Trương'
);

// 5. C29, C62, C292: Trần Chấn Hưng (ngôi kể chú Chấn Hưng)
replaceExact(
  'Sau khi trọng sinh ở kiếp này, ông vẫn tiếp tục làm nghề thợ mộc.',
  'Sau khi trọng sinh ở kiếp này, chú vẫn tiếp tục làm nghề thợ mộc.',
  1,
  'C29 ông -> chú'
);
replaceExact(
  'thì số tiền kiếm được sẽ hoàn toàn thuộc về anh.',
  'thì số tiền kiếm được sẽ hoàn toàn thuộc về chú.',
  1,
  'C62 anh -> chú'
);
replaceExact(
  'Trần Chấn Hưng làm. Anh ấy dựa theo dáng vẻ của Tang Bưu,',
  'Trần Chấn Hưng làm. Chú ấy dựa theo dáng vẻ của Tang Bưu,',
  1,
  'C292 Anh ấy -> Chú ấy'
);

// 6. Thằng Khỉ Gầy -> Khỉ Gầy (9 vị trí)
replaceExact(
  'Thằng Khỉ Gầy',
  'Khỉ Gầy',
  9,
  'Thằng Khỉ Gầy -> Khỉ Gầy'
);

// 7. C373: Viết hoa đầu dòng anh ba Kha
replaceExact(
  'anh ba Kha cũng chẳng biết nên khóc hay nên cười',
  'Anh ba Kha cũng chẳng biết nên khóc hay nên cười',
  1,
  'C373 Viết hoa Anh ba Kha'
);

// 8. Chuẩn hóa điểm công -> công điểm (38 vị trí)
replaceExact(
  'điểm công',
  'công điểm',
  38,
  'điểm công -> công điểm'
);

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
