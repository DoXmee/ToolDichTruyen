import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const hash = buf => crypto.createHash('sha256').update(buf).digest('hex');

console.log('=== BÁO CÁO KIỂM TOÁN TỔNG THỂ (AUDIT REPORT) ===\n');

// 1. Audit Novel file
const novelPath = 'C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Tổng hợp từ chương 1-996.txt';
const novelText = fs.readFileSync(novelPath, 'utf8');

const nangMatches = [...novelText.matchAll(/\b(nàng|Nàng)\b/gu)];
console.log('1. Kiếm tra "nàng":');
console.log(`   - Tổng số từ: ${nangMatches.length}`);
nangMatches.forEach(m => {
  const s = Math.max(0, m.index - 20);
  const e = Math.min(novelText.length, m.index + 35);
  console.log(`     + Trích đoạn: "${novelText.slice(s, e).replace(/\n/g, ' ')}"`);
});

const dauTrocMatches = [...novelText.matchAll(/Trợ lý Đầu Trọc/gu)];
console.log(`\n2. Kiểm tra "Trợ lý Đầu Trọc": ${dauTrocMatches.length} ca sót.`);

const dauTrocLowerMatches = [...novelText.matchAll(/Trợ lý đầu trọc/gu)];
console.log(`   - Đã chuẩn hóa thành "Trợ lý đầu trọc": ${dauTrocLowerMatches.length} ca.`);

console.log('\n3. Kiểm tra Chương 753 (Lời thoại đạo diễn La Vân):');
const ch753Pos = novelText.indexOf('Chương 753');
const ch754Pos = novelText.indexOf('Chương 754');
const ch753 = novelText.slice(ch753Pos, ch754Pos);
console.log(`   - Chứa "Cô không biết": ${ch753.includes('“Cô không biết')}`);
console.log(`   - Chứa "hợp tác với tôi": ${ch753.includes('hợp tác với tôi')}`);
console.log(`   - Chứa "tôi còn giật cả mình": ${ch753.includes('tôi còn giật cả mình')}`);
console.log(`   - Chứa "công lao của cô đấy": ${ch753.includes('công lao của cô đấy')}`);
console.log(`   - Còn sót "Em không biết": ${ch753.includes('“Em không biết')}`);

console.log('\n4. Kiểm tra Chương 335 (Loa phát thanh):');
const ch335Pos = novelText.indexOf('Chương 335');
const ch336Pos = novelText.indexOf('Chương 336');
const ch335 = novelText.slice(ch335Pos, ch336Pos);
console.log(`   - Chuẩn ngoặc kép “...”: ${ch335.includes('“Áo bán mười lăm')}`);
console.log(`   - Còn sót ngoặc đơn '...': ${ch335.includes("'Áo bán mười lăm")}`);

console.log('\n5. Kiểm tra kết truyện Chương 996:');
console.log(`   - Đã có "— HOÀN —": ${novelText.includes('— HOÀN —')}`);

// 2. Audit Prompt
console.log('\n6. Kiểm tra Prompt Niên Đại (resources/prompts/nien-dai.txt):');
const promptText = fs.readFileSync('resources/prompts/nien-dai.txt', 'utf8');
console.log(`   - Khóa "nàng" -> "cô": ${promptText.includes('CẤM dùng "nàng"')}`);
console.log(`   - Khóa "chàng" -> "anh": ${promptText.includes('CẤM dùng "chàng"')}`);
console.log(`   - Khóa "huynh" -> "anh": ${promptText.includes('CẤM dùng "huynh"')}`);
console.log(`   - Khóa "muội" -> "em": ${promptText.includes('CẤM dùng "muội"')}`);
console.log(`   - Khóa "đệ" -> "em": ${promptText.includes('CẤM dùng "đệ"')}`);

// 3. Audit Deployments
console.log('\n7. Kiểm tra triển khai nhị phân app.asar thực tế:');
const asarPaths = [
  'release\\win-unpacked\\resources\\app.asar',
  path.join(process.env.LOCALAPPDATA, 'Programs\\ToolDichTruyen\\resources\\app.asar'),
  'D:\\Tool dịch truyện\\release\\win-unpacked\\resources\\app.asar'
];
asarPaths.forEach(p => {
  if (fs.existsSync(p)) {
    const stat = fs.statSync(p);
    const h = hash(fs.readFileSync(p));
    console.log(`   ✓ ${p}`);
    console.log(`     Size: ${stat.size} bytes | Hash: ${h.slice(0, 16)}... | Modified: ${stat.mtime.toISOString()}`);
  } else {
    console.log(`   ✗ NOT FOUND: ${p}`);
  }
});

// 4. Audit Running Job checkpoint
console.log('\n8. Kiểm tra trạng thái Job dịch dở dang:');
const jobPath = 'C:\\Users\\dthuo\\AppData\\Roaming\\tool-dich-truyen\\jobs\\5dbc420f-f482-42cd-beb4-ebe9b354cd8e.json';
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
const completed = job.segments.filter(s => s.status === 'completed' && Boolean(s.translatedText?.trim()));
console.log(`   - Trạng thái Job: ${job.status}`);
console.log(`   - Số phân đoạn đã hoàn thành bảo toàn: ${completed.length} / ${job.segments.length}`);
console.log(`   - Phân đoạn kế tiếp sẽ dịch khi bấm Tiếp tục: Phân đoạn ${job.currentSegmentIndex} (${job.segments[job.currentSegmentIndex]?.id})`);
console.log(`   - Quy tắc niên đại đã nạp vào Job: ${job.memory?.customRules?.length} quy tắc.`);
