import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');

const text = fs.readFileSync(combinedFile, 'utf8');

console.log('--- 1. Kiểm tra 3 chương cắt trước câu thoại ---');
// Ch.261
const idx261 = text.indexOf('Chương 261');
const idx262 = text.indexOf('Chương 262');
console.log('Ch.261 end:', JSON.stringify(text.slice(idx262 - 120, idx262)));
console.log('Ch.262 start:', JSON.stringify(text.slice(idx262, idx262 + 120)));

// Ch.297
const idx297 = text.indexOf('Chương 297');
const idx298 = text.indexOf('Chương 298');
console.log('Ch.297 end:', JSON.stringify(text.slice(idx298 - 120, idx298)));
console.log('Ch.298 start:', JSON.stringify(text.slice(idx298, idx298 + 120)));

// Ch.447
const idx447 = text.indexOf('Chương 447');
const idx448 = text.indexOf('Chương 448');
console.log('Ch.447 end:', JSON.stringify(text.slice(idx448 - 120, idx448)));
console.log('Ch.448 start:', JSON.stringify(text.slice(idx448, idx448 + 120)));

console.log('\n--- 2. Kiểm tra Yan ---');
const matchesYan = [...text.matchAll(/\bYan\b/g)];
console.log('Yan matches:', matchesYan.length);
matchesYan.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

console.log('\n--- 3. Kiểm tra Hoa Quốc ---');
const matchesHQ = [...text.matchAll(/Hoa Quốc/g)];
console.log('Hoa Quốc matches:', matchesHQ.length);
matchesHQ.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

console.log('\n--- 4. Kiểm tra Trịnh lão nhị & Kha lão tam & Vương Đội Trưởng ---');
const matchesTLN = [...text.matchAll(/Trịnh lão nhị/g)];
console.log('Trịnh lão nhị matches:', matchesTLN.length);
matchesTLN.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

const matchesKLT = [...text.matchAll(/Kha lão tam/g)];
console.log('Kha lão tam matches:', matchesKLT.length);
matchesKLT.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

const matchesVDT = [...text.matchAll(/Vương Đội Trưởng/g)];
console.log('Vương Đội Trưởng matches:', matchesVDT.length);
matchesVDT.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

console.log('\n--- 5. Kiểm tra Ch.28 con trai út ---');
const idx28 = text.indexOf('Chương 28');
const idx29 = text.indexOf('Chương 29');
const ch28Text = text.slice(idx28, idx29);
ch28Text.split(/\r?\n/).filter(l => l.includes('Con trai út') || l.includes('con trai út')).forEach(l => console.log(' ', l.trim()));

console.log('\n--- 6. Kiểm tra thím hai họ Lữ vs chị dâu hai Lữ ---');
const matchesTHL = [...text.matchAll(/thím hai họ Lữ/g)];
console.log('thím hai họ Lữ matches:', matchesTHL.length);
matchesTHL.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 30, m.index + 50))));

console.log('\n--- 7. Quét "cô bé" từ Chương 415 đến 477 ---');
const idx415 = text.indexOf('Chương 415');
const idx478 = text.indexOf('Chương 478');
const textAdult = text.slice(idx415, idx478);
const matchesCoBe = [...textAdult.matchAll(/cô bé/g)];
console.log('Tổng số lần "cô bé" từ Ch.415 đến Ch.477:', matchesCoBe.length);
console.log('Mẫu 5 câu đầu chứa "cô bé":');
matchesCoBe.slice(0, 5).forEach(m => console.log(' ', JSON.stringify(textAdult.slice(m.index - 20, m.index + 40))));
console.log('Mẫu 5 câu cuối chứa "cô bé":');
matchesCoBe.slice(-5).forEach(m => console.log(' ', JSON.stringify(textAdult.slice(m.index - 20, m.index + 40))));
