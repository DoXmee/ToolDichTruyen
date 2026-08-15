import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow, Dialog } from 'electron';
import type {
  ChapterExportRecord,
  ChapterExportResult,
  CombinedChapterExportInput,
  CombinedChapterExportResult,
  FinalChapterExportInput,
} from '../shared/types.js';
import {
  chapterContentFingerprint,
  combinedChapterContentFingerprint,
} from '../shared/exportIntegrity.js';

const MAX_CHAPTERS = 10_000;
const MAX_CHAPTER_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_TITLE_LENGTH = 500;
const MAX_CHAPTER_INDEX = 999_999;
const MAX_FILENAME_STEM_LENGTH = 180;

/**
 * This folder name is deliberately fixed instead of being derived from a
 * translated title. It means a resumed job writes to the same safe location
 * and can rely on exclusive publishing for idempotency.
 */
export const ORIGINAL_TRANSLATED_CHAPTERS_DIRECTORY_NAME = 'Chương dịch gốc chưa chia';

export interface ExportChapterFilesRequest {
  directory: string;
  /** Required by the IPC boundary; optional only for direct legacy callers. */
  exportJobId?: string;
  chapters: FinalChapterExportInput[];
}

/** The IPC always supplies the two optional fields below. Keeping the direct
 * service compatible lets old local callers fail safely on content mismatch. */
export interface ExportCombinedChapterFileRequest extends Omit<CombinedChapterExportInput, 'exportJobId' | 'sourceChapterNumbers'> {
  exportJobId?: string;
  sourceChapterNumbers?: number[];
}

function chapterTitleSuffix(title: string, index: number): string {
  const normalized = title.normalize('NFC').trim();
  const escapedIndex = String(index).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const prefix = new RegExp(
    `^Chương[\\t ]+${escapedIndex}(?=$|[\\t :.–—-])`,
    'iu',
  ).exec(normalized);
  if (!prefix) return normalized;

  // Strip only the exact "Chương N" prefix, surrounding spaces and at most
  // one explicit separator. Keeping '-' last in the character class avoids a
  // JavaScript RegExp range such as ".–" accidentally consuming the first
  // Unicode letter of the real title (Sự -> ự, Tú -> ú, Cương -> ương).
  return normalized
    .slice(prefix[0].length)
    .replace(/^[\t ]+/u, '')
    .replace(/^[:.–—-][\t ]*/u, '')
    .trim();
}

function sanitizeFilenamePart(value: string): string {
  return value
    .normalize('NFC')
    .replace(/:/gu, ' - ')
    .replace(/[<>"/\\|?*\u0000-\u001F]/gu, '_')
    .replace(/[\t ]+/gu, ' ')
    .replace(/(?:\s+-\s+){2,}/gu, ' - ')
    .replace(/[. ]+$/gu, '')
    .trim();
}

export function chapterFileName(chapter: Pick<FinalChapterExportInput, 'index' | 'sourceChapterNumber' | 'title'>): string {
  const suffix = sanitizeFilenamePart(chapterTitleSuffix(chapter.title, chapter.index));
  const prefix = `Chương ${chapter.index}`;
  const sourcePrefix = chapter.sourceChapterNumber === undefined ? '' : `c.gốc ${chapter.sourceChapterNumber} - `;
  const fullPrefix = `${sourcePrefix}${prefix}`;
  const availableSuffixLength = Math.max(0, MAX_FILENAME_STEM_LENGTH - fullPrefix.length - 3);
  const truncatedSuffix = suffix.slice(0, availableSuffixLength).replace(/[. ]+$/gu, '');
  return `${fullPrefix}${truncatedSuffix ? ` - ${truncatedSuffix}` : ''}.txt`;
}

export function combinedChapterFileName(startChapter: number, endChapter: number): string {
  return `Tổng hợp từ chương ${startChapter}-${endChapter}.txt`;
}

function chapterDocument(chapter: FinalChapterExportInput): string {
  const suffix = chapterTitleSuffix(chapter.title, chapter.index);
  const heading = `Chương ${chapter.index}${suffix ? `: ${suffix}` : ''}`;
  return `${heading}\r\n\r\n${chapter.content.normalize('NFC')}`;
}

function validateChapter(chapter: FinalChapterExportInput, position: number): void {
  if (!chapter || typeof chapter !== 'object') {
    throw new TypeError(`Chương ${position + 1} không hợp lệ.`);
  }
  if (!Number.isSafeInteger(chapter.index) || chapter.index < 1 || chapter.index > MAX_CHAPTER_INDEX) {
    throw new RangeError(`Số thứ tự chương ${position + 1} không hợp lệ.`);
  }
  if (
    chapter.sourceChapterNumber !== undefined
    && (!Number.isSafeInteger(chapter.sourceChapterNumber)
      || chapter.sourceChapterNumber < 1
      || chapter.sourceChapterNumber > MAX_CHAPTER_INDEX)
  ) {
    throw new RangeError(`Số chương gốc ${position + 1} không hợp lệ.`);
  }
  if (typeof chapter.title !== 'string' || chapter.title.length > MAX_TITLE_LENGTH) {
    throw new TypeError(`Tiêu đề chương ${position + 1} không hợp lệ.`);
  }
  if (typeof chapter.content !== 'string' || !chapter.content.trim()) {
    throw new TypeError(`Nội dung chương ${position + 1} không hợp lệ.`);
  }
  if (Buffer.byteLength(chapter.content, 'utf8') > MAX_CHAPTER_BYTES) {
    throw new RangeError(`Nội dung chương ${position + 1} vượt quá giới hạn.`);
  }
  if (!Number.isSafeInteger(chapter.wordCount) || chapter.wordCount < 0) {
    throw new RangeError(`Số chữ của chương ${position + 1} không hợp lệ.`);
  }
}

function validateChapterList(chapters: FinalChapterExportInput[]): void {
  if (chapters.length < 1 || chapters.length > MAX_CHAPTERS) {
    throw new RangeError(`Danh sách xuất phải có từ 1 đến ${MAX_CHAPTERS} chương.`);
  }

  let totalBytes = 0;
  chapters.forEach((chapter, index) => {
    validateChapter(chapter, index);
    totalBytes += Buffer.byteLength(chapter.content, 'utf8');
    if (totalBytes > MAX_TOTAL_BYTES) throw new RangeError('Tổng nội dung xuất vượt quá 128 MB.');
  });
}

function validateExportJobId(value: unknown): string {
  if (value === undefined) return 'direct-export';
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('\0')) {
    throw new TypeError('Mã checkpoint tác vụ xuất không hợp lệ.');
  }
  return value;
}

function validateCombinedRange(
  startChapter: unknown,
  endChapter: unknown,
): { startChapter: number; endChapter: number } {
  if (
    typeof startChapter !== 'number'
    || !Number.isSafeInteger(startChapter)
    || startChapter < 1
    || startChapter > MAX_CHAPTER_INDEX
  ) {
    throw new RangeError('Chương bắt đầu của file tổng hợp không hợp lệ.');
  }
  if (
    typeof endChapter !== 'number'
    || !Number.isSafeInteger(endChapter)
    || endChapter < startChapter
    || endChapter > MAX_CHAPTER_INDEX
  ) {
    throw new RangeError('Chương kết thúc của file tổng hợp không hợp lệ.');
  }
  return { startChapter, endChapter };
}

function validateContiguousSourceChapters(
  sourceChapterNumbers: unknown,
): number[] {
  if (!Array.isArray(sourceChapterNumbers) || sourceChapterNumbers.length < 1 || sourceChapterNumbers.length > MAX_CHAPTERS) {
    throw new RangeError('Danh sách chương nguồn của file tổng hợp không hợp lệ.');
  }
  const start = sourceChapterNumbers[0];
  if (!Number.isSafeInteger(start) || start < 1 || start > MAX_CHAPTER_INDEX) {
    throw new RangeError('Chỉ có thể tạo file tổng hợp cho dãy chương nguồn liên tục.');
  }
  return sourceChapterNumbers.map((candidate, offset) => {
    const expected = start + offset;
    if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > MAX_CHAPTER_INDEX || candidate !== expected) {
      throw new RangeError('Chỉ có thể tạo file tổng hợp cho dãy chương nguồn liên tục.');
    }
    return candidate;
  });
}

async function validateDirectory(directory: unknown): Promise<string> {
  if (typeof directory !== 'string' || !directory.trim() || directory.includes('\0')) {
    throw new TypeError('Thư mục xuất không hợp lệ.');
  }
  if (!path.isAbsolute(directory)) throw new TypeError('Thư mục xuất phải là đường dẫn tuyệt đối.');

  const resolved = path.resolve(directory);
  const information = await stat(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error('Thư mục xuất không tồn tại.', { cause: error });
    throw error;
  });
  if (!information.isDirectory()) throw new TypeError('Đường dẫn xuất không phải là thư mục.');
  return resolved;
}

async function createOriginalChaptersDirectory(parentDirectory: string): Promise<string> {
  const originalDirectory = path.join(parentDirectory, ORIGINAL_TRANSLATED_CHAPTERS_DIRECTORY_NAME);
  await mkdir(originalDirectory, { recursive: true });
  const information = await stat(originalDirectory);
  if (!information.isDirectory()) {
    throw new TypeError('Thư mục lưu chương dịch gốc không phải là thư mục.');
  }
  return originalDirectory;
}

async function writeAtomicExclusive(
  directory: string,
  fileName: string,
  content: string,
): Promise<'saved' | 'skipped-existing'> {
  const finalPath = path.join(directory, fileName);
  const temporaryPath = path.join(directory, `.${fileName}.${randomUUID()}.tmp`);
  const normalizedContent = content.normalize('NFC');
  const expectedBytes = Buffer.from(normalizedContent, 'utf8');
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(expectedBytes);
    await handle.sync();
    await handle.close();
    handle = undefined;

    try {
      // A hard link publishes a fully-written inode atomically and, unlike
      // rename on Windows, fails instead of replacing an existing destination.
      await link(temporaryPath, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // "Exists" is idempotent only when it is byte-for-byte the exact
        // document this job is trying to publish. A chapter from a different
        // job with the same title must never be silently adopted as ours.
        const existing = await readFile(finalPath).catch((readError: NodeJS.ErrnoException) => {
          throw new Error(
            `Không thể xác minh file ${fileName} đã tồn tại để tiếp tục checkpoint an toàn.`,
            { cause: readError },
          );
        });
        // A regular, different TXT is a conflict and must surface. An
        // unreadable/occupied destination is also an error, never a fake
        // idempotent success.
        if (existing.equals(expectedBytes)) return 'skipped-existing';
        throw new Error(
          `File ${fileName} đã tồn tại nhưng nội dung khác. Không ghi đè; hãy chọn thư mục khác hoặc đổi tên file cũ.`,
        );
      }
      throw error;
    }
    return 'saved';
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function chooseChapterDirectory(
  dialog: Pick<Dialog, 'showOpenDialog'>,
  owner: BrowserWindow | undefined,
): Promise<{ canceled: boolean; directory?: string }> {
  const options = {
    title: 'Chọn thư mục lưu các chương',
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return { canceled: true };
  if (!path.isAbsolute(selected)) throw new TypeError('Thư mục đã chọn không hợp lệ.');
  return { canceled: false, directory: path.resolve(selected) };
}

export async function exportChapterFiles(
  request: ExportChapterFilesRequest,
): Promise<ChapterExportResult> {
  if (!request || typeof request !== 'object' || !Array.isArray(request.chapters)) {
    throw new TypeError('Yêu cầu xuất chương không hợp lệ.');
  }
  validateChapterList(request.chapters);
  const exportJobId = validateExportJobId(request.exportJobId);

  const directory = await validateDirectory(request.directory);
  const records: ChapterExportRecord[] = [];

  for (const chapter of request.chapters) {
    const fileName = chapterFileName(chapter);
    const filePath = path.join(directory, fileName);
    const status = await writeAtomicExclusive(directory, fileName, chapterDocument(chapter));
    records.push({
      exportJobId,
      exportDirectory: directory,
      contentHash: chapterContentFingerprint(chapter),
      index: chapter.index,
      ...(chapter.sourceChapterNumber === undefined ? {} : { sourceChapterNumber: chapter.sourceChapterNumber }),
      title: chapter.title.normalize('NFC'),
      fileName,
      filePath,
      wordCount: chapter.wordCount,
      status,
    });
  }

  return { directory, records };
}

/**
 * Saves the completed translated source chapters before any splitter output is
 * applied. The deterministic child directory keeps the two user-facing forms
 * separate while allowing a resumed job to call this repeatedly safely.
 */
export async function exportOriginalChapterFiles(
  request: ExportChapterFilesRequest,
): Promise<ChapterExportResult> {
  if (!request || typeof request !== 'object' || !Array.isArray(request.chapters)) {
    throw new TypeError('Yêu cầu xuất chương dịch gốc không hợp lệ.');
  }
  validateChapterList(request.chapters);
  const exportJobId = validateExportJobId(request.exportJobId);

  const parentDirectory = await validateDirectory(request.directory);
  const directory = await createOriginalChaptersDirectory(parentDirectory);
  const records: ChapterExportRecord[] = [];

  for (const chapter of request.chapters) {
    const fileName = chapterFileName(chapter);
    const filePath = path.join(directory, fileName);
    const status = await writeAtomicExclusive(directory, fileName, chapterDocument(chapter));
    records.push({
      exportJobId,
      exportDirectory: parentDirectory,
      contentHash: chapterContentFingerprint(chapter),
      index: chapter.index,
      ...(chapter.sourceChapterNumber === undefined ? {} : { sourceChapterNumber: chapter.sourceChapterNumber }),
      title: chapter.title.normalize('NFC'),
      fileName,
      filePath,
      wordCount: chapter.wordCount,
      status,
    });
  }

  return { directory, records };
}

/**
 * Publishes the final, already-split chapter sequence as one TXT. The target
 * filename is fixed by its visible output range, so an interrupted or resumed
 * workflow cannot accidentally create a second aggregate file.
 */
export async function exportCombinedChapterFile(
  request: ExportCombinedChapterFileRequest,
): Promise<CombinedChapterExportResult> {
  if (!request || typeof request !== 'object' || !Array.isArray(request.chapters)) {
    throw new TypeError('Yêu cầu xuất file tổng hợp không hợp lệ.');
  }
  const exportJobId = validateExportJobId(request.exportJobId);
  const { startChapter, endChapter } = validateCombinedRange(request.startChapter, request.endChapter);
  // The filename range is the visible output sequence. It may have more
  // entries than the website source range when one source chapter is split
  // into several TXT files, so validate provenance independently.
  validateContiguousSourceChapters(
    request.sourceChapterNumbers ?? Array.from({ length: endChapter - startChapter + 1 }, (_, index) => startChapter + index),
  );
  validateChapterList(request.chapters);

  const directory = await validateDirectory(request.directory);
  const fileName = combinedChapterFileName(startChapter, endChapter);
  const filePath = path.join(directory, fileName);
  const content = request.chapters.map(chapterDocument).join('\r\n\r\n---\r\n\r\n');
  if (Buffer.byteLength(content, 'utf8') > MAX_TOTAL_BYTES) {
    throw new RangeError('Nội dung file tổng hợp vượt quá 128 MB.');
  }

  const status = await writeAtomicExclusive(directory, fileName, content);
  return {
    directory,
    exportDirectory: directory,
    exportJobId,
    contentHash: combinedChapterContentFingerprint(startChapter, endChapter, request.chapters),
    fileName,
    filePath,
    startChapter,
    endChapter,
    chapterCount: request.chapters.length,
    status,
  };
}
