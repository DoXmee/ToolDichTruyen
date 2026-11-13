import fs from 'fs';

const path = 'C:\\Users\\dthuo\\AppData\\Roaming\\tool-dich-truyen\\jobs\\5dbc420f-f482-42cd-beb4-ebe9b354cd8e.json';
const d = JSON.parse(fs.readFileSync(path, 'utf-8'));
console.log('Current segment index:', d.currentSegmentIndex);
for (let i = d.currentSegmentIndex - 2; i <= d.currentSegmentIndex + 2; i++) {
  if (d.segments[i]) {
    console.log(`Segment ${i} (${d.segments[i].id}): status=${d.segments[i].status}, textLen=${d.segments[i].translatedText?.length || 0}`);
  }
}
