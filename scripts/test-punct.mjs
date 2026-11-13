import fs from 'node:fs';

const s = fs.readFileSync('scratch/pipeline-v3-20261111/app/out/main/index.js', 'utf8');
const a1 = 'const terminalPunctuationPattern = /[.!?。！？…»”"’\'」』)\\]}⟧:：—–~～]\\s*$/u;';
const a2 = '/^[“"「『（(]$/u.test(sourceTrimmed.slice(-1)) && /^[“"「『（(]$/u.test(trimmedTranslation.slice(-1)))';

console.log('split a1:', s.split(a1).length);
console.log('split a2:', s.split(a2).length);
