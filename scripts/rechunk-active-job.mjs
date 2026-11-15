import fs from 'node:fs';
import path from 'node:path';

const jobPath = path.join(process.env.APPDATA, 'tool-dich-truyen', 'jobs', 'b09e5382-92fc-4dab-9fca-f65f1ce1e770.json');
if (!fs.existsSync(jobPath)) {
  console.error('Job file does not exist:', jobPath);
  process.exit(1);
}

// Backup first
const backupPath = jobPath + '.bak-' + Date.now();
fs.copyFileSync(jobPath, backupPath);
console.log('Backed up job to:', backupPath);

const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));

function splitChapters(source) {
  const headers = [...source.matchAll(/(?:^|\n)[ \t]*Chương[ \t]+(\d+)[^\n]*/giu)];
  if (!headers.length) return [{ id: 'CH1', number: 1, title: 'Chương 1', text: source }];
  const seen = new Set();
  return headers.map((h, i) => {
    const number = Number(h[1]);
    if (seen.has(number)) throw new Error('Nguồn trùng số chương ' + number);
    seen.add(number);
    return {
      id: 'CH' + number,
      number,
      title: h[0].trim(),
      text: source.slice(h.index, headers[i + 1]?.index ?? source.length).trim()
    };
  });
}

function groupAdaptiveChapterChunks(source, options) {
  const chapters = splitChapters(source);
  const result = [];
  const maxBatchChars = options?.maxBatchChars ?? 3500;
  const maxChapters = options?.maxChapters ?? 10;
  let i = 0;
  let offset = 0;
  while (i < chapters.length) {
    const batch = [chapters[i]];
    let currentLength = chapters[i].text.length;
    while (batch.length < maxChapters && (i + batch.length) < chapters.length) {
      const next = chapters[i + batch.length];
      if (currentLength + 2 + next.text.length <= maxBatchChars) {
        batch.push(next);
        currentLength += 2 + next.text.length;
      } else {
        break;
      }
    }
    const text = batch.map((c) => c.text).join('\n\n');
    const first = batch[0];
    const last = batch[batch.length - 1];
    const id = first.id === last.id ? 'V3-' + first.id : 'V3-' + first.id + '-' + last.id;
    result.push({
      id,
      index: result.length,
      start: offset,
      end: offset + text.length,
      text,
      chapterCount: batch.length
    });
    offset += text.length + 2;
    i += batch.length;
  }
  return result;
}

const completedSeg0 = job.segments[0];
const remainingText = job.segments.slice(1).map(s => s.sourceText).join('\n\n');
const newChunks = groupAdaptiveChapterChunks(remainingText, { maxBatchChars: 3500 });

const newSegments = newChunks.map((c, i) => ({
  id: c.id,
  index: 1 + i,
  start: completedSeg0.end + 2 + c.start,
  end: completedSeg0.end + 2 + c.end,
  sourceText: c.text,
  translatedText: '',
  status: 'queued',
  attempts: 0
}));

job.segments = [completedSeg0, ...newSegments];
job.status = 'paused';
job.aiProvider = 'deepseek';
job.executionMode = 'api';
delete job.error;
if (job.pipelineV3) {
  job.pipelineV3.stage = 'ready';
  job.pipelineV3.batchChapters = 1;
}

fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
console.log('Successfully re-chunked job!');
console.log('Total segments:', job.segments.length);
console.log('Segment 0:', job.segments[0].id, job.segments[0].status);
console.log('Segment 1:', job.segments[1].id, job.segments[1].status);
console.log('Segment 2:', job.segments[2].id, job.segments[2].status);
