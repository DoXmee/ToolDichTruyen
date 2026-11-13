import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  return fs.readFileSync(path.join(novelDir, `Chương ${n}.txt`), 'utf8');
}

console.log('=== KIỂM TRA HỆ LỚP HỌC TRONG VI VÀ RAW ===');
console.log('--- C5 VI ---');
getViCh(5).split(/\r?\n/).filter(l => l.includes('lớp') || l.includes('cấp')).forEach(l => console.log('VI C5:', l.trim()));

console.log('--- C294 & C295 VI ---');
getViCh(294).split(/\r?\n/).filter(l => l.includes('khối Sáu') || l.includes('lớp')).forEach(l => console.log('VI C294:', l.trim()));
getViCh(295).split(/\r?\n/).filter(l => l.includes('5-2-2') || l.includes('tiểu học') || l.includes('năm')).forEach(l => console.log('VI C295:', l.trim()));

console.log('--- C333 & C334 VI ---');
getViCh(333).split(/\r?\n/).filter(l => l.includes('lớp') || l.includes('khối')).forEach(l => console.log('VI C333:', l.trim()));
getViCh(334).split(/\r?\n/).filter(l => l.includes('lớp') || l.includes('khối')).forEach(l => console.log('VI C334:', l.trim()));
