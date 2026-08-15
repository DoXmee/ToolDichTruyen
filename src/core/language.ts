import type {
  HanCharacterLocation,
  InputLanguage,
  LanguageAnalysis,
  LanguageOption,
  TextToken,
  UnicodeScript,
} from '../shared';

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { id: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { id: 'en', name: 'Tiếng Anh', flag: '🇬🇧' },
  { id: 'zh', name: 'Tiếng Trung', flag: '🇨🇳' },
  { id: 'ja', name: 'Tiếng Nhật', flag: '🇯🇵' },
  { id: 'ko', name: 'Tiếng Hàn', flag: '🇰🇷' },
] as const;

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const HAN_CHARACTER = /\p{Script=Han}/u;
const LATIN_TOKEN = /^[\p{Script=Latin}\p{M}\p{N}]+$/u;
const ASCII_TOKEN = /^[A-Za-z0-9]+$/u;
const CHINESE_TOKEN = /^[\p{Script=Han}\p{Script=Latin}\p{M}\p{N}]+$/u;
const JAPANESE_TOKEN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{M}\p{N}]+$/u;
const KOREAN_TOKEN =
  /^[\p{Script=Hangul}\p{Script=Han}\p{Script=Latin}\p{M}\p{N}]+$/u;

function detectScript(token: string): UnicodeScript {
  if (/\p{Script=Han}/u.test(token)) return 'han';
  if (/\p{Script=Hiragana}/u.test(token)) return 'hiragana';
  if (/\p{Script=Katakana}/u.test(token)) return 'katakana';
  if (/\p{Script=Hangul}/u.test(token)) return 'hangul';
  if (/\p{Script=Latin}/u.test(token)) return 'latin';
  if (/\p{N}/u.test(token)) return 'number';
  return 'other';
}

function isTokenValid(token: string, language: InputLanguage): boolean {
  switch (language) {
    case 'vi':
      // Script detection can flag Han/Cyrillic, but cannot reliably distinguish
      // unaccented Vietnamese, English, and Pinyin. The UI should describe this
      // as a warning rather than proof of the token's language.
      return LATIN_TOKEN.test(token);
    case 'en':
      return ASCII_TOKEN.test(token);
    case 'zh':
      return CHINESE_TOKEN.test(token);
    case 'ja':
      return JAPANESE_TOKEN.test(token);
    case 'ko':
      return KOREAN_TOKEN.test(token);
  }
}

export function locateHanCharacters(text: string): HanCharacterLocation[] {
  const normalizedText = text.normalize('NFC');
  const result: HanCharacterLocation[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;
  let previousWasCarriageReturn = false;

  for (const character of normalizedText) {
    const start = offset;
    const end = start + character.length;

    if (HAN_CHARACTER.test(character)) {
      result.push({ character, start, end, line, column });
    }

    if (character === '\r') {
      line += 1;
      column = 1;
      previousWasCarriageReturn = true;
    } else if (character === '\n') {
      if (!previousWasCarriageReturn) line += 1;
      column = 1;
      previousWasCarriageReturn = false;
    } else {
      column += 1;
      previousWasCarriageReturn = false;
    }

    offset = end;
  }

  return result;
}

function tokenize(normalizedText: string, language: InputLanguage): TextToken[] {
  const tokens: TextToken[] = [];
  let currentText = '';
  let currentStart = 0;
  let currentKind: 'han' | 'word' | 'other' | null = null;
  let offset = 0;

  const flush = (): void => {
    if (!currentText || currentKind === null) return;
    const isWord = currentKind !== 'other';
    tokens.push({
      text: currentText,
      start: currentStart,
      end: currentStart + currentText.length,
      isWord,
      isMismatched: isWord ? !isTokenValid(currentText, language) : false,
      script: isWord ? detectScript(currentText) : undefined,
    });
    currentText = '';
    currentKind = null;
  };

  for (const character of normalizedText) {
    const kind: 'han' | 'word' | 'other' = HAN_CHARACTER.test(character)
      ? 'han'
      : WORD_CHARACTER.test(character)
        ? 'word'
        : 'other';

    // Han characters are individual countable units. All other letters/numbers
    // form word runs, and punctuation/whitespace is retained as non-word runs.
    if (kind === 'han') {
      flush();
      currentText = character;
      currentStart = offset;
      currentKind = kind;
      flush();
    } else if (currentKind === kind) {
      currentText += character;
    } else {
      flush();
      currentText = character;
      currentStart = offset;
      currentKind = kind;
    }

    offset += character.length;
  }
  flush();

  return tokens;
}

export function analyzeTextLanguage(text: string, language: InputLanguage): LanguageAnalysis {
  const normalizedText = (text ?? '').normalize('NFC');
  if (!normalizedText.trim()) {
    return {
      normalizedText,
      totalWords: 0,
      mismatchedCount: 0,
      tokens: normalizedText
        ? [
            {
              text: normalizedText,
              start: 0,
              end: normalizedText.length,
              isWord: false,
              isMismatched: false,
            },
          ]
        : [],
      hanCharacters: [],
      hanCount: 0,
    };
  }

  const tokens = tokenize(normalizedText, language);
  const hanCharacters = locateHanCharacters(normalizedText);
  const wordTokens = tokens.filter((token) => token.isWord);

  return {
    normalizedText,
    totalWords: wordTokens.length,
    mismatchedCount: wordTokens.filter((token) => token.isMismatched).length,
    tokens,
    hanCharacters,
    hanCount: hanCharacters.length,
  };
}

export function countWords(text: string, language: InputLanguage = 'vi'): number {
  return analyzeTextLanguage(text, language).totalWords;
}
