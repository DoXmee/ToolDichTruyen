import fs from 'node:fs';
import path from 'node:path';

const jobPath = path.join(process.env.APPDATA, 'tool-dich-truyen', 'jobs', 'd1ca69b0-1b7e-4339-9761-ee020b1ee074.json');
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
  const maxBatchChars = options?.maxBatchChars ?? 2200;
  const maxChapters = options?.maxChapters ?? 2;
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

const completedSegments = job.segments.filter(s => s.status === 'completed');
const completedCount = completedSegments.length;
console.log('Preserving', completedCount, 'completed segments (from 0 to', completedCount - 1, ')');

const remainingText = job.segments.slice(completedCount).map(s => s.sourceText).join('\n\n');
const newChunks = groupAdaptiveChapterChunks(remainingText, { maxBatchChars: 2200, maxChapters: 2 });

const lastEnd = completedSegments[completedSegments.length - 1].end;
let currentOffset = lastEnd + 2;

const newSegments = newChunks.map((c, i) => {
  const segStart = currentOffset;
  const segEnd = currentOffset + c.text.length;
  currentOffset = segEnd + 2;
  return {
    id: c.id,
    index: completedCount + i,
    start: segStart,
    end: segEnd,
    sourceText: c.text,
    translatedText: '',
    status: 'queued',
    attempts: 0
  };
});

job.segments = [...completedSegments, ...newSegments];
job.currentSegmentIndex = completedCount;
job.status = 'paused';
job.conversationInitialized = false;
job.conversationHasBasePrompt = false;
delete job.error;
if (job.pipelineV3) {
  job.pipelineV3.stage = 'ready';
}

fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
console.log('Successfully re-chunked active job for ChatGPT Web!');
console.log('Total segments now:', job.segments.length);
console.log('Next segment to resume:', job.segments[completedCount].id, 'index:', completedCount, 'chars:', job.segments[completedCount].sourceText.length);
