import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = path.join(novelDir, 'Tổng hợp từ chương 1-478.txt');

const text = fs.readFileSync(combinedFile, 'utf8');

console.log('--- 1. C250 Ông Kha ---');
const idx1 = text.indexOf('Ông Kha ăn một miếng');
console.log('Found idx1:', idx1, idx1 !== -1 ? JSON.stringify(text.slice(idx1 - 10, idx1 + 100)) : 'None');

console.log('--- 2. C180 & C181 bác Hà ---');
const matchesBacHa = [...text.matchAll(/bác Hà/g)];
console.log('Found bác Hà:', matchesBacHa.length);
matchesBacHa.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 20, m.index + 50))));

console.log('--- 3. C52 & C53 vợ đội trưởng Ngưu ---');
const idxC52 = text.indexOf('Vợ đội trưởng Ngưu là chị Kha sợ');
console.log('C52 chị Kha:', idxC52 !== -1 ? JSON.stringify(text.slice(idxC52, idxC52 + 60)) : 'None');
const idxC53 = text.indexOf('“Con à, hay là cứ đi kiểm tra thử đi.” Bà Kha');
console.log('C53 Bà Kha:', idxC53 !== -1 ? JSON.stringify(text.slice(idxC53, idxC53 + 80)) : 'None');

console.log('--- 4. C2 Bác Trương ---');
const idxC2 = text.indexOf('Bác Trương rót cho cháu nhé');
console.log('C2 Bác Trương:', idxC2 !== -1 ? JSON.stringify(text.slice(idxC2 - 20, idxC2 + 50)) : 'None');

console.log('--- 5. C29, C62, C292 Trần Chấn Hưng ---');
const idxC29 = text.indexOf('ông vẫn tiếp tục làm nghề thợ mộc');
console.log('C29 ông:', idxC29 !== -1 ? JSON.stringify(text.slice(idxC29 - 40, idxC29 + 60)) : 'None');
const idxC62 = text.indexOf('thuộc về anh.');
console.log('C62 anh:', idxC62 !== -1 ? JSON.stringify(text.slice(idxC62 - 40, idxC62 + 30)) : 'None');
const idxC292 = text.indexOf('Anh ấy dựa theo dáng vẻ của Tang Bưu');
console.log('C292 Anh ấy:', idxC292 !== -1 ? JSON.stringify(text.slice(idxC292 - 20, idxC292 + 60)) : 'None');

console.log('--- 6. Thằng Khỉ Gầy (9 chỗ) ---');
const matchesTKG = [...text.matchAll(/Thằng Khỉ Gầy/g)];
console.log('Matches Thằng Khỉ Gầy:', matchesTKG.length);
matchesTKG.forEach(m => console.log(' ', JSON.stringify(text.slice(m.index - 20, m.index + 40))));

console.log('--- 7. C373 anh ba Kha đầu dòng ---');
const idxC373 = text.indexOf('anh ba Kha cũng chẳng biết');
console.log('C373 anh ba Kha:', idxC373 !== -1 ? JSON.stringify(text.slice(idxC373 - 10, idxC373 + 60)) : 'None');

console.log('--- 8. điểm công vs công điểm ---');
const matchesDC = [...text.matchAll(/điểm công/g)];
const matchesCD = [...text.matchAll(/công điểm/g)];
console.log(`điểm công count: ${matchesDC.length}, công điểm count: ${matchesCD.length}`);
matchesDC.slice(0, 10).forEach(m => console.log('  điểm công sample:', JSON.stringify(text.slice(m.index - 20, m.index + 30))));
