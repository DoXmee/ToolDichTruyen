import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textVi = fs.readFileSync(path.join(novelDir, 'Tổng hợp từ chương 1-478.txt'), 'utf8');
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

function getViCh(n) {
  const f = path.join(novelDir, `Chương ${n}.txt`);
  return fs.readFileSync(f, 'utf8');
}

console.log('=== KIỂM TRA VỢ ĐỘI TRƯỞNG NGƯU TRONG C52, 53, 55, 56 ===');
[52, 53, 55, 56].forEach(c => {
  const ch = getViCh(c);
  console.log(`\n--- Chương ${c} (VI) ---`);
  ch.split(/\r?\n/).filter(l => l.includes('Ngưu') || l.includes('Kha') || l.includes('vợ đội trưởng')).slice(0, 8).forEach(l => console.log('  ', l.trim()));
});
