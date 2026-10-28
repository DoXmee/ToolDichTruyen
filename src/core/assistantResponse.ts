import { parseChapterHeaderLine } from './titleParser';
import { unlockNamesInTranslation } from './nameLocker.js';
import {
  COMMON_NOUN_BLACKLIST,
  DIRECTIONS_AND_REGIONS,
  INVALID_NAME_ENDINGS,
  URBAN_ARCHITECTURAL_LOCATIONS,
  transcribeHanViet,
} from './storyMemoryExtractor.js';

interface ResponseLine {
  text: string;
  start: number;
}

const ASSISTANT_CHROME_LABEL = /^(?:Bài viết|Article)$/iu;
const HORIZONTAL_RULE = /^(?:-{3,}|_{3,}|\*{3,})$/u;

function responseLines(value: string): ResponseLine[] {
  const lines: ResponseLine[] = [];
  const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const raw = match[0];
    if (!raw) break;
    lines.push({
      text: raw.replace(/(?:\r\n|\r|\n)$/u, ''),
      start: match.index,
    });
  }

  return lines;
}

export function isAssistantChromeLabel(value: string): boolean {
  return ASSISTANT_CHROME_LABEL.test(value.trim());
}

export function isHorizontalRule(value: string): boolean {
  return HORIZONTAL_RULE.test(value.trim());
}

/**
 * ChatGPT can expose the localized writing-block label ("Bài viết") through
 * innerText even though it is browser chrome rather than model prose. Remove
 * it only when it is the first meaningful line and is immediately followed
 * by the same chapter heading as the source segment.
 */
export function sanitizeTranslationResponse(sourceText: string, responseText: string): string {
  const source = (sourceText ?? '').normalize('NFC');
  let response = (responseText ?? '').normalize('NFC').trim();
  if (!response) return response;

  // Extract translation from <BAN_DICH id="...">...</BAN_DICH> wrapper if present (supports <BANDICH> variants)
  const banDichMatch = response.match(/<(?:BAN_DICH|BANDICH|BAN\s+DICH|BẢN\s+DỊCH)[^>]*>([\s\S]*?)<\/(?:BAN_DICH|BANDICH|BAN\s+DICH|BẢN\s+DỊCH)>/i);
  if (banDichMatch) {
    response = banDichMatch[1]!.trim();
  } else {
    const openTagMatch = response.match(/<(?:BAN_DICH|BANDICH|BAN\s+DICH|BẢN\s+DỊCH)[^>]*>([\s\S]*)$/i);
    if (openTagMatch) {
      response = openTagMatch[1]!.trim();
    }
  }

  // Remove any remaining <THUC_THE_MOI>...</THUC_THE_MOI> block from translation text
  response = response.replace(/<THUC_THE_MOI[^>]*>[\s\S]*?<\/THUC_THE_MOI>/gi, '').trim();
  response = response.replace(/<THUC_THE_MOI[^>]*>[\s\S]*$/gi, '').trim();

  // Active JSON Stripper: Strip any bare JSON array or markdown codefence containing entity metadata
  // (e.g. ```json [...] ``` or bare [ { "category": ... } ])
  response = response.replace(/```(?:json)?\s*\[\s*\{[\s\S]*?\}\s*\]\s*```/gi, '').trim();
  response = response.replace(/\[\s*\{\s*["']category["'][\s\S]*?\}\s*\]/gi, '').trim();
  response = response.replace(/\{\s*["']category["']\s*:\s*["'][^"']+["'][\s\S]*?\}(?:,\s*)?/gi, '').trim();

  // Strip standalone closing tags or accidental wrapper debris
  response = response.replace(/<\/(?:BAN_DICH|BANDICH|BAN\s+DICH|BẢN\s+DỊCH)>/gi, '').trim();
  response = response.replace(/<(?:BAN_DICH|BANDICH|BAN\s+DICH|BẢN\s+DỊCH)[^>]*>/gi, '').trim();

  // Clean trailing unclosed JSON residue, accidental tags, or brackets leftover from entity extraction formatting
  response = response.replace(/\s*(?:<(?:BAN_DICH|BANDICH)[^>]*>)?\s*\[\s*(?:\{[\s\S]*?)?$/u, '').trim();
  response = response.replace(/\s*(?:<(?:BAN_DICH|BANDICH)[^>]*>)?\s*\[\s*\]?\s*$/u, '').trim();

  if (response.includes('⟦') && response.includes('⟧')) {
    response = unlockNamesInTranslation(response);
  }

  const sourceHeader = source
    .split(/\r\n|\r|\n/u)
    .map((line) => parseChapterHeaderLine(line))
    .find((header) => Boolean(header));
  if (!sourceHeader) return response;

  const lines = responseLines(response);
  let cursor = lines.findIndex((line) => Boolean(line.text.trim()));
  if (cursor < 0 || !isAssistantChromeLabel(lines[cursor]?.text ?? '')) return response;

  cursor += 1;
  while (cursor < lines.length && !lines[cursor]?.text.trim()) cursor += 1;
  if (cursor < lines.length && isHorizontalRule(lines[cursor]?.text ?? '')) {
    cursor += 1;
    while (cursor < lines.length && !lines[cursor]?.text.trim()) cursor += 1;
  }

  const translatedHeader = parseChapterHeaderLine(lines[cursor]?.text ?? '');
  if (!translatedHeader || translatedHeader.chapterNumber !== sourceHeader.chapterNumber) {
    return response;
  }

  return response.slice(lines[cursor]?.start ?? 0).trim();
}

export interface DiscoveredStoryEntity {
  zh: string;
  vi: string;
  category: 'character' | 'location' | 'faction';
  gender?: 'male' | 'female' | 'unknown';
  role?: string;
  notes?: string;
  aliases?: string[];
}

export interface DiscoveredCharacterRelation {
  charA: string;
  charB: string;
  relationType: string;
  aToB?: { self?: string; call?: string };
  bToA?: { self?: string; call?: string };
}

export interface DiscoveredStoryData {
  entities: DiscoveredStoryEntity[];
  relations: DiscoveredCharacterRelation[];
}

export type DiscoveredCharacterEntity = DiscoveredStoryEntity;

/**
 * Extracts new story entities (characters & locations) and relationships discovered
 * and verified by LLM during segment translation.
 */
export function extractDiscoveredDataFromResponse(
  responseText: string,
): DiscoveredStoryData {
  if (!responseText) return { entities: [], relations: [] };

  let rawContent = '';
  const match = responseText.match(/<THUC_THE_MOI[^>]*>([\s\S]*?)<\/THUC_THE_MOI>/i);
  if (match && match[1]) {
    rawContent = match[1].trim();
  } else {
    // Fallback: look for unclosed <THUC_THE_MOI> or bare JSON array containing "category"
    const openMatch = responseText.match(/<THUC_THE_MOI[^>]*>([\s\S]*)$/i);
    if (openMatch && openMatch[1]) {
      rawContent = openMatch[1].trim();
    } else {
      const bareArrayMatch = responseText.match(/\[\s*\{[\s\S]*?"category"[\s\S]*?\}\s*\]/);
      if (bareArrayMatch) {
        rawContent = bareArrayMatch[0].trim();
      }
    }
  }

  if (!rawContent) return { entities: [], relations: [] };

  // Remove markdown code fences if AI wrapped JSON inside ```json ... ```
  rawContent = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    // If direct parse fails, try extracting array [...]
    const arrayMatch = rawContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      try {
        parsed = JSON.parse(arrayMatch[0]);
      } catch {
        return { entities: [], relations: [] };
      }
    } else {
      return { entities: [], relations: [] };
    }
  }

  if (!Array.isArray(parsed)) return { entities: [], relations: [] };

  const entities: DiscoveredStoryEntity[] = [];
  const relations: DiscoveredCharacterRelation[] = [];
  const seenZh = new Set<string>();

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;

    const rawCategory = typeof (item as Record<string, unknown>).category === 'string'
      ? ((item as Record<string, unknown>).category as string).trim().toLowerCase()
      : typeof (item as Record<string, unknown>).loai === 'string'
        ? ((item as Record<string, unknown>).loai as string).trim().toLowerCase()
        : '';

    // Check if this item is a character relation / address mapping
    const isRelation =
      rawCategory === 'relation' ||
      rawCategory === 'quan_he' ||
      rawCategory === 'quanhe' ||
      rawCategory === 'xung_ho' ||
      Boolean((item as Record<string, unknown>).charA && (item as Record<string, unknown>).charB) ||
      Boolean((item as Record<string, unknown>).sourceCharacter && (item as Record<string, unknown>).targetCharacter);

    if (isRelation) {
      const charA = String(
        (item as Record<string, unknown>).charA ||
        (item as Record<string, unknown>).sourceCharacter ||
        (item as Record<string, unknown>).source ||
        '',
      ).trim();
      const charB = String(
        (item as Record<string, unknown>).charB ||
        (item as Record<string, unknown>).targetCharacter ||
        (item as Record<string, unknown>).target ||
        '',
      ).trim();
      const relationType = String(
        (item as Record<string, unknown>).relation ||
        (item as Record<string, unknown>).relationType ||
        (item as Record<string, unknown>).loai_quan_he ||
        'Quan hệ',
      ).trim();

      if (!charA || !charB || charA.toLowerCase() === charB.toLowerCase()) continue;

      const parseAddress = (val: unknown): { self?: string; call?: string } | undefined => {
        if (!val) return undefined;
        if (typeof val === 'object') {
          const s = (val as Record<string, unknown>).self ? String((val as Record<string, unknown>).self).trim() : undefined;
          const c = (val as Record<string, unknown>).call ? String((val as Record<string, unknown>).call).trim() : undefined;
          return s || c ? { self: s, call: c } : undefined;
        }
        if (typeof val === 'string') {
          const parts = val.split(/[-–—/]/).map((p) => p.trim());
          if (parts.length >= 2) {
            return { self: parts[0] || undefined, call: parts[1] || undefined };
          }
          return { call: val.trim() };
        }
        return undefined;
      };

      const rawAToB = (item as Record<string, unknown>).aToB ?? (item as Record<string, unknown>).a_to_b;
      const rawBToA = (item as Record<string, unknown>).bToA ?? (item as Record<string, unknown>).b_to_a;

      relations.push({
        charA,
        charB,
        relationType,
        aToB: parseAddress(rawAToB),
        bToA: parseAddress(rawBToA),
      });
      continue;
    }

    const rawZh = typeof (item as Record<string, unknown>).zh === 'string'
      ? ((item as Record<string, unknown>).zh as string).trim()
      : '';
    let rawVi = typeof (item as Record<string, unknown>).vi === 'string'
      ? ((item as Record<string, unknown>).vi as string).trim()
      : '';
    const rawGender = typeof (item as Record<string, unknown>).gender === 'string'
      ? ((item as Record<string, unknown>).gender as string).trim().toLowerCase()
      : '';
    const rawRole = typeof (item as Record<string, unknown>).role === 'string'
      ? ((item as Record<string, unknown>).role as string).trim()
      : undefined;
    const rawNotes = typeof (item as Record<string, unknown>).notes === 'string'
      ? ((item as Record<string, unknown>).notes as string).trim()
      : typeof (item as Record<string, unknown>).mo_ta === 'string'
        ? ((item as Record<string, unknown>).mo_ta as string).trim()
        : undefined;

    const rawAliasesList = Array.isArray((item as Record<string, unknown>).aliases)
      ? ((item as Record<string, unknown>).aliases as unknown[])
      : Array.isArray((item as Record<string, unknown>).bi_danh)
        ? ((item as Record<string, unknown>).bi_danh as unknown[])
        : typeof (item as Record<string, unknown>).alias === 'string'
          ? [(item as Record<string, unknown>).alias]
          : [];
    const cleanAliases = rawAliasesList
      .map((a) => (typeof a === 'string' ? a.trim() : ''))
      .filter((a) => a.length >= 2 && a !== rawZh);

    const isOrganizationCategory =
      rawCategory === 'organization' ||
      rawCategory === 'to_chuc' ||
      rawCategory === 'truong_hoc' ||
      rawCategory === 'truong' ||
      rawCategory === 'school' ||
      rawCategory === 'co_quan' ||
      rawCategory === 'don_vi' ||
      rawCategory === 'xi_nghiep' ||
      rawCategory === 'faction' ||
      rawCategory === 'the_luc';

    const isLocationCategory =
      rawCategory === 'location' ||
      rawCategory === 'dia_danh' ||
      rawCategory === 'diadanh' ||
      rawCategory === 'khu_vuc';

    const category: 'character' | 'location' | 'faction' =
      isOrganizationCategory
        ? 'faction'
        : isLocationCategory
          ? 'location'
          : 'character';

    // Validate Chinese name: 2-4 CJK characters for characters, up to 8 for locations & organizations
    const maxLen = category === 'character' ? 4 : 8;
    if (!new RegExp(`^[\\u4e00-\\u9fa5]{2,${maxLen}}$`, 'u').test(rawZh)) continue;
    if (seenZh.has(rawZh)) continue;

    // Reject common words or invalid endings
    if (COMMON_NOUN_BLACKLIST.has(rawZh)) continue;
    const lastChar = rawZh[rawZh.length - 1]!;
    if (INVALID_NAME_ENDINGS.has(lastChar)) {
      const isSchoolEnding =
        lastChar === '中' && (category === 'faction' || category === 'location') && rawZh.length >= 3;
      if (!isSchoolEnding) {
        continue;
      }
    }

    // Reject architectural / directions as character names
    if (category === 'character') {
      if (URBAN_ARCHITECTURAL_LOCATIONS.has(rawZh) || DIRECTIONS_AND_REGIONS.has(rawZh)) {
        continue;
      }
    }

    // Standardize Vietnamese transcription
    if (!rawVi) {
      const transcribed = transcribeHanViet(rawZh);
      if (!transcribed) continue;
      rawVi = transcribed;
    }
    // Capitalize words properly
    const cleanVi = rawVi
      .split(/\s+/)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
      .join(' ')
      .trim();

    if (!cleanVi) continue;

    // Normalize gender (if character)
    let gender: 'male' | 'female' | 'unknown' | undefined = undefined;
    if (category === 'character') {
      gender = 'unknown';
      if (rawGender === 'nam' || rawGender === 'male' || rawGender.includes('nam') || rawGender === 'trai') {
        gender = 'male';
      } else if (rawGender === 'nữ' || rawGender === 'nu' || rawGender === 'female' || rawGender.includes('nữ') || rawGender === 'gái') {
        gender = 'female';
      }
    }

    // Clean role: ignore placeholders like —, -, null, undefined, chưa rõ, không rõ
    let cleanRole: string | undefined = undefined;
    if (
      rawRole &&
      !['—', '-', '–', 'null', 'undefined', 'không rõ', 'chưa rõ', 'unknown', 'none'].includes(
        rawRole.toLowerCase(),
      )
    ) {
      cleanRole = rawRole;
    }

    // Clean notes
    let cleanNotes: string | undefined = undefined;
    if (
      rawNotes &&
      !['—', '-', '–', 'null', 'undefined', 'không rõ', 'chưa rõ', 'unknown', 'none'].includes(
        rawNotes.toLowerCase(),
      )
    ) {
      cleanNotes = rawNotes;
    }

    seenZh.add(rawZh);
    entities.push({
      zh: rawZh,
      vi: cleanVi,
      category,
      gender,
      role: cleanRole,
      notes: cleanNotes,
      aliases: cleanAliases.length > 0 ? cleanAliases : undefined,
    });
  }

  return { entities, relations };
}

/**
 * Extracts new story entities (characters & locations) discovered and verified by LLM during segment translation.
 * Ensures strictly validated CJK names and normalized Vietnamese transcriptions.
 */
export function extractDiscoveredEntitiesFromResponse(
  responseText: string,
): DiscoveredStoryEntity[] {
  return extractDiscoveredDataFromResponse(responseText).entities;
}
