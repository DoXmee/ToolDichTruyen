import fs from 'node:fs';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = `${novelDir}/Tổng hợp từ chương 1-478.txt`;

const content = fs.readFileSync(combinedFile, 'utf8');

// 1. Ch.232 Mèo Tang Bưu
console.log('--- 1. Ch.232 Mèo Tang Bưu ---');
const idx232 = content.indexOf('Chương 232');
const idx233 = content.indexOf('Chương 233');
const ch232Text = content.slice(idx232, idx233);
console.log('Ch.232 slice with mèo:');
ch232Text.split(/\r?\n/).filter(l => l.includes('mèo') || l.includes('tam thể')).forEach(l => console.log(' ', l.trim()));

// 2. Ch.451 Thư Thư nói với Tử An
console.log('\n--- 2. Ch.451 Thư Thư nói với Tử An ---');
const idx451 = content.indexOf('Chương 451');
const idx452 = content.indexOf('Chương 452');
const ch451Text = content.slice(idx451, idx452);
ch451Text.split(/\r?\n/).filter(l => l.includes('Tôi góp') || l.includes('tôi nắm') || l.includes('Tôi không') || l.includes('trước khi tôi') || l.includes('cô cứ yên tâm')).forEach(l => console.log(' ', l.trim()));

// 3. Ch.44 câu trùng
console.log('\n--- 3. Ch.44 câu trùng ---');
const idx44 = content.indexOf('Chương 44\n');
const idx45 = content.indexOf('Chương 45\n');
const ch44Text = content.slice(idx44, idx45);
ch44Text.split(/\r?\n/).filter(l => l.includes('khai giảng đầu tiên')).forEach(l => console.log(' ', l.trim()));

// 4. Ch.307 Nhà máy phân bón hóa học
console.log('\n--- 4. Ch.307 Nhà máy phân bón hóa học ---');
const idx307 = content.indexOf('Chương 307');
const idx308 = content.indexOf('Chương 308');
const ch307Text = content.slice(idx307, idx308);
ch307Text.split(/\r?\n/).filter(l => l.includes('phân bón hóa học')).forEach(l => console.log(' ', l.trim()));

// 5. thím Trương đầu câu
console.log('\n--- 5. thím Trương đầu câu ---');
const thimTruongMatches = [...content.matchAll(/(?:^|\r?\n)thím Trương\b[^\r\n]*/g)];
console.log(`thím Trương đầu câu: ${thimTruongMatches.length} matches`);
thimTruongMatches.forEach(m => console.log(' ', m[0].trim()));

// 6. Ch.410 Yến Tử An?
console.log('\n--- 6. Ch.410 Yến Tử An? ---');
const idx410 = content.indexOf('Chương 410');
const idx411 = content.indexOf('Chương 411');
const ch410Text = content.slice(idx410, idx411);
console.log(ch410Text.slice(0, 300));
