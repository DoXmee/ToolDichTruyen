import fs from 'node:fs';
import path from 'node:path';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const textRaw = fs.readFileSync(path.join(novelDir, 'File tổng c.gốc (1-150)_c.mới (1-478).txt'), 'utf8');

const matches = [...textRaw.matchAll(/[\u4e00-\u9fa5]{1,5}：[“"「][？\?…\.]+["”」]/g)];
console.log('Raw meme dialogue count:', matches.length);
matches.slice(0, 10).forEach(m => console.log('RAW meme:', m[0]));
