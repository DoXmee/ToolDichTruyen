import fs from 'fs';

const filePath = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt';
let content = fs.readFileSync(filePath, 'utf8');

console.log('Original content length:', content.length);

// 1. Replace standalone "nàng" / "Nàng" preserving "nàng thơ" and "cô nàng"
let nangReplaced = 0;
// Regex for lowercase: not preceded by 'cô ' and not followed by ' thơ'
content = content.replace(/(?<!cô\s)\bnàng\b(?!\s+thơ)/gu, (match) => {
  nangReplaced++;
  return 'cô';
});
// Regex for uppercase: not preceded by 'Cô ' and not followed by ' thơ'
let NangReplaced = 0;
content = content.replace(/(?<!Cô\s)\bNàng\b(?!\s+thơ)/gu, (match) => {
  NangReplaced++;
  return 'Cô';
});
console.log(`Replaced nàng: ${nangReplaced}, Nàng: ${NangReplaced}`);

// 2. Ch.753 La Vân dialogue fixes
// Let's find Ch.753 lines and replace them precisely
const ch753Targets = [
  {
    from: '“Em không biết hai chuyện này trùng hợp đến mức nào đâu, ợ, được công chiếu ở đại lục, lại còn có người quen giúp đỡ bắc cầu, tuy rằng người quen đó cũng là tự tìm tới. Đó là biên kịch lão sư từng hợp tác với anh một lần, cô ấy được mời tới dạy tại một trường điện ảnh ở Bắc Kinh, đã tám chín năm không liên lạc rồi. Cô ấy đột nhiên tìm tới cửa, anh còn giật cả mình… Bán bản quyền sang các nước khác thì càng trùng hợp hơn, Lão Bản đó là Hoa kiều về nước, cũng phát triển trong giới giải trí, quen biết không ít mối quan hệ, sau khi về nước vẫn muốn ăn cơm trong giới giải trí, nên làm cầu nối bán phim trong nước ra nước ngoài, bán phim nước ngoài vào trong nước, thế quái nào lại để mắt tới bộ phim này của anh…”',
    to: '“Cô không biết hai chuyện này trùng hợp đến mức nào đâu, ợ, được công chiếu ở đại lục, lại còn có người quen giúp đỡ bắc cầu, tuy rằng người quen đó cũng là tự tìm tới. Đó là biên kịch lão sư từng hợp tác với tôi một lần, cô ấy được mời tới dạy tại một trường điện ảnh ở Bắc Kinh, đã tám chín năm không liên lạc rồi. Cô ấy đột nhiên tìm tới cửa, tôi còn giật cả mình… Bán bản quyền sang các nước khác thì càng trùng hợp hơn, Lão Bản đó là Hoa kiều về nước, cũng phát triển trong giới giải trí, quen biết không ít mối quan hệ, sau khi về nước vẫn muốn ăn cơm trong giới giải trí, nên làm cầu nối bán phim trong nước ra nước ngoài, bán phim nước ngoài vào trong nước, thế quái nào lại để mắt tới bộ phim này của tôi…”'
  },
  {
    from: '“Nói đi cũng phải nói lại, hai chuyện đại hỷ này, còn có công lao của em đấy!”',
    to: '“Nói đi cũng phải nói lại, hai chuyện đại hỷ này, còn có công lao của cô đấy!”'
  },
  {
    from: '“Sau khi tới Thượng Hải, việc đầu tiên anh làm là tới thăm vị biên kịch lão sư đó, cô ấy gần đây vừa hay đang ở Thượng Hải, hình như là đang viết kịch bản cho một bộ phim hợp tác Trung - Hồng nào đó. Anh thử thăm dò xem cô ấy giúp đỡ bắc cầu vì điều gì, cô ấy nói…”',
    to: '“Sau khi tới Thượng Hải, việc đầu tiên tôi làm là tới thăm vị biên kịch lão sư đó, cô ấy gần đây vừa hay đang ở Thượng Hải, hình như là đang viết kịch bản cho một bộ phim hợp tác Trung - Hồng nào đó. Tôi thử thăm dò xem cô ấy giúp đỡ bắc cầu vì điều gì, cô ấy nói…”'
  },
  {
    from: '“Cô ấy nói là thấy bài phỏng vấn về bộ phim của em trên báo Thượng Hải, lại xem chương trình em trả lời bằng tiếng Anh khi được phỏng vấn trong lớp học, cảm thấy em khá thú vị, nên đã tới Hồng Kông xem phim… Vị Lão Bản giúp bán bản quyền thì càng thực tế hơn, ông ta nói để mắt tới căn biệt thự nhỏ chưa hoàn thiện của bất động sản Đối Xứng, hy vọng em có thể để lại cho ông ta một căn có vị trí đẹp nhất, tiện thể giảm giá cho ông ta.”',
    to: '“Cô ấy nói là thấy bài phỏng vấn về bộ phim của cô trên báo Thượng Hải, lại xem chương trình cô trả lời bằng tiếng Anh khi được phỏng vấn trong lớp học, cảm thấy cô khá thú vị, nên đã tới Hồng Kông xem phim… Vị Lão Bản giúp bán bản quyền thì càng thực tế hơn, ông ta nói để mắt tới căn biệt thự nhỏ chưa hoàn thiện của bất động sản Đối Xứng, hy vọng cô có thể để lại cho ông ta một căn có vị trí đẹp nhất, tiện thể giảm giá cho ông ta.”'
  },
  {
    from: '“Tiền cọc bao nhiêu? Anh trả giúp ông ta, em chọn cho anh một căn có vị trí đẹp nhất trong số những căn còn lại…”',
    to: '“Tiền cọc bao nhiêu? Tôi trả giúp ông ta, cô chọn cho tôi một căn có vị trí đẹp nhất trong số những căn còn lại…”'
  },
  {
    from: '“Hai chuyện đại hỷ này, đều có công lao của em… Hợp đồng chúng ta ký ban đầu là dựa trên khoản đầu tư mười lăm vạn, cộng với thù lao của em trai em là ba vạn, tổng cộng là mười tám vạn cổ phần để chia tiền cho em. Anh đã bàn với nhà sản xuất, quyết định tính cho em theo cổ phần đầu tư là hai mươi vạn, số tiền dư ra, anh sẽ bỏ tiền túi…”',
    to: '“Hai chuyện đại hỷ này, đều có công lao của cô… Hợp đồng chúng ta ký ban đầu là dựa trên khoản đầu tư mười lăm vạn, cộng với thù lao của em trai cô là ba vạn, tổng cộng là mười tám vạn cổ phần để chia tiền cho cô. Tôi đã bàn với nhà sản xuất, quyết định tính cho cô theo cổ phần đầu tư là hai mươi vạn, số tiền dư ra, tôi sẽ bỏ tiền túi…”'
  }
];

for (const t of ch753Targets) {
  if (content.includes(t.from)) {
    content = content.replace(t.from, t.to);
    console.log('Successfully replaced Ch.753 snippet:', t.from.slice(0, 40));
  } else {
    console.error('Target not found in Ch.753:', t.from.slice(0, 40));
  }
}

// 3. Ch.335 megaphone lines
const megaphoneTarget = "'Áo bán mười lăm, quần bò hai mươi lăm, tặng cái kẹp tóc keo kiệt quá, sửa gấu quần còn ăn bớt vải, mọi người tuyệt đối đừng mắc lừa!'";
const megaphoneReplacement = "“Áo bán mười lăm, quần bò hai mươi lăm, tặng cái kẹp tóc keo kiệt quá, sửa gấu quần còn ăn bớt vải, mọi người tuyệt đối đừng mắc lừa!”";
let megaphoneCount = 0;
while (content.includes(megaphoneTarget)) {
  content = content.replace(megaphoneTarget, megaphoneReplacement);
  megaphoneCount++;
}
console.log(`Replaced megaphone lines in Ch.335: ${megaphoneCount}`);

// 4. Trợ lý Đầu Trọc -> Trợ lý đầu trọc
let dauTrocCount = 0;
content = content.replace(/Trợ lý Đầu Trọc/gu, () => {
  dauTrocCount++;
  return 'Trợ lý đầu trọc';
});
console.log(`Replaced Trợ lý Đầu Trọc: ${dauTrocCount}`);

// 5. Ch.996 End: add — HOÀN —
if (!content.includes('— HOÀN —')) {
  content = content.trimEnd() + '\n\n— HOÀN —\n';
  console.log('Appended — HOÀN — to end of novel');
} else {
  console.log('Novel already has — HOÀN —');
}

// Save modified content
fs.writeFileSync(filePath, content, 'utf8');
console.log('Saved modified novel file. New length:', content.length);
