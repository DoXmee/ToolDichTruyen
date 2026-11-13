import fs from 'node:fs';

const novelDir = 'C:/Users/dthuo/Downloads/drive-download-20261108T042149Z-1-001/Cả Thôn Đều Trọng Sinh, Chỉ Mình Tôi Không';
const combinedFile = `${novelDir}/Tổng hợp từ chương 1-478.txt`;

let content = fs.readFileSync(combinedFile, 'utf8');
console.log('Original length:', content.length);

const checks = [
  { name: 'Ch.469 rác gõ máy', pattern: /Không chỉ một lma cao lập hai công ty/g, replace: 'Không chỉ một lúc thành lập hai công ty' },
  { name: 'Ch.125 trưởng thôn gia gia', pattern: /trưởng thôn gia gia/g, replace: 'ông nội trưởng thôn' },
  { name: 'Ch.454 ông nội La', pattern: /Nhưng em nhớ ông nội La chẳng phải rất nghiêm túc sao/g, replace: 'Nhưng em nhớ ông nội Yến chẳng phải rất nghiêm túc sao' },
  { name: 'Ch.451 Trịnh Đông Lâm xưng Tôi cô', pattern: /“Tôi biết rồi, cô cứ yên tâm\.”/g, replace: '“Anh biết rồi, em cứ yên tâm.”' },
  { name: 'Ch.433 Tử An Tôi không quen', pattern: /“Tôi không quen ở chung với người lạ\.”/g, replace: '“Anh không quen ở chung với người lạ.”' },
  { name: 'Ch.434 Thư Thư Tôi cũng không mệt', pattern: /“Tôi cũng không mệt lắm\.”/g, replace: '“Em cũng không mệt lắm.”' },
  { name: 'Ch.436 Tử An Tôi nấu mì', pattern: /Ăn khuya không\? Tôi nấu mì nhé\?/g, replace: 'Ăn khuya không? Anh nấu mì nhé?' },
  { name: 'Ch.472 ellipsis Hán', pattern: /……/g, replace: '…' },
  { name: 'Ch.76 thôn Phong Dương đầu câu', pattern: /\n(\s*)thôn Phong Dương có rất nhiều ruộng nước/g, replace: '\n$1Thôn Phong Dương có rất nhiều ruộng nước' }
];

for (const c of checks) {
  const matches = [...content.matchAll(c.pattern)];
  console.log(`Check [${c.name}]: found ${matches.length} matches.`);
  if (matches.length > 0) {
    console.log(`  Sample before:`, matches[0][0]);
  }
}
