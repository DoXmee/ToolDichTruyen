import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textVi = fs.readFileSync(path.join(novelDir, 'Chương 82.txt'), 'utf8');
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

console.log('=== KIỂM TRA CHƯƠNG 82 ===');
textVi.split(/\r?\n/).filter(l => l.includes('?') || l.includes('？')).forEach(l => console.log('VI:', JSON.stringify(l.trim())));

// Find in raw around Ch.82
const idx = textRaw.indexOf('裏突然多了半個包子的王燕：？');
console.log('Raw C82 context:\n', textRaw.slice(idx - 100, idx + 200));
