import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chapterFileName,
  chooseChapterDirectory,
  combinedChapterFileName,
  combinedSourceChapterFileName,
  exportChapterFiles,
  exportCombinedChapterFile,
  exportCombinedSourceChapterFile,
  exportOriginalChapterFiles,
  validateChapterExportDirectory,
  ORIGINAL_TRANSLATED_CHAPTERS_DIRECTORY_NAME,
} from '../../src/main/chapterExport';
import type { FinalChapterExportInput } from '../../src/shared/types';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chapter-export-'));
  temporaryDirectories.push(directory);
  return directory;
}

function chapter(overrides: Partial<FinalChapterExportInput> = {}): FinalChapterExportInput {
  return {
    index: 1,
    title: 'Chương 1: Khởi đầu',
    content: 'Nội dung chương.',
    wordCount: 4,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('chapter TXT export', () => {
  it('rejects a missing export folder before a translation can start', async () => {
    const parent = await temporaryDirectory();
    const missing = path.join(parent, 'đã-xóa');
    await expect(validateChapterExportDirectory(missing)).rejects.toThrow(
      'Không tìm thấy thư mục xuất; không thể bắt đầu dịch.',
    );
  });

  it('chooses a directory with or without an owner and handles cancel', async () => {
    const directory = await temporaryDirectory();
    const showOpenDialog = vi
      .fn()
      .mockResolvedValueOnce({ canceled: false, filePaths: [directory] })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const dialog = { showOpenDialog } as never;

    await expect(chooseChapterDirectory(dialog, undefined)).resolves.toEqual({
      canceled: false,
      directory: path.resolve(directory),
    });
    await expect(chooseChapterDirectory(dialog, {} as never)).resolves.toEqual({ canceled: true });
    expect(showOpenDialog).toHaveBeenCalledTimes(2);
  });

  it('writes NFC UTF-8 files atomically with CRLF heading format', async () => {
    const directory = await temporaryDirectory();
    const result = await exportChapterFiles({
      directory,
      chapters: [chapter({ title: 'Chương 1: Tiêu đe\u0302̀ 🌿', content: 'No\u0323̂i dung 中文.' })],
    });
    const record = result.records[0];

    expect(record).toMatchObject({
      fileName: 'Chương 1 - Tiêu đề 🌿.txt',
      status: 'saved',
    });
    expect(await readFile(record?.filePath ?? '', 'utf8')).toBe(
      'Chương 1: Tiêu đề 🌿\r\n\r\nNội dung 中文.',
    );
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('sanitizes Windows-invalid names and converts colons to spaced dashes', () => {
    expect(chapterFileName(chapter({ title: 'Chương 1: A:B/C*D?E"F<G>H|I.' }))).toBe(
      'Chương 1 - A - B_C_D_E_F_G_H_I.txt',
    );
  });

  it.each([
    ['Chương 20 Sự tỉnh ngộ của Tú Lệ', 'Chương 20 - Sự tỉnh ngộ của Tú Lệ.txt', 'Chương 20: Sự tỉnh ngộ của Tú Lệ'],
    ['Chương 21: Tú Lệ trở lại', 'Chương 21 - Tú Lệ trở lại.txt', 'Chương 21: Tú Lệ trở lại'],
    ['Chương 22 - Cương Tử đến', 'Chương 22 - Cương Tử đến.txt', 'Chương 22: Cương Tử đến'],
    ['Chương 23—Đoàn tụ', 'Chương 23 - Đoàn tụ.txt', 'Chương 23: Đoàn tụ'],
  ])('never consumes the first Unicode title character for %s', async (title, expectedFile, expectedHeading) => {
    const directory = await temporaryDirectory();
    const input = chapter({ index: Number(/\d+/u.exec(title)?.[0]), title });
    const result = await exportChapterFiles({ directory, chapters: [input] });

    expect(result.records[0]?.fileName).toBe(expectedFile);
    expect(await readFile(result.records[0]?.filePath ?? '', 'utf8')).toBe(
      `${expectedHeading}\r\n\r\nNội dung chương.`,
    );
  });

  it('refuses to overwrite a different existing TXT and cleans its atomic temporary file', async () => {
    const directory = await temporaryDirectory();
    const input = chapter();
    const fileName = chapterFileName(input);
    const filePath = path.join(directory, fileName);
    await writeFile(filePath, 'Nội dung người dùng đã có', 'utf8');

    await expect(exportChapterFiles({ directory, chapters: [input] })).rejects.toThrow(/File/u);
    expect(await readFile(filePath, 'utf8')).toBe('Nội dung người dùng đã có');
    expect(await readdir(directory)).toEqual([fileName]);
  });

  it('moves an automatic conflicting checkpoint into one clean recovery folder without overwriting the old TXT', async () => {
    const directory = await temporaryDirectory();
    const input = chapter({ index: 7, sourceChapterNumber: 2, title: 'Chương 7: Bản hoàn chỉnh' });
    const oldPath = path.join(directory, chapterFileName(input));
    await writeFile(oldPath, 'Bản checkpoint cũ khác nội dung', 'utf8');

    const result = await exportChapterFiles({
      directory,
      exportJobId: '12345678-full-job',
      chapters: [input],
      recoveryOnConflict: true,
    });

    expect(result.directory).toBe(path.join(directory, 'Xuất lại hoàn chỉnh 12345678'));
    expect(await readFile(oldPath, 'utf8')).toBe('Bản checkpoint cũ khác nội dung');
    expect(await readFile(result.records[0]?.filePath ?? '', 'utf8')).toContain('Chương 7: Bản hoàn chỉnh');
  });

  it('only treats an existing checkpoint file as idempotent when its bytes match', async () => {
    const directory = await temporaryDirectory();
    const input = chapter({ index: 9, title: 'Chương 9: Trùng tên' });
    const first = await exportChapterFiles({ directory, exportJobId: 'job-one', chapters: [input] });
    const repeated = await exportChapterFiles({ directory, exportJobId: 'job-one', chapters: [input] });
    expect(first.records[0]).toMatchObject({ status: 'saved', exportJobId: 'job-one' });
    expect(repeated.records[0]).toMatchObject({ status: 'skipped-existing', exportJobId: 'job-one' });

    await expect(exportChapterFiles({
      directory,
      exportJobId: 'job-two',
      chapters: [input],
    })).resolves.toMatchObject({ records: [expect.objectContaining({ status: 'skipped-existing', exportJobId: 'job-two' })] });

    await expect(exportChapterFiles({
      directory,
      exportJobId: 'job-two',
      chapters: [chapter({ index: 9, title: 'Chương 9: Trùng tên', content: 'Nội dung đã thay đổi.', wordCount: 4 })],
    })).rejects.toThrow(/File/u);
  });

  it('rejects duplicate destinations with different content in one request without overwriting the first', async () => {
    const directory = await temporaryDirectory();
    await expect(exportChapterFiles({
      directory,
      chapters: [chapter(), chapter({ content: 'Different content.', wordCount: 2 })],
    })).rejects.toThrow(/File/u);

    expect(await readFile(path.join(directory, chapterFileName(chapter())), 'utf8')).toBeTruthy();
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('stores untranslated-by-split translated chapters in a deterministic child folder', async () => {
    const directory = await temporaryDirectory();
    const result = await exportOriginalChapterFiles({
      directory,
      chapters: [chapter({ index: 152, title: 'Chương 152: Bản dịch gốc' })],
    });

    const record = result.records[0];
    expect(result.directory).toBe(path.join(directory, ORIGINAL_TRANSLATED_CHAPTERS_DIRECTORY_NAME));
    expect(record?.filePath).toBe(path.join(result.directory, 'Chương 152 - Bản dịch gốc.txt'));
    expect(await readFile(record?.filePath ?? '', 'utf8')).toBe(
      'Chương 152: Bản dịch gốc\r\n\r\nNội dung chương.',
    );

    const repeated = await exportOriginalChapterFiles({
      directory,
      chapters: [chapter({ index: 152, title: 'Chương 152: Bản dịch gốc' })],
    });
    expect(repeated.records[0]?.status).toBe('skipped-existing');
  });

  it('recovers a conflicting original chapter in the same clean recovery folder', async () => {
    const directory = await temporaryDirectory();
    const input = chapter({ index: 7, sourceChapterNumber: 2, title: 'Chương 7: Bản hoàn chỉnh' });
    const originalDirectory = path.join(directory, ORIGINAL_TRANSLATED_CHAPTERS_DIRECTORY_NAME);
    await mkdir(originalDirectory, { recursive: true });
    await writeFile(path.join(originalDirectory, chapterFileName(input)), 'Bản checkpoint cũ khác nội dung', 'utf8');

    const result = await exportOriginalChapterFiles({
      directory,
      exportJobId: '12345678-full-job',
      chapters: [input],
      recoveryOnConflict: true,
    });

    expect(result.directory).toBe(path.join(directory, 'Xuất lại hoàn chỉnh 12345678', ORIGINAL_TRANSLATED_CHAPTERS_DIRECTORY_NAME));
    expect(await readFile(result.records[0]?.filePath ?? '', 'utf8')).toContain('Chương 7: Bản hoàn chỉnh');
  });

  it('exports a numbered-only chapter without a descriptive filename or heading suffix', async () => {
    const directory = await temporaryDirectory();
    const input = chapter({
      index: 101,
      sourceChapterNumber: 40,
      title: 'Chương 101',
      content: 'Nội dung chỉ đánh số.',
    });
    const result = await exportChapterFiles({ directory, chapters: [input] });

    expect(result.records[0]?.fileName).toBe('c.gốc 40 - Chương 101.txt');
    expect(await readFile(result.records[0]?.filePath ?? '', 'utf8')).toBe(
      'Chương 101\r\n\r\nNội dung chỉ đánh số.',
    );
  });

  it('keeps the original source number in renamed filenames while writing the new display heading', async () => {
    const directory = await temporaryDirectory();
    const input = chapter({
      index: 101,
      sourceChapterNumber: 40,
      title: 'Chương 101: Tên chương',
      content: 'Nội dung chương đã đổi số.',
    });

    const result = await exportChapterFiles({ directory, chapters: [input] });
    expect(result.records[0]).toMatchObject({
      index: 101,
      sourceChapterNumber: 40,
      fileName: 'c.gốc 40 - Chương 101 - Tên chương.txt',
    });
    expect(await readFile(result.records[0]?.filePath ?? '', 'utf8')).toBe(
      'Chương 101: Tên chương\r\n\r\nNội dung chương đã đổi số.',
    );
  });

  it('exports one idempotent aggregate of split chapters with exact separators', async () => {
    const directory = await temporaryDirectory();
    const request = {
      directory,
      startChapter: 152,
      endChapter: 153,
      chapters: [
        chapter({ index: 1, title: 'Chương 1: Hôm nay anh đã về', content: 'Đoạn một.', wordCount: 2 }),
        chapter({ index: 2, title: 'Chương 2: Ngày mai', content: 'Đoạn hai.', wordCount: 2 }),
      ],
    };
    expect(combinedChapterFileName(152, 153)).toBe('Tổng hợp từ chương 152-153.txt');

    const result = await exportCombinedChapterFile(request);
    expect(result).toMatchObject({
      directory,
      fileName: 'Tổng hợp từ chương 152-153.txt',
      startChapter: 152,
      endChapter: 153,
      chapterCount: 2,
      status: 'saved',
    });
    await expect(readFile(result.filePath, 'utf8')).resolves.toBe(
      'Chương 1: Hôm nay anh đã về\r\n\r\nĐoạn một.\r\n\r\n---\r\n\r\nChương 2: Ngày mai\r\n\r\nĐoạn hai.',
    );

    const repeated = await exportCombinedChapterFile(request);
    expect(repeated.status).toBe('skipped-existing');
    await expect(readFile(result.filePath, 'utf8')).resolves.toContain('Đoạn một.');
  });

  it('allows a display-range summary for a shorter contiguous source range after splitting', async () => {
    const directory = await temporaryDirectory();
    const result = await exportCombinedChapterFile({
      directory,
      exportJobId: 'job-renamed-summary',
      startChapter: 101,
      endChapter: 103,
      sourceChapterNumbers: [40, 41],
      chapters: [
        chapter({ index: 101, sourceChapterNumber: 40, title: 'Chương 101: Phần một' }),
        chapter({ index: 102, sourceChapterNumber: 40, title: 'Chương 102: Phần hai' }),
        chapter({ index: 103, sourceChapterNumber: 41, title: 'Chương 103: Chương kế' }),
      ],
    });

    expect(result.fileName).toBe('Tổng hợp từ chương 101-103.txt');
    await expect(readFile(result.filePath, 'utf8')).resolves.toContain('Chương 103: Chương kế');
  });

  it('exports one exact untranslated source aggregate with both original and new ranges', async () => {
    const directory = await temporaryDirectory();
    const request = {
      directory,
      exportJobId: 'job-source-aggregate',
      sourceStartChapter: 40,
      sourceEndChapter: 41,
      outputStartChapter: 101,
      outputEndChapter: 102,
      splitOutputStartChapter: 101,
      splitOutputEndChapter: 103,
      chapters: [
        chapter({ index: 101, sourceChapterNumber: 40, title: 'Chương 101: 原题甲', content: '第一段原文。', wordCount: 1 }),
        chapter({ index: 102, sourceChapterNumber: 41, title: 'Chương 102: 原题乙', content: '第二段原文。', wordCount: 1 }),
      ],
    };
    expect(combinedSourceChapterFileName(40, 41, 101, 102)).toBe(
      'File tổng c.gốc (40-41)_c.mới (101-102).txt',
    );

    const result = await exportCombinedSourceChapterFile(request);
    expect(result).toMatchObject({
      fileName: 'File tổng c.gốc (40-41)_c.mới (101-103).txt',
      startChapter: 101,
      endChapter: 102,
      chapterCount: 2,
      status: 'saved',
    });
    await expect(readFile(result.filePath, 'utf8')).resolves.toBe(
      'Chương 101: 原题甲\r\n\r\n第一段原文。\r\n\r\n---\r\n\r\nChương 102: 原题乙\r\n\r\n第二段原文。',
    );
    await expect(exportCombinedSourceChapterFile(request)).resolves.toMatchObject({
      status: 'skipped-existing',
    });
  });

  it('rejects a source aggregate whose original/new ranges or chapter provenance do not match', async () => {
    const directory = await temporaryDirectory();
    await expect(exportCombinedSourceChapterFile({
      directory,
      sourceStartChapter: 40,
      sourceEndChapter: 41,
      outputStartChapter: 101,
      outputEndChapter: 103,
      chapters: [chapter({ index: 101, sourceChapterNumber: 40 })],
    })).rejects.toThrow(/khớp số lượng/u);
    await expect(exportCombinedSourceChapterFile({
      directory,
      sourceStartChapter: 40,
      sourceEndChapter: 41,
      outputStartChapter: 101,
      outputEndChapter: 102,
      chapters: [
        chapter({ index: 101, sourceChapterNumber: 40 }),
        chapter({ index: 102, sourceChapterNumber: 42 }),
      ],
    })).rejects.toThrow(/chương gốc/u);
    expect(await readdir(directory)).toEqual([]);
  });

  it('recovers a complete aggregate beside recovered split/original outputs without replacing a user file', async () => {
    const directory = await temporaryDirectory();
    const request = {
      directory,
      exportJobId: '12345678-full-job',
      startChapter: 7,
      endChapter: 8,
      sourceChapterNumbers: [2, 3],
      chapters: [
        chapter({ index: 7, sourceChapterNumber: 2, title: 'Chương 7', content: 'Đủ chương bảy.', wordCount: 3 }),
        chapter({ index: 8, sourceChapterNumber: 3, title: 'Chương 8', content: 'Đủ chương tám.', wordCount: 3 }),
      ],
      recoveryOnConflict: true,
    };
    const oldPath = path.join(directory, combinedChapterFileName(7, 8));
    await writeFile(oldPath, 'File tổng hợp checkpoint cũ không đầy đủ.', 'utf8');

    const result = await exportCombinedChapterFile(request);
    expect(result.directory).toBe(path.join(directory, 'Xuất lại hoàn chỉnh 12345678'));
    expect(await readFile(oldPath, 'utf8')).toBe('File tổng hợp checkpoint cũ không đầy đủ.');
    await expect(readFile(result.filePath, 'utf8')).resolves.toBe(
      'Chương 7\r\n\r\nĐủ chương bảy.\r\n\r\n---\r\n\r\nChương 8\r\n\r\nĐủ chương tám.',
    );
  });

  it('validates the absolute folder, directory kind, chapter fields and limits before writing', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'not-a-directory.txt');
    await writeFile(filePath, 'x');

    await expect(exportChapterFiles({ directory: 'relative', chapters: [chapter()] })).rejects.toThrow(
      /tuyệt đối/u,
    );
    await expect(exportChapterFiles({ directory: filePath, chapters: [chapter()] })).rejects.toThrow(
      /không phải là thư mục/u,
    );
    await expect(exportChapterFiles({ directory, chapters: [] })).rejects.toThrow(/từ 1 đến/u);
    await expect(exportChapterFiles({ directory, chapters: [chapter({ content: '   ' })] })).rejects.toThrow(
      /Nội dung/u,
    );
    await expect(exportChapterFiles({ directory, chapters: [chapter({ index: 0 })] })).rejects.toThrow(
      /Số thứ tự/u,
    );
    expect(await readdir(directory)).toEqual(['not-a-directory.txt']);
  });

  it('rejects an invalid aggregate range before creating a file', async () => {
    const directory = await temporaryDirectory();
    await expect(exportCombinedChapterFile({
      directory,
      startChapter: 2,
      endChapter: 1,
      chapters: [chapter()],
    })).rejects.toThrow(/kết thúc/u);
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects a combined TXT whose claimed source range contains a gap', async () => {
    const directory = await temporaryDirectory();
    await expect(exportCombinedChapterFile({
      directory,
      exportJobId: 'job-gap',
      startChapter: 152,
      endChapter: 154,
      sourceChapterNumbers: [152, 154],
      chapters: [chapter()],
    })).rejects.toThrow(/tổng hợp/u);
    expect(await readdir(directory)).toEqual([]);
  });

  it('fails closed when an occupied destination cannot be read as the expected TXT', async () => {
    const directory = await temporaryDirectory();
    const destination = path.join(directory, chapterFileName(chapter()));
    await mkdir(destination);

    await expect(exportChapterFiles({ directory, chapters: [chapter()] })).rejects.toThrow(/xác minh/u);
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});
