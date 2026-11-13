import fs from 'fs';

const ch335 = fs.readFileSync('C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Chương 335.txt', 'utf8');
console.log('Ch.335 has quotes:', ch335.includes('“Áo bán mười lăm'));

const ch753 = fs.readFileSync('C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Chương 753.txt', 'utf8');
console.log('Ch.753 has cô không biết:', ch753.includes('“Cô không biết'));

const ch996 = fs.readFileSync('C:\\Users\\dthuo\\Downloads\\chị gái ác,\\Chương 996.txt', 'utf8');
console.log('Ch.996 has HOAN:', ch996.includes('— HOÀN —'));
