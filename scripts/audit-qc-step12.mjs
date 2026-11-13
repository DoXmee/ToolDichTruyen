import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

const m1 = [...textRaw.matchAll(/生產隊|大隊/g)];
console.log('生產隊 / 大隊 matches count:', m1.length);
m1.slice(0, 10).forEach(m => console.log(' ', m[0], ':', JSON.stringify(textRaw.slice(m.index - 20, m.index + 30))));
