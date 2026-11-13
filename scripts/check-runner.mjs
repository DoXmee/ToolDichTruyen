import fs from 'fs';

const content = fs.readFileSync('src/main/translation/TranslationJobRunner.ts', 'utf-8');
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('pauseJob') || l.includes('status = \'paused\'') || l.includes('status = "paused"')) {
    console.log(i + 1, l.trim());
  }
});
