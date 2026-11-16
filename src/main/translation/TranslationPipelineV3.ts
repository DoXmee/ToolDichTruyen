/**
 * ============================================================================
 * QUY TẮC KIẾN TRÚC NGHIÊM NGẶT - 3 LUỒNG AI ĐỘC LẬP (STRICT ARCHITECTURE GUARDRAILS)
 * ============================================================================
 * Hệ thống Tool Dịch Truyện vận hành 3 luồng dịch hoàn toàn tách biệt:
 * 1. CHATGPT WEB (Web Browser UI / Playwright CDP):
 *    - Giới hạn DOM tin nhắn: tối đa ~12.500 ký tự (prompt + nguồn).
 *    - Quản lý session, cookies, Cloudflare, luân chuyển chat định kỳ.
 * 2. DEEPSEEK API (Direct HTTP REST API):
 *    - Context lớn, tính phí theo token, giới hạn completion output 4k-8k tokens.
 *    - Tối ưu chi phí: trinh sát chùm lớn (36k ký tự), gom sửa chữ Hán định kỳ (2 lần/bộ).
 * 3. GEMINI API (Direct HTTP REST API):
 *    - Context siêu lớn 1M tokens, giới hạn output 8k tokens.
 *    - Trinh sát chùm tới 50k ký tự.
 * 
 * NGUYÊN TẮC BẮT BUỘC KHI PHÁT TRIỂN / SỬA LỖI:
 * - 3 luồng độc lập về cấu hình, phân mẻ, prompt và xử lý lỗi.
 * - Khi chỉnh sửa bất kỳ luồng nào, Developer/Agent BẮT BUỘC phải khảo sát kỹ,
 *   hỏi rõ người dùng và CHỈ ĐƯỢC PHÉP sửa đúng phạm vi luồng đó.
 * - TUYỆT ĐỐI CẤM can thiệp hoặc sửa đổi logic chung gây ảnh hưởng chéo sang các luồng khác!
 * ============================================================================
 */

import {
  emptyRegistry,
  groupChapterChunks,
  groupAdaptiveChapterChunks,
  parseProtocolJson,
  splitChapters,
  isGenericNameForm,
  type ChapterInput,
  type Registry,
} from '../../core/translationPipelineV3.js';
import {
  compileChapterScoutPrompt,
  compileClusterScoutPrompt,
  compileStoryBiblePrompt,
} from '../../core/promptCompilerV2.js';
import { getProviderLimits } from '../../core/aiProviderLimits.js';
import { removeGarbageSnippets, type GarbageSnippet } from '../../core/crawlerSanitizer.js';
import { unlockNamesInTranslation, enforceLockedEntities } from '../../core/nameLocker.js';
import { sanitizeTranslationResponse } from '../../core/assistantResponse.js';
import { getGenreProfile } from '../../core/genreProfile.js';
import { isNonEntityOrCommonWord, scanBookForEntities } from '../../core/storyDigestScanner.js';
import { transcribeHanViet } from '../../core/storyMemoryExtractor.js';
import { tify } from 'chinese-conv';
import { validateTranslation } from '../../core/translationValidator.js';
import { normalizeVietnamesePunctuation } from '../../shared/exportIntegrity.js';
import { parseStoryUrl } from '../storySources/urlRules.js';
import type { StoryBible } from '../../core/storyBible.js';
import {
  isLocalizedHanOnly,
  localizedHanTargets,
  localizedRepairBatchResponseError,
  replaceLocalizedTargets,
  type LocalizedHanTarget,
} from '../../core/localizedHanRepair.js';
import { buildLocalizedHanRepairPrompt } from '../../core/promptBuilder.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sourceHash = (text: string) => createHash('sha256').update(text).digest('hex');

type Host = Record<string, any>;
interface State {
  version: 3;
  batchChapters: number;
  registry: Registry;
  bootstrapDone: boolean;
  bootstrapCursor: number;
  stage: string;
  sourceChapters: ChapterInput[];
  pendingHanRepairs?: Array<{
    segmentIndex: number;
    segmentId: string;
    targets: LocalizedHanTarget[];
    cleanSource: string;
  }>;
}

export { DeepSeekApiAdapter } from '../deepseek/DeepSeekApiAdapter.js';

export interface PipelineServices {
  refetchRaw?: (chapter: ChapterInput, signal: AbortSignal) => Promise<string>;
}

export function pipelineRestartOptions(job: Host): {
  batchChaptersCount?: number;
  sourceChapters?: ChapterInput[];
  executionMode?: 'web' | 'api';
} {
  const state = job.pipelineV3 as State | undefined;
  return state
    ? {
        batchChaptersCount: state.batchChapters,
        sourceChapters: state.sourceChapters,
        executionMode: job.executionMode,
      }
    : {};
}

export function readPipelineOptions(payload: Record<string, unknown>): {
  batchChaptersCount: number;
  sourceChapters: ChapterInput[];
} {
  const rawCount = payload.batchChaptersCount;
  const count = typeof rawCount === 'number' ? rawCount : 2;
  if (count !== 0 && (count < 1 || count > 3)) throw Error('Số chương mỗi mẻ phải từ 1 đến 3 (hoặc 0 để tự động thích ứng).');
  const refs = payload.sourceChapters ?? [];
  if (!Array.isArray(refs) || refs.length > 10000) throw Error('Danh sách nguồn chương không hợp lệ.');
  const chapters = refs.map((value: unknown) => {
    const v = value as Record<string, unknown>;
    if (
      !v ||
      !Number.isSafeInteger(v.number) ||
      Number(v.number) < 1 ||
      v.id !== 'CH' + v.number ||
      !Array.isArray(v.urls) ||
      v.urls.length > 50
    )
      throw Error('Tham chiếu chương không hợp lệ.');
    const urls = v.urls.map((u: unknown) => {
      if (typeof u !== 'string') throw Error('URL nguồn không hợp lệ.');
      parseStoryUrl(u);
      return u;
    });
    const parsed = urls.map((u) => parseStoryUrl(u));
    if (parsed.some((p) => p.site !== parsed[0]?.site || p.bookId !== parsed[0]?.bookId))
      throw Error('Các trang nguồn thuộc nhiều truyện.');
    return { id: String(v.id), number: Number(v.number), title: String(v.title || ''), text: '', urls };
  });
  if (new Set(chapters.map((c) => c.id)).size !== chapters.length) throw Error('Trùng chương nguồn.');
  return { batchChaptersCount: count, sourceChapters: chapters };
}

function memoryProjection(job: Host): void {
  const state = job.pipelineV3 as State;
  job.memory ??= { version: 1, entities: [], relations: [], updatedAt: new Date().toISOString() };
  job.memory.entities = [
    ...(job.memory.entities || []).filter((e: Host) => e.category !== 'character'),
    ...state.registry.characters.map((c) => {
      const previous = (job.memory.entities || []).find((e: Host) => e.id === c.id || e.chinese === c.source) || {};
      return {
        ...previous,
        id: c.id,
        category: 'character',
        chinese: c.source,
        vietnamese: c.vi,
        gender: c.gender,
        role: c.role,
        aliases: c.forms.filter((f) => f.source !== c.source).map((f) => f.source),
        nameForms: c.forms,
        identityKind: c.kind,
        status: previous.status === 'locked' ? 'locked' : 'verified',
      };
    }),
  ];
  const label = (id: string) => state.registry.characters.find((c) => c.id === id)?.vi ?? id;
  job.memory.relations = state.registry.relations.map((r, i) => ({
    id: 'V3R' + i,
    sourceCharacter: `${label(r.fromId)} (${r.fromId})`,
    targetCharacter: `${label(r.toId)} (${r.toId})`,
    v3FromId: r.fromId,
    v3ToId: r.toId,
    relationType: r.fact,
    pronounSample: 'Tham khảo theo cảnh',
    samples: r.samples.map(
      (s) => `${label(s.speakerId)} (${s.speakerId})→${label(s.listenerId)} (${s.listenerId}): ${s.self}–${s.call} (${s.scene})`,
    ),
    evidence: r.evidence,
    v3Samples: r.samples,
  }));
  job.memory.updatedAt = new Date().toISOString();
  job.memory.identitySchemaVersion = 3;
}

const CORE_DEFAULT_LOCATIONS: Array<{ source: string; vi: string; type?: string }> = [
  { source: '京都', vi: 'Kinh Đô', type: 'city' },
  { source: '蘭城', vi: 'Lan Thành', type: 'city' },
  { source: '兰城', vi: 'Lan Thành', type: 'city' },
  { source: '深市', vi: 'Thâm Quyến', type: 'city' },
  { source: '深圳', vi: 'Thâm Quyến', type: 'city' },
  { source: '滬市', vi: 'Thượng Hải', type: 'city' },
  { source: '上海', vi: 'Thượng Hải', type: 'city' },
  { source: '羊城', vi: 'Quảng Châu', type: 'city' },
  { source: '廣州', vi: 'Quảng Châu', type: 'city' },
  { source: '广州', vi: 'Quảng Châu', type: 'city' },
  { source: '港城', vi: 'Hồng Kông', type: 'city' },
  { source: '香港', vi: 'Hồng Kông', type: 'city' },
];

function seedRegistry(memory: Host | undefined): Registry {
  const r = emptyRegistry();
  r.locations = [];

  // Seed standard key locations to prevent cross-language drift (e.g. Kyoto, Lan Châu)
  for (const def of CORE_DEFAULT_LOCATIONS) {
    r.locations.push({
      id: `L${String(r.locations.length + 1).padStart(5, '0')}`,
      source: def.source,
      vi: def.vi,
      type: def.type,
    });
  }

  // Also import any location entities previously saved in memory
  for (const e of memory?.entities || []) {
    if (e.category === 'location' && e.chinese && e.vietnamese) {
      if (!r.locations.some((l) => l.source === e.chinese)) {
        r.locations.push({
          id: e.id || `L${String(r.locations.length + 1).padStart(5, '0')}`,
          source: e.chinese,
          vi: e.vietnamese,
          type: e.role || 'location',
        });
      }
    }
  }

  let serial = Math.max(
    0,
    ...(memory?.entities || []).map((e: Host) => (/^C\d+$/u.test(e.id) ? Number(e.id.slice(1)) : 0)),
  );
  for (const e of memory?.entities || []) {
    if (e.category !== 'character' || !e.chinese || !e.vietnamese) continue;
    if (isNonEntityOrCommonWord(e.chinese, e.vietnamese, e.role, e.notes)) continue;
    if (/[\u4e00-\u9fa5]/u.test(e.vietnamese)) continue;
    const id = /^C\d+$/u.test(e.id) ? e.id : 'C' + String(++serial).padStart(5, '0');
    if (r.characters.some((c) => c.id === id || c.source === e.chinese)) continue;
    const forms =
      memory?.identitySchemaVersion === 3 && Array.isArray(e.nameForms)
        ? structuredClone(e.nameForms)
        : [{ id: 'F01', source: e.chinese, vi: e.vietnamese, kind: 'name' }];
    const canonical = forms.find((f: Host) => f.id === 'F01');
    if (canonical) {
      canonical.source = e.chinese;
      canonical.vi = e.vietnamese;
    }
    r.characters.push({
      id,
      source: e.chinese,
      vi: e.vietnamese,
      kind: e.identityKind === 'animal' ? 'animal' : 'person',
      gender: e.gender || 'unknown',
      role: e.role || '',
      forms,
    });
  }
  return r;
}

async function send(
  host: Host,
  job: Host,
  prompt: string,
  signal: AbortSignal,
  analysis: boolean,
): Promise<string> {
  if (signal.aborted) throw signal.reason;
  const adapter = host.getAiAdapter ? host.getAiAdapter(job) : host.dependencies.chatGpt;
  await adapter.ensureReady();
  if (job.executionMode !== 'api') {
    await adapter.startNewConversation();
  }
  const audit = (job.pipelineV3.audit ??= []);
  const row: Host = {
    stage: job.pipelineV3.stage,
    startedAt: new Date().toISOString(),
    promptHash: sourceHash(prompt),
    promptCharacters: prompt.length,
  };
  audit.push(row);
  const directory = process.env.TDT_V3_AUDIT_DIR
    ? path.join(path.resolve(process.env.TDT_V3_AUDIT_DIR), job.id)
    : undefined;
  const prefix = String(audit.length).padStart(3, '0');
  if (directory) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, prefix + '-prompt.txt'), prompt);
  }
  try {
    const result = await adapter.sendAndWait(prompt, {
      signal,
      timeoutMs: analysis ? 600000 : 900000,
      reasoning: false,
    });
    row.responseCharacters = result.length;
    row.status = 'received';
    if (directory) await fs.writeFile(path.join(directory, prefix + '-response.txt'), result);
    return result;
  } catch (e) {
    row.status = 'error';
    row.error = String(e);
    throw e;
  } finally {
    row.finishedAt = new Date().toISOString();
    if (directory) await fs.writeFile(path.join(directory, 'requests.json'), JSON.stringify(audit, null, 2));
  }
}

/**
 * Bước 1 (Khởi tạo): Khôi phục cơ chế trinh sát AI chuẩn ban đầu của Tool.
 * Quét ngữ cảnh xuất hiện, gửi AI thẩm định và lọc qua isNonEntityOrCommonWord để lấy 100% nhân vật chuẩn.
 */
async function bootstrap(host: Host, job: Host, signal: AbortSignal): Promise<void> {
  const state = job.pipelineV3 as State;
  if (state.bootstrapDone) return;
  const chapters = splitChapters(job.sourceText);
  host.logActivity(
    job,
    `V3 · Bước 1: Khởi tạo bộ nhớ nhân vật toàn bộ ${chapters.length} chương theo cơ chế trinh sát AI chuẩn...`,
    'info',
  );

  // Nạp từ job.memory sạch vào registry (tự động lọc sạch 100% qua isNonEntityOrCommonWord)
  state.registry = seedRegistry(job.memory);

  // Fallback an toàn nếu chưa có nhân vật nào trong memory (chỉ lấy tên chắc chắn, lọc triệt để qua isNonEntityOrCommonWord)
  if (state.registry.characters.length === 0) {
    const minOccur = chapters.length >= 20 ? 5 : 3;
    const candidates = scanBookForEntities(
      chapters.map((c, index) => ({ index, sourceText: c.text })),
      { minOccurrences: minOccur, maxCandidates: 60 },
    );
    for (const c of candidates) {
      if (chapters.length >= 2 && c.chapterIndices && c.chapterIndices.length < 2) continue;
      if (isGenericNameForm(c.chinese)) continue;
      const reading = transcribeHanViet(c.chinese) || transcribeHanViet(tify(c.chinese));
      if (!reading) continue;
      if (isNonEntityOrCommonWord(c.chinese, reading)) continue;
      const existing = state.registry.characters.find((x) => x.source === c.chinese);
      if (!existing) {
        const id = 'C' + String(state.registry.characters.length + 1).padStart(5, '0');
        state.registry.characters.push({
          id,
          source: c.chinese,
          vi: reading,
          kind: 'person',
          gender: 'unknown',
          role: '',
          forms: [{ id: 'F01', source: c.chinese, vi: reading, kind: 'name', evidence: [] }],
        });
      }
    }
  }

  state.bootstrapDone = true;
  state.stage = 'ready';
  memoryProjection(job);
  await host.saveJobMemory(job);
  await host.checkpoint(job);
  host.logActivity(
    job,
    `V3 · Đã tạo bộ nhớ ban đầu chuẩn xác với ${state.registry.characters.length} nhân vật (đã lọc sạch 100% từ rác). Sẵn sàng dịch từng chương.`,
    'info',
  );
}

async function executeClusterScout(
  host: Host,
  job: Host,
  startIndex: number,
  signal: AbortSignal,
  services: PipelineServices,
): Promise<void> {
  const state = job.pipelineV3 as State;
  const segmentsToScout: Host[] = [];
  let totalChars = 0;
  const mode = job.executionMode || 'web';
  const provider = job.aiProvider || job.provider || 'chatgpt';
  
  // Nguồn giới hạn chuẩn duy nhất từ aiProviderLimits:
  // - Gemini API: 50.000 ký tự (context 1M token)
  // - DeepSeek API: 36.000 ký tự (context 64k-128k token)
  // - Web AI (ChatGPT Web): 4.000 ký tự (đảm bảo prompt nhẹ, không quá tải browser)
  const limits = getProviderLimits(provider, mode);
  const maxClusterChars = limits.maxClusterScoutChars;
  const maxSegmentsInCluster = Infinity;

  for (let idx = startIndex; idx < job.segments.length; idx++) {
    const s = job.segments[idx];
    if (s.status === 'completed' || s.preparedV3?.scoutDone) continue;
    if (segmentsToScout.length > 0 && totalChars + s.sourceText.length > maxClusterChars) {
      break;
    }
    segmentsToScout.push(s);
    totalChars += s.sourceText.length;
    if (segmentsToScout.length >= maxSegmentsInCluster) {
      break;
    }
  }

  if (segmentsToScout.length === 0) return;

  state.stage = 'analysis';
  const startNum = segmentsToScout[0]!.index + 1;
  const endNum = segmentsToScout[segmentsToScout.length - 1]!.index + 1;
  host.logActivity(
    job,
    `V3 · Trinh sát chùm (${segmentsToScout.length} chương: đoạn ${startNum} đến ${endNum}, ~${totalChars} chữ): Khóa tên riêng, địa danh và lọc rác toàn cụm...`,
    'info',
    job.segments[startIndex],
  );
  await host.checkpoint(job);

  const knownEntities = state.registry.characters.map((c) => ({
    chinese: c.source,
    vietnamese: c.vi,
  }));
  const knownLocations = (state.registry.locations || []).map((l) => ({
    chinese: l.source,
    vietnamese: l.vi,
  }));

  const segmentInputs = segmentsToScout.map((s) => ({
    segmentId: s.id,
    sourceText: s.sourceText,
    chapterNumber: s.index + 1,
  }));

  const scoutPrompt = compileClusterScoutPrompt({
    segments: segmentInputs,
    knownEntities,
    knownLocations,
  });

  let scoutData: Record<string, unknown> | null = null;
  let scoutAttempts = 0;
  const maxScoutAttempts = 2;

  while (scoutAttempts < maxScoutAttempts) {
    scoutAttempts++;
    try {
      const currentPrompt = scoutAttempts > 1
        ? `${scoutPrompt}\n\nLƯU Ý BẮT BUỘC: Lần trước định dạng trả lời không phải JSON. BẮT BUỘC chỉ trả về duy nhất 1 khối JSON chuẩn, tuyệt đối không dịch văn bản hay thêm bất kỳ lời dẫn nào!`
        : scoutPrompt;
      const scoutResponse = await send(host, job, currentPrompt, signal, true);
      scoutData = parseProtocolJson(scoutResponse);
      break;
    } catch (scoutErr) {
      if (signal.aborted) throw signal.reason;
      host.logActivity(
        job,
        `V3 · Trinh sát chùm chưa nhận được JSON hợp lệ (thử lần ${scoutAttempts}/${maxScoutAttempts}): ${String(scoutErr)}`,
        'warning',
        job.segments[startIndex],
      );
      if (scoutAttempts < maxScoutAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // NGUYÊN TẮC BẢO TOÀN TÍNH TOÀN VẸN:
  // Nếu AI trả về lỗi sau số lần thử, TUYỆT ĐỐI KHÔNG giả định integrity = "ok" và KHÔNG đánh dấu scoutDone.
  // Thay vào đó, để từng phân đoạn tự động fallback sang Lượt 1 trinh sát riêng lẻ để đảm bảo an toàn tuyệt đối!
  if (!scoutData) {
    host.logActivity(
      job,
      `V3 · Trinh sát chùm không nhận được JSON sau ${maxScoutAttempts} lần thử. Giữ nguyên trạng thái để từng phân đoạn tự trinh sát độc lập ở Lượt 1.`,
      'warning',
      job.segments[startIndex],
    );
    return;
  }

  // 1. Ánh xạ kết quả integrity và garbage riêng biệt theo từng segmentId
  const rawSegments = Array.isArray(scoutData.segments) ? (scoutData.segments as any[]) : [];
  const segResultMap = new Map<string, any>();
  for (const segRes of rawSegments) {
    if (segRes && typeof segRes === 'object') {
      if (segRes.segmentId) {
        const idStr = String(segRes.segmentId).trim();
        segResultMap.set(idStr, segRes);
        // Hỗ trợ cả key bỏ tiền tố 'V3-'
        if (idStr.startsWith('V3-')) {
          segResultMap.set(idStr.slice(3), segRes);
        }
      }
    }
  }

  const globalIntegrity = (scoutData.integrity || {}) as { status?: string; reason?: string };
  const globalGarbage = (Array.isArray(scoutData.garbage) ? scoutData.garbage : []) as GarbageSnippet[];

  let successfulScoutCount = 0;
  let totalGarbageChars = 0;

  for (const s of segmentsToScout) {
    const segRes = segResultMap.get(s.id)
      || segResultMap.get(s.id.replace(/^V3-/u, ''))
      || (segmentsToScout.length === 1 && (scoutData.integrity || Array.isArray(scoutData.garbage)) ? scoutData : null);

    if (!segRes) {
      host.logActivity(
        job,
        `V3 · Trinh sát chùm: AI không trả dữ liệu cho phân đoạn ${s.id}. Chuyển sang trinh sát riêng ở Lượt 1.`,
        'warning',
        s,
      );
      s.preparedV3 = { cleanSource: s.sourceText, scoutDone: false };
      continue;
    }

    const integrity = (segRes.integrity || globalIntegrity) as { status?: string; reason?: string };
    let integrityStatus = (integrity.status || 'uncertain').toLowerCase().trim();

    // Phân đoạn con (-P1, -P2, ...) của một chương dài đương nhiên kết thúc giữa chừng, không coi là truncated/uncertain
    const isSubPart = s.id.includes('-P');
    if (isSubPart && (integrityStatus === 'truncated' || integrityStatus === 'uncertain')) {
      integrityStatus = 'ok';
    }

    // Nếu phát hiện chương bị cụt (truncated), lẫn truyện/quảng cáo (corrupted) hoặc chưa rõ (uncertain):
    // TUYỆT ĐỐI KHÔNG đánh dấu scoutDone = true!
    if (['truncated', 'corrupted', 'refetch', 'uncertain'].includes(integrityStatus)) {
      host.logActivity(
        job,
        `V3 · Trinh sát chùm phát hiện phân đoạn ${s.id} không nguyên vẹn (${integrityStatus}): ${integrity.reason || 'cần kiểm tra lại'}. Tạm dừng phân đoạn này để xử lý riêng ở Lượt 1.`,
        'warning',
        s,
      );
      s.preparedV3 = {
        cleanSource: s.sourceText,
        scoutDone: false,
      };
      continue;
    }

    // Phân đoạn hoàn chỉnh (status === "ok"): lọc rác cục bộ của đúng phân đoạn đó
    const segGarbage = (Array.isArray(segRes.garbage) ? segRes.garbage : globalGarbage) as GarbageSnippet[];
    let cleanSource = s.sourceText;
    if (segGarbage.length > 0) {
      const beforeLen = cleanSource.length;
      cleanSource = removeGarbageSnippets(cleanSource, segGarbage);
      totalGarbageChars += (beforeLen - cleanSource.length);
    }

    s.preparedV3 = {
      cleanSource,
      scoutDone: true,
    };
    s.sourceText = cleanSource;
    successfulScoutCount++;
  }

  // 2. Thu hoạch nhân vật mới toàn chùm
  const newCharacters = Array.isArray(scoutData.newCharacters) ? scoutData.newCharacters : [];
  // Gom cả nhân vật khai báo bên trong từng segment nếu có
  for (const segRes of rawSegments) {
    if (Array.isArray(segRes.newCharacters)) {
      newCharacters.push(...segRes.newCharacters);
    }
  }

  let newCharCount = 0;
  for (const c of newCharacters as Array<{ source?: string; vi?: string; gender?: string; role?: string }>) {
    if (!c.source || !c.vi || isGenericNameForm(c.source)) continue;
    if (isNonEntityOrCommonWord(c.source, c.vi, c.role)) continue;
    if (/[\u4e00-\u9fa5]/u.test(c.vi)) continue;
    const exists = state.registry.characters.find((x) => x.source === c.source);
    if (!exists) {
      const id = 'C' + String(state.registry.characters.length + 1).padStart(5, '0');
      state.registry.characters.push({
        id,
        source: c.source,
        vi: c.vi,
        kind: c.gender === 'animal' ? 'animal' : 'person',
        gender: (c.gender as 'male' | 'female' | 'unknown') || 'unknown',
        role: c.role || '',
        forms: [{ id: 'F01', source: c.source, vi: c.vi, kind: 'name', evidence: [] }],
      });
      newCharCount++;
    }
  }

  // 3. Thu hoạch địa danh mới toàn chùm
  const newLocations = Array.isArray(scoutData.locations) ? scoutData.locations : [];
  for (const segRes of rawSegments) {
    if (Array.isArray(segRes.locations)) {
      newLocations.push(...segRes.locations);
    }
  }

  let newLocCount = 0;
  if (!state.registry.locations) state.registry.locations = [];
  for (const loc of newLocations as Array<{ source?: string; vi?: string; type?: string }>) {
    if (!loc.source || !loc.vi) continue;
    if (/[\u4e00-\u9fa5]/u.test(loc.vi)) continue;
    const s = loc.source.trim();
    const v = loc.vi.trim();
    if (s.length <= 1) continue;
    const exists = state.registry.locations.find((x) => x.source === s);
    if (!exists) {
      const id = 'L' + String(state.registry.locations.length + 1).padStart(5, '0');
      state.registry.locations.push({
        id,
        source: s,
        vi: v,
        type: loc.type || 'location',
      });
      newLocCount++;
    }
  }

  // 4. Thu hoạch quan hệ mới toàn chùm
  const relations = Array.isArray(scoutData.relations) ? scoutData.relations : [];
  for (const segRes of rawSegments) {
    if (Array.isArray(segRes.relations)) {
      relations.push(...segRes.relations);
    }
  }

  for (const r of relations as Array<{ charA?: string; charB?: string; relation?: string; suggestion?: string }>) {
    if (!r.charA || !r.charB) continue;
    const from = state.registry.characters.find((c) => c.source === r.charA || c.vi === r.charA);
    const to = state.registry.characters.find((c) => c.source === r.charB || c.vi === r.charB);
    if (from && to && from.id !== to.id) {
      const existingRel = state.registry.relations.find((x) => x.fromId === from.id && x.toId === to.id);
      if (!existingRel) {
        state.registry.relations.push({
          fromId: from.id,
          toId: to.id,
          fact: r.relation || '',
          evidence: [],
          samples: r.suggestion
            ? [{ speakerId: from.id, listenerId: to.id, self: '', call: '', scene: r.suggestion }]
            : [],
        });
      }
    }
  }

  host.logActivity(
    job,
    `V3 · Đã trinh sát xong chùm ${segmentsToScout.length} chương (${successfulScoutCount}/${segmentsToScout.length} đạt chuẩn toàn vẹn): Thêm ${newCharCount} nhân vật, ${newLocCount} địa danh, lọc sạch ${totalGarbageChars} ký tự rác.`,
    'info',
    job.segments[startIndex],
  );

  memoryProjection(job);
  await host.saveJobMemory(job);
  await host.checkpoint(job);
}

async function flushPendingHanRepairs(
  host: Host,
  job: Host,
  signal: AbortSignal,
  checkpointName: string,
): Promise<void> {
  const state = job.pipelineV3 as State;
  const queue = state.pendingHanRepairs;
  if (!queue || queue.length === 0) return;

  const allTargets: Array<{ targetId: string; sentence: string; segmentIndex: number; origTarget: LocalizedHanTarget }> = [];
  for (const item of queue) {
    for (const t of item.targets) {
      allTargets.push({
        targetId: t.targetId,
        sentence: t.text,
        segmentIndex: item.segmentIndex,
        origTarget: t,
      });
    }
  }

  if (allTargets.length === 0) {
    state.pendingHanRepairs = [];
    return;
  }

  host.logActivity(
    job,
    `V3 · Tiến hành đợt sửa lỗi chữ Hán ${checkpointName}: Gửi 1 mẻ duy nhất sửa toàn bộ ${allTargets.length} câu tích lũy...`,
    'info',
  );

  const repairPrompt = buildLocalizedHanRepairPrompt({
    basePrompt: `[TDT_V3_TRANSLATION]\n${job.customPrompt || job.resolvedPrompt}`,
    targets: allTargets.map((t) => ({ targetId: t.targetId, sentence: t.sentence })),
    attempt: 1,
    hanSample: '',
    includeBasePrompt: true,
  });

  try {
    const repairResponse = await send(host, job, repairPrompt, signal, false);
    const parsed = localizedRepairBatchResponseError(repairResponse, allTargets.map((t) => ({ targetId: t.targetId, text: t.sentence, start: 0, end: 0 })));
    const successfullyRepairedIds = new Set<string>();

    if (!parsed.error && parsed.replacements && parsed.replacements.size > 0) {
      for (const item of queue) {
        const seg = job.segments[item.segmentIndex];
        if (seg && seg.translatedText) {
          const segReplacements = new Map<string, string>();
          for (const t of item.targets) {
            const rep = parsed.replacements.get(t.targetId);
            if (rep) {
              segReplacements.set(t.targetId, rep);
            }
          }
          if (segReplacements.size > 0) {
            const updated = replaceLocalizedTargets(seg.translatedText, item.targets, segReplacements);
            seg.translatedText = updated;
            for (const [targetId] of segReplacements) {
              successfullyRepairedIds.add(targetId);
            }
          }
        }
      }
    }

    // NGUYÊN TẮC BẢO TOÀN HÀNG ĐỢI SỬA CHỮ HÁN:
    // Tuyệt đối không xóa toàn bộ queue nếu có câu chưa sửa xong.
    // Chỉ loại bỏ các câu đã sửa thành công; giữ lại các câu còn thiếu/lỗi để đợt sau tiếp tục sửa.
    const remainingQueue: typeof state.pendingHanRepairs = [];
    for (const item of queue) {
      const remainingTargets = item.targets.filter((t) => !successfullyRepairedIds.has(t.targetId));
      if (remainingTargets.length > 0) {
        remainingQueue.push({
          ...item,
          targets: remainingTargets,
        });
      }
    }
    state.pendingHanRepairs = remainingQueue;

    host.logActivity(
      job,
      `V3 · Đã sửa sạch ${successfullyRepairedIds.size}/${allTargets.length} câu sót chữ Hán trong đợt ${checkpointName}${remainingQueue.length > 0 ? ` (còn lại ${allTargets.length - successfullyRepairedIds.size} câu giữ trong hàng đợi)` : ''}!`,
      'info',
    );
    await host.checkpoint(job);
  } catch (err) {
    // Nếu API lỗi/timeout, giữ nguyên 100% hàng đợi pendingHanRepairs và lưu checkpoint an toàn
    host.logActivity(
      job,
      `V3 · Đợt sửa chữ Hán ${checkpointName} chưa hoàn tất do lỗi mạng/API (${String(err)}). Bảo lưu toàn bộ hàng đợi để thử lại trong đợt tiếp theo.`,
      'warning',
    );
    await host.checkpoint(job);
  }
}

/**
 * Bước 2: Dịch mỗi phân đoạn/chương qua 2 lượt tuần tự:
 * - Lượt 1: Trinh sát tính toàn vẹn (đứt câu/mất trang), AI chỉ ra vị trí rác để Tool tự cắt, cập nhật nhân vật/xưng hô mới.
 * - Lượt 2: Dịch thuần Việt với Khung khóa tên tiếng Việt ⟦...⟧, xưng hô gợi ý linh hoạt, KHÔNG bắt AI trả về thẻ THUC_THE_MOI.
 */
async function processBatch(
  host: Host,
  job: Host,
  segment: Host,
  signal: AbortSignal,
  services: PipelineServices,
): Promise<boolean> {
  const state = job.pipelineV3 as State;
  try {
    if (signal.aborted) return false;
    let prepared = segment.preparedV3 as { cleanSource: string; scoutDone?: boolean } | undefined;
    if (prepared?.cleanSource && segment.sourceText && prepared.cleanSource !== segment.sourceText) {
      prepared.cleanSource = segment.sourceText;
    }
    const isDeepSeekApi = job.executionMode === 'api' && (job.aiProvider === 'deepseek' || job.provider === 'deepseek');

    // === LƯỢT 1: TRINH SÁT, KIỂM TRA ĐỨT TRANG & ĐỊNH VỊ RÁC ===
    if (!prepared?.scoutDone) {
      await executeClusterScout(host, job, segment.index, signal, services);
      prepared = segment.preparedV3 as { cleanSource: string; scoutDone?: boolean } | undefined;
    }

    if (!prepared?.scoutDone) {
      // Phân giải danh sách chương từ segment.id và state.sourceChapters;
      // tuyệt đối không gọi splitChapters trên segment.sourceText vì segment có thể là sub-part (-P)
      const chapterRangeMatch = segment.id.match(/^V3-CH(\d+)(?:-P\d+)?(?:-CH(\d+)(?:-P\d+)?)?$/u);
      let chapterIds: string[] = [];
      if (chapterRangeMatch) {
        const startNum = Number(chapterRangeMatch[1]);
        const endNum = chapterRangeMatch[2] ? Number(chapterRangeMatch[2]) : startNum;
        for (let n = Math.min(startNum, endNum); n <= Math.max(startNum, endNum); n++) {
          chapterIds.push(`CH${n}`);
        }
      } else {
        const matches = [...segment.id.matchAll(/CH(\d+)/gu)];
        chapterIds = matches.length > 0 ? [...new Set(matches.map((m) => `CH${m[1]}`))] : ['CH1'];
      }

      const chapters = chapterIds.map((cid) => {
        const num = Number(cid.replace(/^CH/u, '')) || 1;
        const found = state.sourceChapters.find((s) => s.id === cid);
        return {
          id: cid,
          number: num,
          title: found?.title || `Chương ${num}`,
          text: segment.sourceText,
          urls: found?.urls,
        };
      });
      let refetches = 0;

      for (;;) {
        state.stage = 'analysis';
        segment.status = 'sending';
        host.logActivity(
          job,
          `V3 · Lượt 1/2: Trinh sát nguồn ${chapters.map((c) => c.number).join(', ')}; kiểm tra rác, đứt trang, nhân vật và xưng hô.`,
          'info',
          segment,
        );
        await host.checkpoint(job);

        const knownEntities = state.registry.characters.map((c) => ({
          chinese: c.source,
          vietnamese: c.vi,
        }));
        const knownLocations = (state.registry.locations || []).map((l) => ({
          chinese: l.source,
          vietnamese: l.vi,
        }));
        const scoutPrompt = compileChapterScoutPrompt({
          segmentId: segment.id,
          sourceText: segment.sourceText,
          knownEntities,
          knownLocations,
        });

        let scoutData: Record<string, unknown> | null = null;
        let scoutAttempts = 0;
        const maxScoutAttempts = 2;

        while (scoutAttempts < maxScoutAttempts) {
          scoutAttempts++;
          try {
            const currentScoutPrompt = scoutAttempts > 1
              ? `${scoutPrompt}\n\nLƯU Ý BẮT BUỘC: Lần trước định dạng trả lời không phải JSON. BẮT BUỘC chỉ trả về duy nhất 1 khối JSON chuẩn, tuyệt đối không dịch văn bản hay thêm bất kỳ lời dẫn nào!`
              : scoutPrompt;
            const scoutResponse = await send(host, job, currentScoutPrompt, signal, true);
            scoutData = parseProtocolJson(scoutResponse);
            break;
          } catch (scoutErr) {
            if (signal.aborted) throw signal.reason;
            host.logActivity(
              job,
              `V3 · Lượt 1 (Trinh sát) chưa nhận được JSON hợp lệ (thử lần ${scoutAttempts}/${maxScoutAttempts}): ${String(scoutErr)}`,
              'warning',
              segment,
            );
            if (scoutAttempts < maxScoutAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        }

        if (!scoutData) {
          host.logActivity(
            job,
            `V3 · Lượt 1 (Trinh sát) không lấy được JSON sau ${maxScoutAttempts} lần thử. Tự động dùng cấu hình mặc định an toàn để chuyển sang Lượt 2 dịch thuật.`,
            'info',
            segment,
          );
          scoutData = {
            integrity: { status: 'ok' },
            garbage: [],
            newCharacters: [],
            relations: [],
          };
        }

        // 1. Kiểm tra tính toàn vẹn (integrity)
        let integrity = (scoutData.integrity || {}) as { status?: string; reason?: string };
        if (!integrity.status && Array.isArray(scoutData.segments)) {
          const matched = (scoutData.segments as any[]).find(
            (s) => s?.segmentId === segment.id || s?.segmentId === segment.id.replace(/^V3-/u, '')
          );
          if (matched?.integrity) {
            integrity = matched.integrity;
          }
        }
        let integrityStatus = (integrity.status || 'ok').toLowerCase().trim();
        const isSubPart = segment.id.includes('-P');
        if (isSubPart && (integrityStatus === 'truncated' || integrityStatus === 'uncertain')) {
          host.logActivity(
            job,
            `V3 · Phân đoạn ${segment.id} là phần cắt nhỏ của chương dài (sub-part), tự động xác nhận toàn vẹn để dịch tiếp.`,
            'info',
            segment,
          );
          integrityStatus = 'ok';
        }
        if (['truncated', 'corrupted', 'refetch', 'uncertain'].includes(integrityStatus)) {
          host.logActivity(
            job,
            `V3 · Phát hiện nguồn ${segment.id} bất thường (${integrityStatus}): ${integrity.reason || 'cần kiểm tra'}`,
            'warning',
            segment,
          );
          if (!isSubPart && refetches < 2 && chapters[0]?.urls?.length && services.refetchRaw) {
            state.stage = 'refetch';
            host.logActivity(job, `V3 · Tự động tải lại nguồn ${chapters[0].id}...`, 'warning', segment);
            chapters[0].text = await services.refetchRaw(chapters[0], signal);
            segment.sourceText = chapters.map((c) => c.text).join('\n\n');
            refetches++;
            await host.checkpoint(job);
            continue;
          }
          // NGUYÊN TẮC BẢO VỆ TÍNH TOÀN VẸN:
          // Nếu nguồn bị cụt hoặc lỗi mà không refetch được, TUYỆT ĐỐI KHÔNG chuyển sang dịch!
          throw new Error(`Phân đoạn ${segment.id} không toàn vẹn (${integrityStatus}): ${integrity.reason || 'Bị cắt cụt/mất trang'}. Vui lòng kiểm tra lại nguồn.`);
        }

        // 2. Tool tự động cắt rác theo vị trí/chuỗi do AI chỉ ra
        let cleanSource = segment.sourceText;
        const garbage = (Array.isArray(scoutData.garbage) ? scoutData.garbage : []) as GarbageSnippet[];
        if (garbage.length > 0) {
          const beforeLen = cleanSource.length;
          cleanSource = removeGarbageSnippets(cleanSource, garbage);
          const removed = beforeLen - cleanSource.length;
          if (removed > 0) {
            host.logActivity(
              job,
              `V3 · Tool đã tự động lọc sạch ${garbage.length} đoạn rác (${removed} ký tự) khỏi nguồn.`,
              'info',
              segment,
            );
          }
        }

        // 3. Nạp nhân vật mới vào bộ nhớ
        const newCharacters = Array.isArray(scoutData.newCharacters) ? scoutData.newCharacters : [];
        let newCount = 0;
        for (const c of newCharacters as Array<{ source?: string; vi?: string; gender?: string; role?: string }>) {
          if (!c.source || !c.vi || isGenericNameForm(c.source)) continue;
          if (isNonEntityOrCommonWord(c.source, c.vi, c.role)) continue;
          if (/[\u4e00-\u9fa5]/u.test(c.vi)) continue;
          const exists = state.registry.characters.find((x) => x.source === c.source);
          if (!exists) {
            const id = 'C' + String(state.registry.characters.length + 1).padStart(5, '0');
            state.registry.characters.push({
              id,
              source: c.source,
              vi: c.vi,
              kind: c.gender === 'animal' ? 'animal' : 'person',
              gender: (c.gender as 'male' | 'female' | 'unknown') || 'unknown',
              role: c.role || '',
              forms: [{ id: 'F01', source: c.source, vi: c.vi, kind: 'name', evidence: [] }],
            });
            newCount++;
          }
        }
        if (newCount > 0) {
          host.logActivity(job, `V3 · Ghi nhận ${newCount} nhân vật mới vào bộ nhớ từ Lượt 1.`, 'info', segment);
        }

        // 3b. Nạp địa danh mới vào bộ nhớ
        const newLocations = Array.isArray(scoutData.locations) ? scoutData.locations : [];
        let newLocCount = 0;
        if (!state.registry.locations) state.registry.locations = [];
        for (const loc of newLocations as Array<{ source?: string; vi?: string; type?: string }>) {
          if (!loc.source || !loc.vi) continue;
          if (/[\u4e00-\u9fa5]/u.test(loc.vi)) continue;
          const s = loc.source.trim();
          const v = loc.vi.trim();
          if (s.length <= 1) continue;
          const exists = state.registry.locations.find((x) => x.source === s);
          if (!exists) {
            const id = 'L' + String(state.registry.locations.length + 1).padStart(5, '0');
            state.registry.locations.push({
              id,
              source: s,
              vi: v,
              type: loc.type || 'location',
            });
            newLocCount++;
          }
        }
        if (newLocCount > 0) {
          host.logActivity(job, `V3 · Ghi nhận ${newLocCount} địa danh mới vào bộ nhớ từ Lượt 1.`, 'info', segment);
        }

        // 4. Nạp quan hệ / gợi ý xưng hô
        const relations = Array.isArray(scoutData.relations) ? scoutData.relations : [];
        for (const r of relations as Array<{ charA?: string; charB?: string; relation?: string; suggestion?: string }>) {
          if (!r.charA || !r.charB) continue;
          const from = state.registry.characters.find((c) => c.source === r.charA || c.vi === r.charA);
          const to = state.registry.characters.find((c) => c.source === r.charB || c.vi === r.charB);
          if (from && to && from.id !== to.id) {
            const existingRel = state.registry.relations.find((x) => x.fromId === from.id && x.toId === to.id);
            if (!existingRel) {
              state.registry.relations.push({
                fromId: from.id,
                toId: to.id,
                fact: r.relation || '',
                evidence: [],
                samples: r.suggestion
                  ? [{ speakerId: from.id, listenerId: to.id, self: '', call: '', scene: r.suggestion }]
                  : [],
              });
            }
          }
        }

        prepared = {
          cleanSource,
          scoutDone: true,
        };
        segment.preparedV3 = prepared;
        segment.sourceText = cleanSource;
        memoryProjection(job);
        await host.saveJobMemory(job);
        await host.checkpoint(job);
        break;
      }
    }

    // === LƯỢT 2: DỊCH THUẬT VĂN HỌC CHUYÊN SÂU ===
    const maximum = (job.settings.maxRetries ?? 3) + 1;
    let previousError = '';

    while (segment.attempts < maximum) {
      if (signal.aborted) return false;
      segment.attempts++;
      segment.status = 'streaming';
      state.stage = 'translation';

      // Tạo StoryBible từ registry để khóa tên vào khung và gợi ý xưng hô
      const charEntities = state.registry.characters
        .filter((c) => !isNonEntityOrCommonWord(c.source, c.vi, c.role) && !/[\u4e00-\u9fa5]/u.test(c.vi))
        .flatMap((c) => {
          const list: Array<any> = [{
            id: c.id,
            category: 'character',
            zh: c.source,
            vi: c.vi,
            aliases: c.forms.filter((f) => f.source !== c.source).map((f) => ({ zh: f.source })),
            gender: c.gender === 'male' ? 'male' : c.gender === 'female' ? 'female' : 'unknown',
            role: c.role,
            status: 'active',
          }];
          const viParts = c.vi.trim().split(/\s+/);
          if (c.source.length === 3 && viParts.length === 3 && c.kind !== 'animal') {
            const shortZh = c.source.slice(1);
            const shortVi = viParts.slice(1).join(' ');
            list.push({
              id: c.id + '-given',
              category: 'character',
              zh: shortZh,
              vi: shortVi,
              aliases: [],
              gender: c.gender === 'male' ? 'male' : c.gender === 'female' ? 'female' : 'unknown',
              role: c.role,
              status: 'active',
            });
          }
          return list;
        });

      const locEntities = (state.registry.locations || [])
        .filter((l) => Boolean(l.source && l.vi) && !/[\u4e00-\u9fa5]/u.test(l.vi))
        .map((l) => ({
          id: l.id,
          category: 'location' as const,
          zh: l.source,
          vi: l.vi,
          aliases: [] as { zh: string }[],
          gender: 'unknown' as const,
          status: 'active' as const,
        }));

      const bible: StoryBible = {
        schemaVersion: 2,
        profileId: job.promptMode || 'period',
        entities: [...charEntities, ...locEntities],
        relations: state.registry.relations.map((r) => ({
          id: `${r.fromId}-${r.toId}`,
          from: r.fromId,
          to: r.toId,
          type: r.fact,
          samples: r.samples.map((s) => `${s.self} - ${s.call}`),
          address: {
            aToB: { self: r.samples[0]?.self || '', call: r.samples[0]?.call || '' },
            bToA: { self: '', call: '' },
          },
        })),
        timeline: [],
        pending: [],
        updatedAt: new Date().toISOString(),
      };

      const genreProfile = getGenreProfile(job.promptMode ?? 'period');
      const cleanSource = prepared?.cleanSource || segment.sourceText;
      const compiled = compileStoryBiblePrompt({
        segmentId: segment.id,
        segmentIndex: segment.index,
        totalSegments: job.segments.length,
        sourceText: cleanSource,
        bible,
        genreProfile,
        sceneState: 'normal',
        executionMode: job.executionMode === 'api' ? 'api' : 'web',
        aiProvider: job.aiProvider || job.provider || 'chatgpt',
        customPrompt: job.customPrompt || job.resolvedPrompt,
        skipEntityExtraction: true, // KHÔNG BẮT AI TRẢ VỀ <THUC_THE_MOI> Ở LƯỢT 2!
      });

      let promptToSend = compiled.fullPrompt;
      if (segment.attempts > 1 && previousError) {
        const warningBlock = `[CẢNH BÁO QUAN TRỌNG KHI DỊCH LẠI - LẦN THỬ ${segment.attempts}/${maximum}]:\nLần dịch trước của bạn chưa hợp lệ do lỗi: ${previousError}.\nYÊU CẦU BẮT BUỘC:\n- Dịch 100% sang tiếng Việt tự nhiên thuần Việt, tuyệt đối KHÔNG để sót bất kỳ chữ Hán nào.\n- Giữ đúng cấu trúc các thẻ <BAN_DICH> và tiêu đề chương, tuyệt đối không lặp lại lỗi trên!\n`;
        promptToSend = compiled.fullPrompt.replace(/### KHỐI A:/u, `${warningBlock}\n### KHỐI A:`);
        if (promptToSend === compiled.fullPrompt) {
          promptToSend = `${warningBlock}\n\n${compiled.fullPrompt}`;
        }
      }

      host.logActivity(
        job,
        `V3 · Lượt 2/2: Dịch ${segment.index + 1}/${job.segments.length} (đã khóa ${compiled.presentEntities.length} tên trong khung, xưng hô gợi ý linh hoạt); lần ${segment.attempts}/${maximum}.`,
        'info',
        segment,
      );
      await host.checkpoint(job);

      try {
        const response = await send(host, job, promptToSend, signal, false);
        segment.status = 'validating';
        state.stage = 'validation';

        // Lấy bản dịch sạch trong thẻ <BAN_DICH> và gỡ ngoặc ⟦ ⟧ tên riêng
        let translated = sanitizeTranslationResponse(cleanSource, response);
        // Ép sửa nếu AI tự ý đổi họ nhân vật đã khóa (ví dụ Quách Quốc Xương -> Tống Quốc Xương) hoặc trôi tên tiếng Anh
        translated = enforceLockedEntities(translated, compiled.presentEntities, state.registry.characters);
        translated = unlockNamesInTranslation(translated);
        translated = normalizeVietnamesePunctuation(translated);

        let validation = validateTranslation(cleanSource, translated, job.settings.validation);

        // === ƯU TIÊN 1: SỬA CỤC BỘ CÁC CÂU SÓT CHỮ HÁN (LOCALIZED REPAIR) ===
        if (!validation.valid && isLocalizedHanOnly(validation)) {
          if (isDeepSeekApi) {
            // Cơ chế DeepSeek: Gom các câu sót chữ Hán về sửa tập trung 2 lần/bộ truyện (50% và 100%)
            const targets = localizedHanTargets(translated, validation, segment.id);
            if (targets && targets.length > 0) {
              state.pendingHanRepairs ??= [];
              state.pendingHanRepairs.push({
                segmentIndex: segment.index,
                segmentId: segment.id,
                targets,
                cleanSource,
              });
              host.logActivity(
                job,
                `V3 · Tạm ghi nhận ${targets.length} câu sót chữ Hán vào hàng đợi sửa định kỳ (giữa/cuối truyện để tối ưu chi phí).`,
                'info',
                segment,
              );
              validation = { ...validation, valid: true, issues: [], hanCharacters: [] };
            }
          } else {
            const targets = localizedHanTargets(translated, validation, segment.id);
            if (targets && targets.length > 0 && targets.length <= 15) {
              let localAttempt = 0;
              const maxLocalAttempts = 3;
              while (localAttempt < maxLocalAttempts && !validation.valid && isLocalizedHanOnly(validation)) {
                if (signal.aborted) return false;
                localAttempt++;
                host.logActivity(
                  job,
                  `V3 · Phát hiện ${targets.length} câu sót chữ Hán: AI dịch sửa cục bộ câu lỗi theo ngữ cảnh (lần ${localAttempt}/${maxLocalAttempts})...`,
                  'info',
                  segment,
                );
                await host.checkpoint(job);

                const repairPrompt = buildLocalizedHanRepairPrompt({
                  basePrompt: `[TDT_V3_TRANSLATION]\n${job.customPrompt || job.resolvedPrompt}`,
                  targets: targets.map((t) => ({ targetId: t.targetId, sentence: t.text })),
                  attempt: localAttempt,
                  hanSample: validation.issues.find((i) => i.code === 'han_remaining')?.sample || '',
                  includeBasePrompt: true,
                });

                try {
                  const repairResponse = await send(host, job, repairPrompt, signal, false);
                  const parsed = localizedRepairBatchResponseError(repairResponse, targets);
                  if (!parsed.error && parsed.replacements && parsed.replacements.size > 0) {
                    translated = replaceLocalizedTargets(translated, targets, parsed.replacements);
                    validation = validateTranslation(cleanSource, translated, job.settings.validation);
                    if (validation.valid) {
                      host.logActivity(
                        job,
                        `V3 · Đã sửa sạch chữ Hán thành công qua cơ chế sửa câu cục bộ (${targets.length} câu).`,
                        'info',
                        segment,
                      );
                      break;
                    }
                  }
                } catch (repairErr) {
                  if (signal.aborted) return false;
                  host.logActivity(
                    job,
                    `V3 · Lần sửa cục bộ ${localAttempt} chưa đạt: ${String(repairErr)}`,
                    'warning',
                    segment,
                  );
                }
              }
            }
          }
        }

        if (!validation.valid) {
          throw Error(validation.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
        }

        segment.translatedText = translated;
        segment.validation = validation;
        segment.error = undefined;
        state.stage = 'completed-batch';

        // Kích hoạt sửa lỗi tiếng Trung định kỳ cho DeepSeek API (Mốc 1: giữa truyện 50%; Mốc 2: cuối truyện 100%)
        if (isDeepSeekApi && state.pendingHanRepairs && state.pendingHanRepairs.length > 0) {
          const isMidpoint = segment.index === Math.floor(job.segments.length / 2);
          const isFinal = segment.index === job.segments.length - 1;
          if (isMidpoint || isFinal) {
            await flushPendingHanRepairs(host, job, signal, isFinal ? 'cuối truyện' : 'giữa truyện');
          }
          if (isFinal && state.pendingHanRepairs && state.pendingHanRepairs.length > 0) {
            await flushPendingHanRepairs(host, job, signal, 'quét chót cuối truyện');
          }
        }

        // Kiểm định toàn vẹn chữ Hán toàn bộ truyện ở phân đoạn cuối cùng (100%)
        if (segment.index === job.segments.length - 1) {
          const residualHanSegments: string[] = [];
          for (const s of job.segments) {
            if (s.translatedText && /[\u4e00-\u9fa5]/u.test(s.translatedText)) {
              residualHanSegments.push(s.id);
            }
          }
          if (residualHanSegments.length > 0) {
            host.logActivity(
              job,
              `V3 · Kiểm định cuối truyện: Phát hiện ${residualHanSegments.length} phân đoạn còn sót ký tự chữ Hán (${residualHanSegments.slice(0, 5).join(', ')}${residualHanSegments.length > 5 ? '...' : ''}).`,
              'warning',
            );
          } else {
            host.logActivity(job, `V3 · Kiểm định toàn bộ bản dịch cuối truyện: Đạt chuẩn 100% không còn chữ Hán sót!`, 'info');
          }
        }

        return await host.completeSegment(job, segment, signal);
      } catch (error) {
        if (signal.aborted) return false;
        previousError = String(error);
        segment.error = String(error);
        segment.status = 'retrying';
        host.logActivity(job, `V3 · Lượt 2 chưa hợp lệ: ${String(error)}`, 'warning', segment);
        await host.checkpoint(job);
        if (/HTTP (?:429|503)|hạn mức|quota|UNAVAILABLE/iu.test(String(error))) break;
      }
    }
    throw Error(segment.error || 'Đã dùng hết lượt thử dịch hợp lệ.');
  } catch (error) {
    if (signal.aborted) return false;
    segment.error = String(error);
    state.stage = 'failed';
    return host.failSegment(job, segment, signal);
  }
}

/** Install on the real runner; old checkpoints keep their original workflow. */
export function installTranslationPipelineV3(target: unknown, services: PipelineServices = {}): void {
  const host = target as Host;
  if (host.pipelineV3Installed) return;
  host.pipelineV3Installed = true;
  const originalStart = host.start,
    originalLaunch = host.launch,
    originalChunker = host.chunker,
    originalScout = host.ensureAiStoryDigest,
    originalProcess = host.processSegment,
    originalSync = host.autoSyncStoryMemoryFromSegments;
  let starting: Host | undefined;
  host.chunker = function (source: string, options: unknown) {
    if (starting) {
      const mode = starting.executionMode || 'web';
      const provider = starting.aiProvider || starting.provider || 'chatgpt';
      const customPrompt = starting.customPrompt || starting.prompt || '';
      return groupAdaptiveChapterChunks(source, {
        executionMode: mode,
        aiProvider: provider,
        customPrompt: typeof customPrompt === 'string' ? customPrompt : '',
        maxChapters: starting.batchChaptersCount,
      });
    }
    return originalChunker(source, options);
  };
  host.start = async function (request: Host) {
    if (starting) throw Error('Đang khởi tạo một tác vụ khác.');
    starting = request;
    try {
      return await originalStart.call(this, request);
    } finally {
      starting = undefined;
    }
  };
  host.launch = function (job: Host) {
    if (starting && !job.pipelineV3) {
      if (starting.executionMode) {
        job.executionMode = starting.executionMode;
      }
      if (starting.aiProvider) {
        job.aiProvider = starting.aiProvider;
      }
      const batch = starting.batchChaptersCount ?? 2;
      if (batch !== 0 && (batch < 1 || batch > 3)) throw Error('Số chương mỗi mẻ phải từ 1 đến 3.');
      job.pipelineV3 = {
        version: 3,
        batchChapters: batch,
        registry: seedRegistry(job.memory),
        bootstrapDone: false,
        bootstrapCursor: 0,
        stage: 'ready',
        sourceChapters: starting.sourceChapters || [],
      };
    }
    if (job.pipelineV3)
      for (const c of job.pipelineV3.registry.characters)
        c.forms = c.forms.filter((f: Host) => !isGenericNameForm(f.source));
    return originalLaunch.call(this, job);
  };
  host.ensureAiStoryDigest = async function (job: Host, signal: AbortSignal) {
    if (job.pipelineV3) {
      if (!job.storyDigestAttempted && (!job.memory?.entities || job.memory.entities.length === 0)) {
        await originalScout.call(this, job, signal);
      }
      return bootstrap(this, job, signal);
    }
    return originalScout.call(this, job, signal);
  };
  host.processSegment = function (job: Host, segment: Host, signal: AbortSignal) {
    return job.pipelineV3 ? processBatch(this, job, segment, signal, services) : originalProcess.call(this, job, segment, signal);
  };
  host.autoSyncStoryMemoryFromSegments = function (job: Host, options: unknown) {
    return job.pipelineV3 ? Promise.resolve(false) : originalSync.call(this, job, options);
  };
  const originalSaveMemory = host.saveStoryMemory,
    originalClearMemory = host.clearStoryMemory,
    originalGetMemory = host.getStoryMemory;
  host.getStoryMemory = async function (options?: Host) {
    const memory = await originalGetMemory.call(this, options),
      job = options?.jobId ? host.jobs.get(options.jobId) : undefined;
    if (!job?.pipelineV3) return memory;
    const preview = { memory: structuredClone(memory), pipelineV3: job.pipelineV3 };
    memoryProjection(preview);
    return preview.memory;
  };
  const editableJob = async (id?: string) => {
    const job = id ? host.jobs.get(id) : undefined;
    if (job?.pipelineV3 && ['queued', 'running'].includes(job.status))
      throw Error('Tạm dừng dịch trước khi cập nhật bộ nhớ tên.');
    return job?.pipelineV3 ? job : undefined;
  };
  const resetPending = (job: Host) => {
    for (const s of job.segments) {
      if (s.status === 'completed' || !s.preparedV3) continue;
      s.sourceText = s.preparedV3.originalSourceText || s.sourceText;
      delete s.preparedV3;
      s.attempts = 0;
    }
  };
  host.saveStoryMemory = async function (options: Host) {
    const job = await editableJob(options.jobId);
    if (!job) return originalSaveMemory.call(this, options);
    const memory = await originalSaveMemory.call(this, options);
    job.pipelineV3.registry = seedRegistry(memory);
    resetPending(job);
    memoryProjection(job);
    await host.saveJobMemory(job);
    await host.checkpoint(job);
    return job.memory;
  };
  host.clearStoryMemory = async function (options?: Host) {
    const job = await editableJob(options?.jobId);
    await originalClearMemory.call(this, options);
    if (job) {
      job.pipelineV3.registry = emptyRegistry();
      job.pipelineV3.bootstrapDone = false;
      job.pipelineV3.bootstrapCursor = 0;
      resetPending(job);
      await host.checkpoint(job);
    }
  };
}
