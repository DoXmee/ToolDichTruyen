import fs from 'node:fs';
import path from 'node:path';

const jobPath = path.join(process.env.APPDATA, 'tool-dich-truyen', 'jobs', 'c190b921-0e3c-4d4f-8015-b3dfad82ed59.json');
if (!fs.existsSync(jobPath)) {
  console.error('Job file does not exist:', jobPath);
  process.exit(1);
}

// 1. Backup job
const backupPath = jobPath + '.bak-' + Date.now();
fs.copyFileSync(jobPath, backupPath);
console.log('Backed up job to:', backupPath);

const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));

// 2. Chunker functions with isolated sub-parts
function splitChapters(source) {
  const headers = [...source.matchAll(/(?:^|\n)[ \t]*Chương[ \t]+(\d+)[^\n]*/giu)];
  if (!headers.length) return [{ id: 'CH1', number: 1, title: 'Chương 1', text: source }];

  const results = [];
  const prologue = source.slice(0, headers[0].index).trim();
  if (prologue) {
    results.push({
      id: 'CH0',
      number: 0,
      title: 'Văn án / Lời mở đầu',
      text: prologue,
    });
  }

  const seen = new Set();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const number = Number(h[1]);
    if (seen.has(number)) throw new Error('Nguồn trùng số chương ' + number);
    seen.add(number);
    results.push({
      id: 'CH' + number,
      number,
      title: h[0].trim(),
      text: source.slice(h.index, headers[i + 1]?.index ?? source.length).trim(),
    });
  }
  return results;
}

function splitOversizedLine(line, maxChars) {
  if (line.length <= maxChars) return [line];
  const slices = [];
  let start = 0;
  while (start < line.length) {
    if (start + maxChars >= line.length) {
      slices.push(line.slice(start));
      break;
    }
    const searchWindow = line.slice(start, start + maxChars);
    const puncMatch = [...searchWindow.matchAll(/[。！？!?；;，,\n]/gu)];
    let cut = -1;
    if (puncMatch.length > 0) {
      const lastPunc = puncMatch[puncMatch.length - 1];
      cut = start + lastPunc.index + lastPunc[0].length;
    }
    if (cut <= start || cut > start + maxChars) {
      cut = start + maxChars;
    }
    slices.push(line.slice(start, cut));
    start = cut;
  }
  return slices;
}

function splitLongChapterIntoParts(chapter, maxChars) {
  if (chapter.text.length <= maxChars) return [chapter];

  const lines = chapter.text.split(/\r?\n/u);
  const parts = [];
  let currentLines = [];
  let currentLen = 0;
  let partIndex = 1;

  const headerMatch = lines[0]?.match(/^[ \t]*Chương[ \t]+\d+[^\n]*/iu);
  const headerLine = headerMatch ? lines[0].trim() : '';
  const startIdx = headerMatch ? 1 : 0;

  if (headerLine) {
    currentLines.push(headerLine);
    currentLen += headerLine.length;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineChunks = rawLine.length > maxChars ? splitOversizedLine(rawLine, maxChars - 100) : [rawLine];

    for (const chunk of lineChunks) {
      const addedLen = (currentLines.length > 0 ? 1 : 0) + chunk.length;
      if (currentLines.length > 0 && currentLen + addedLen > maxChars) {
        const text = currentLines.join('\n').trim();
        if (text) {
          parts.push({
            id: `${chapter.id}-P${partIndex}`,
            number: chapter.number,
            title: partIndex === 1 ? chapter.title : `${chapter.title} (phần ${partIndex})`,
            text,
          });
          partIndex++;
        }
        currentLines = [chunk];
        currentLen = chunk.length;
      } else {
        currentLines.push(chunk);
        currentLen += addedLen;
      }
    }
  }

  if (currentLines.length > 0) {
    const text = currentLines.join('\n').trim();
    if (text) {
      parts.push({
        id: partIndex > 1 ? `${chapter.id}-P${partIndex}` : chapter.id,
        number: chapter.number,
        title: partIndex > 1 ? `${chapter.title} (phần ${partIndex})` : chapter.title,
        text,
      });
    }
  }

  return parts.length > 0 ? parts : [chapter];
}

function groupAdaptiveChapterChunks(source, options) {
  const maxBatchChars = options?.maxBatchChars ?? 2200;
  const maxChapters = options?.maxChapters ?? 2;

  const rawChapters = splitChapters(source);
  const chapters = [];
  for (const c of rawChapters) {
    if (c.text.length > maxBatchChars) {
      const parts = splitLongChapterIntoParts(c, maxBatchChars);
      chapters.push(...parts);
    } else {
      chapters.push(c);
    }
  }

  const result = [];
  let i = 0;
  let offset = 0;
  while (i < chapters.length) {
    const current = chapters[i];
    const batch = [current];
    let currentLength = current.text.length;

    // NGUYÊN TẮC: sub-part (-P) không được gộp với bất kỳ chương khác
    const isCurrentSubPart = current.id.includes('-P');

    while (!isCurrentSubPart && batch.length < maxChapters && i + batch.length < chapters.length) {
      const next = chapters[i + batch.length];
      if (next.id.includes('-P')) break;
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
    const id = first.id === last.id ? `V3-${first.id}` : `V3-${first.id}-${last.id}`;

    result.push({
      id,
      index: result.length,
      start: offset,
      end: offset + text.length,
      text,
      chapterCount: batch.length,
    });

    offset += text.length + 2;
    i += batch.length;
  }
  return result;
}

// 3. Process completed segments (0..4)
const completedSegments = job.segments.slice(0, 5);
console.log('Preserving', completedSegments.length, 'completed segments:');
completedSegments.forEach((s) => console.log(`  [${s.index}] ${s.id} (len: ${s.translatedText?.length} chars)`));

// 4. Extract CH5-P2 from segment 5
const seg5 = job.segments[5];
const ch6Idx = seg5.sourceText.indexOf('Chương 6:');
if (ch6Idx === -1) {
  throw new Error('Chương 6: not found in segment 5!');
}
const ch5p2Text = seg5.sourceText.slice(0, ch6Idx).trim();
const ch6Text = seg5.sourceText.slice(ch6Idx).trim();

const lastEnd = completedSegments[completedSegments.length - 1].end;
let currentOffset = lastEnd + 2;

// Standalone Segment 5: V3-CH5-P2
const segment5Clean = {
  id: 'V3-CH5-P2',
  index: 5,
  start: currentOffset,
  end: currentOffset + ch5p2Text.length,
  sourceText: ch5p2Text,
  translatedText: '',
  status: 'queued',
  attempts: 0,
};
currentOffset += ch5p2Text.length + 2;

// 5. Rechunk remaining text from Chapter 6 to Chapter 495
const remainingFrom6 = ch6Text + '\n\n' + job.segments.slice(6).map((s) => s.sourceText).join('\n\n');
const newChunksFrom6 = groupAdaptiveChapterChunks(remainingFrom6, {
  maxBatchChars: 2200,
  maxChapters: 2,
});
console.log('New clean chunks from Chapter 6 onwards:', newChunksFrom6.length);

const newSegmentsFrom6 = newChunksFrom6.map((c, idx) => {
  const segStart = currentOffset;
  const segEnd = currentOffset + c.text.length;
  currentOffset = segEnd + 2;
  return {
    id: c.id,
    index: 6 + idx,
    start: segStart,
    end: segEnd,
    sourceText: c.text,
    translatedText: '',
    status: 'queued',
    attempts: 0,
  };
});

job.segments = [...completedSegments, segment5Clean, ...newSegmentsFrom6];
job.currentSegmentIndex = 5;
job.status = 'paused';
job.error = undefined;
job.conversationInitialized = false;

// Remove any mixed segments check
const mixedCheck = job.segments.filter((s) => s.id.includes('-P') && s.id.match(/-P\d+-CH\d+/));
console.log('Mixed segments remaining in job:', mixedCheck.length);

fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
console.log('Successfully updated job! Total segments:', job.segments.length, 'Next segment to translate: index 5 (V3-CH5-P2)');
