import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  return fs.readFileSync(path.join(novelDir, `Chương ${n}.txt`), 'utf8');
}

console.log('=== KIỂM TRA THUẬT NGỮ SECTION IV ===');

// combo C413
console.log('--- C413 combo ---');
getViCh(413).split(/\r?\n/).filter(l => l.includes('combo')).forEach(l => console.log('VI:', l.trim()));

// logo C415, 418
console.log('--- C415 & 418 logo ---');
getViCh(415).split(/\r?\n/).filter(l => l.includes('logo')).forEach(l => console.log('VI C415:', l.trim()));
getViCh(418).split(/\r?\n/).filter(l => l.includes('logo')).forEach(l => console.log('VI C418:', l.trim()));

// Lưu lão lão C345
console.log('--- C345 Lưu lão lão ---');
getViCh(345).split(/\r?\n/).filter(l => l.includes('Lưu lão lão') || l.includes('Đại Quan Viên')).forEach(l => console.log('VI C345:', l.trim()));

// Search raw for 劉姥姥
const mLLL = [...textRaw.matchAll(/劉姥姥/g)];
console.log('Raw 劉姥姥 matches count:', mLLL.length);
mLLL.forEach(m => console.log('RAW 劉姥姥:', JSON.stringify(textRaw.slice(m.index - 20, m.index + 50))));

// Search raw for 套餐 (combo) and logo / 標誌
const mCombo = [...textRaw.matchAll(/套餐/g)];
console.log('Raw 套餐 matches count:', mCombo.length);
mCombo.forEach(m => console.log('RAW 套餐:', JSON.stringify(textRaw.slice(m.index - 20, m.index + 50))));

const mLogo = [...textRaw.matchAll(/logo|LOGO|标志|標誌/g)];
console.log('Raw logo matches count:', mLogo.length);
mLogo.forEach(m => console.log('RAW logo:', JSON.stringify(textRaw.slice(m.index - 20, m.index + 50))));
