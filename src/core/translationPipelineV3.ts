import { sify, tify } from 'chinese-conv';
import { transcribeHanViet } from './storyMemoryExtractor.js';
import { parseChapterHeaderLine } from './titleParser.js';

export type IdentityKind = 'person' | 'animal';
export interface NameForm { id: string; source: string; vi: string; kind: 'name' | 'short' | 'address' | 'nickname'; evidence?: Evidence[] }
export interface Identity { id: string; source: string; vi: string; kind: IdentityKind; gender: string; role: string; forms: NameForm[] }
export interface Evidence { paragraphId: string; quote: string }
export interface Paragraph { id: string; chapterId: string; text: string }
export interface ChapterInput { id: string; number: number; title: string; text: string; urls?: string[] }
export interface LocationEntity { id: string; source: string; vi: string; type?: string }
export interface Registry { characters: Identity[]; relations: RelationFact[]; locations?: LocationEntity[]; unresolved: unknown[] }
export interface RelationFact { fromId: string; toId: string; fact: string; evidence: Evidence[]; samples: Array<{ speakerId: string; listenerId: string; self: string; call: string; scene: string }> }
export interface SceneFact { paragraphId: string; speaker: string; listener: string; facts: string; suggestedAddress: string; evidence: Evidence[] }
export interface AnalysisResult {
  integrity: Array<{ chapterId: string; status: 'ok' | 'refetch'; reason: string }>;
  garbage: Array<{ paragraphId: string; start: number; end: number; text: string; reason: string }>;
  newCharacters: Array<{ ref: string; source: string; vi: string; kind: IdentityKind; gender: string; role: string; evidence: Evidence[] }>;
  aliasUpdates: Array<{ targetId: string; source: string; vi: string; kind: NameForm['kind']; evidence: Evidence[] }>;
  relations: RelationFact[];
  uncertain: Array<{ source: string; candidateIds: string[]; reason: string; evidence: Evidence[] }>;
  resolutions: Array<{ paragraphId: string; start: number; end: number; entityId: string }>;
  scenes?: SceneFact[];
}
export interface RowRepair { id:string; text:string; issue:string; hints?: Record<string,string> }
export interface ExtraMemory { terms:Array<{category:string;source:string;vi:string}>; rules:string[]; characterNotes:Array<{id:string;notes?:string;narrationSuggestion?:string}> }
export interface EncodedBatch { paragraphs: Paragraph[]; tokens: Array<{ token: string; entityId: string; formId: string; paragraphId: string; vi: string }>; registry: Registry; scenes?: SceneFact[]; nearby?: Array<{id:string;source:string;translation:string}>; repairs?: RowRepair[]; protectChapterHeaders?:boolean; extraMemory?:ExtraMemory }

const key = (text: string): string => sify(text.normalize('NFC').trim());
export const isGenericNameForm=(value:string)=>{
  const normalized=key(value);
  return /^(?:那|这|此)?(?:个|位)?(?:他|她|它|牠|男子|女子|少年|男人|女人|哥哥|弟弟|姐姐|妹妹|姑娘|夫人|太夫人|老太太|老夫人|嬷嬷|丫鬟|小姐|少爷|公子|老爷|大娘|老侯爷|侯爷|老国公|国公|皇帝|皇上|皇后|太后|皇太后|贵妃|太子|太子妃|公主|长公主|大长公主|王爷|王妃|[大二三四五六七八九十]+(?:老爷|太太|夫人|小姐|少爷|公子|姑娘|哥|姐|弟|妹|兄|嫂|叔|伯|舅|爷))$/u.test(normalized)
    || /^(?:(?:大|二|三|四|五|六|七|八|九|十|小|老|表|堂|族|亲|干|义|继|生|养|曾|高|外){0,4})(?:父亲|母亲|爸爸|妈妈|爹爹|娘亲|阿爹|阿娘|爹|娘|父|母|祖父|祖母|爷爷|奶奶|外公|外婆|姥爷|姥姥|兄长|哥哥|兄|哥|弟弟|弟|姐姐|姊姊|姐|妹妹|妹|伯父|伯母|叔叔|叔父|叔母|叔|伯|舅舅|舅父|舅母|舅|姨姨|姨妈|姨娘|姨母|姨父|姨|姑姑|姑母|姑妈|姑父|姑|婶婶|婶母|婶娘|婶|嫂嫂|嫂子|嫂|弟媳|弟妹|姐夫|妹夫|媳妇|儿媳|女婿|夫君|丈夫|相公|妻子|娘子|父王|母后|父皇|母妃|皇兄|皇姐|皇弟|皇妹)(?:大人)?$/u.test(normalized);
};
export const emptyRegistry = (): Registry => ({ characters: [], relations: [], locations: [], unresolved: [] });
export function parseProtocolJson(text: string): Record<string, unknown> {
  if (!text || typeof text !== 'string') {
    throw new Error('Phản hồi trống, không có nội dung JSON.');
  }

  // 1. Try extracting from markdown code block ```json ... ``` (greedy or unclosed)
  let raw = '';
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/iu);
  if (fenceMatch && fenceMatch[1]?.trim()) {
    raw = fenceMatch[1].trim();
  } else {
    raw = text.trim();
  }

  // 2. Extract outermost JSON object from first '{' to last '}'
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    raw = raw.slice(firstBrace, lastBrace + 1).trim();
  } else if (firstBrace >= 0) {
    raw = raw.slice(firstBrace).trim();
  }

  const tryParse = (str: string): Record<string, unknown> | null => {
    try {
      const val = JSON.parse(str);
      if (val && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
    } catch {
      return null;
    }
    return null;
  };

  // 3. Direct parse attempt
  let parsed = tryParse(raw);
  if (parsed) return parsed;

  // 4. Clean trailing commas & invalid control characters
  const cleaned = raw
    .replace(/,\s*([\]}])/gu, '$1')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/gu, ' ');
  parsed = tryParse(cleaned);
  if (parsed) return parsed;

  // 5. If truncated at the end (missing closing braces/brackets) with actual content
  if (firstBrace >= 0 && cleaned.includes(':')) {
    // Strategy A: Backtrack to the last complete object '}' in an array/object and close cleanly
    let lastClose = cleaned.lastIndexOf('}');
    while (lastClose > firstBrace) {
      let candidate = cleaned.slice(0, lastClose + 1);
      const stack: string[] = [];
      let inS = false;
      let esc = false;
      for (let i = 0; i < candidate.length; i++) {
        const c = candidate[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inS = !inS; continue; }
        if (!inS) {
          if (c === '{' || c === '[') stack.push(c);
          else if (c === '}' && stack[stack.length - 1] === '{') stack.pop();
          else if (c === ']' && stack[stack.length - 1] === '[') stack.pop();
        }
      }
      const closing = stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
      candidate = (candidate + closing).replace(/,\s*([\]}])/gu, '$1');
      parsed = tryParse(candidate);
      if (parsed) return parsed;
      lastClose = cleaned.lastIndexOf('}', lastClose - 1);
    }

    // Strategy B: Close trailing property and close open brackets via stack
    let repaired = cleaned;
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      repaired += '"';
    }
    repaired = repaired.replace(/,\s*$/u, '').replace(/:\s*"?[^",}]*$/u, ': null');
    const stack: string[] = [];
    let inS = false;
    let esc = false;
    for (let i = 0; i < repaired.length; i++) {
      const c = repaired[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inS = !inS; continue; }
      if (!inS) {
        if (c === '{' || c === '[') stack.push(c);
        else if (c === '}' && stack[stack.length - 1] === '{') stack.pop();
        else if (c === ']' && stack[stack.length - 1] === '[') stack.pop();
      }
    }
    repaired = (repaired + stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('')).replace(/,\s*([\]}])/gu, '$1');
    parsed = tryParse(repaired);
    if (parsed) return parsed;
  }

  throw new Error('Phản hồi JSON chưa đầy đủ/hợp lệ; không dùng phần trả lời bị cắt.');
}
export function splitChapters(source: string): ChapterInput[] {
  const headers = [...source.matchAll(/(?:^|\n)[ \t]*Chương[ \t]+(\d+)[^\n]*/giu)];
  if (!headers.length) return [{ id: 'CH1', number: 1, title: 'Chương 1', text: source }];
  if (source.slice(0, headers[0]!.index).trim()) throw new Error('Có nội dung trước tiêu đề chương; cần xác nhận nguồn trước khi chia mẻ.');
  const seen = new Set<number>();
  return headers.map((h,i) => { const number = Number(h[1]); if(seen.has(number)) throw new Error('Nguồn trùng số chương '+number);seen.add(number);
    return { id: 'CH'+number, number, title: h[0].trim(), text: source.slice(h.index, headers[i+1]?.index ?? source.length).trim() }; });
}
export function groupChapterChunks(source: string, count: number): Array<{ id: string; index: number; start: number; end: number; text: string }> {
  if (count < 1 || count > 3) throw new Error('Chỉ chọn 1, 2 hoặc 3 chương mỗi mẻ.');
  const chapters = splitChapters(source);
  const result: Array<{ id: string; index: number; start: number; end: number; text: string }> = [];
  let offset = 0;
  for (let i = 0; i < chapters.length; i += count) {
    const batch = chapters.slice(i, i + count);
    const text = batch.map((c) => c.text).join('\n\n');
    const first = batch[0]!;
    const last = batch[batch.length - 1]!;
    const id = first.id === last.id ? `V3-${first.id}` : `V3-${first.id}-${last.id}`;
    result.push({
      id,
      index: result.length,
      start: offset,
      end: offset + text.length,
      text,
    });
    offset += text.length + 2;
  }
  return result;
}

export interface AdaptiveChapterGroupOptions {
  executionMode?: 'web' | 'api';
  aiProvider?: 'chatgpt' | 'kimi' | 'deepseek' | 'gemini';
  maxBatchChars?: number;
  maxChapters?: number;
}

export function groupAdaptiveChapterChunks(
  source: string,
  options?: AdaptiveChapterGroupOptions,
): Array<{ id: string; index: number; start: number; end: number; text: string; chapterCount: number }> {
  const chapters = splitChapters(source);
  const result: Array<{ id: string; index: number; start: number; end: number; text: string; chapterCount: number }> = [];
  const executionMode = options?.executionMode || 'web';
  const isDeepSeekApi = executionMode === 'api' && options?.aiProvider === 'deepseek';
  const defaultMaxChars = isDeepSeekApi ? 3500 : executionMode === 'web' ? 5000 : 14000;
  const maxBatchChars = options?.maxBatchChars ?? defaultMaxChars;
  const defaultMaxChapters = executionMode === 'web' ? 3 : isDeepSeekApi ? 10 : 20;
  const maxChapters = options?.maxChapters
    ? Math.min(Math.max(options.maxChapters, 1), 20)
    : defaultMaxChapters;

  let i = 0;
  let offset = 0;
  while (i < chapters.length) {
    // Luôn lấy tối thiểu 1 chương NGUYÊN VẸN. TUYỆT ĐỐI KHÔNG CẮT NGANG GIỮA CHƯƠNG!
    const batch = [chapters[i]!];
    let currentLength = chapters[i]!.text.length;

    while (batch.length < maxChapters && (i + batch.length) < chapters.length) {
      const next = chapters[i + batch.length]!;
      if (currentLength + 2 + next.text.length <= maxBatchChars) {
        batch.push(next);
        currentLength += 2 + next.text.length;
      } else {
        break;
      }
    }

    const text = batch.map((c) => c.text).join('\n\n');
    const first = batch[0]!;
    const last = batch[batch.length - 1]!;
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
export function paragraphsFor(chapters: ChapterInput[]): Paragraph[] {
  return chapters.flatMap(c => c.text.split(/\r?\n/u).filter(p=>p.trim()).map((text,i)=>({ id:`${c.id}-P${String(i+1).padStart(4,'0')}`,chapterId:c.id,text })));
}
/** Permit typography changes only; retain a real source excerpt in memory. */
export function verifyEvidence(evidence: Evidence[], paragraphs: Paragraph[], source?: string, relocate=false): Evidence[] {
  if(!Array.isArray(evidence)||!evidence.length)throw new Error('Thiếu bằng chứng nguồn cho thực thể/alias/quan hệ.');
  const equivalent=(value:string)=>key(value.normalize('NFKC')).replace(/[\p{P}\s]/gu,'');
  let hasSource=!source;
  const verified=evidence.map(e=>{
    let p=paragraphs.find(p=>p.id===e.paragraphId);const quote=typeof e.quote==='string'?e.quote.trim():'';
    const fragments=quote.split(/(?:\.{3,}|…+)/u).map(equivalent).filter(Boolean);
    const matches=(candidate:Paragraph)=>{if(!quote)return false;if(candidate.text.includes(quote))return true;
      const base=equivalent(candidate.text);let end=0;
      return fragments.length>0&&fragments.every(fragment=>{const at=base.indexOf(fragment,end);if(at<0)return false;end=at+fragment.length;return true;});};
    if(!p||!matches(p)){const candidates=relocate&&equivalent(quote).length>=8?paragraphs.filter(matches):[];
      if(candidates.length!==1)throw new Error('Bằng chứng không khớp đoạn nguồn: '+e.paragraphId);p=candidates[0]!;}
    let exact=p.text.includes(quote)?quote:p.text;
    if(source&&key(p.text).includes(key(source))){hasSource=true;if(!key(exact).includes(key(source)))exact=p.text;}
    return {paragraphId:p.id,quote:exact};
  });
  if(!hasSource)throw new Error('Tên gọi không xuất hiện trong các đoạn dẫn chứng: '+source);
  return verified;
}
export function parseAnalysis(text: string, paragraphs: Paragraph[], chapterIds: string[], catalog=false, warn?: (message:string)=>void): AnalysisResult {
  const data=parseProtocolJson(text);
  if (catalog) {
    for (const name of ['integrity','garbage','newCharacters','aliasUpdates','relations','uncertain','resolutions']) {
      if (!Array.isArray(data[name])) (data as Record<string, unknown>)[name] = [];
    }
  } else {
    for (const name of ['integrity','garbage','newCharacters','aliasUpdates','relations','uncertain','resolutions']) {
      if (!Array.isArray(data[name])) {
        if (Array.isArray(data.integrity) && ['garbage','relations','uncertain','resolutions','scenes','aliasUpdates'].includes(name)) {
          (data as Record<string, unknown>)[name] = [];
        } else {
          throw new Error('Thiếu mảng '+name+' trong kết quả trinh sát.');
        }
      }
    }
  }
  const result=data as unknown as AnalysisResult;
  if(!catalog){if(result.integrity.length!==chapterIds.length||new Set(result.integrity.map(i=>i.chapterId)).size!==chapterIds.length)throw new Error('Thiếu hoặc trùng kết quả kiểm tra chương.');
    for(const id of chapterIds){const i=result.integrity.find(i=>i.chapterId===id);if(!i||!['ok','refetch'].includes(i.status))throw new Error('Trạng thái nguồn không hợp lệ: '+id);}}
  if(!catalog&&result.integrity.some(i=>i.status==='refetch'))return result;
  if(catalog){result.relations=[];result.uncertain=[];result.resolutions=[];result.scenes=[];}
  const checked=<T>(rows:T[],label:string,validate:(row:T)=>void)=>rows.filter(row=>{try{validate(row);return true;}catch(error){if(!warn)throw error;warn(`Bỏ bản ghi ${label} chưa xác minh: ${String(error)}`);return false;}});
  result.newCharacters=checked(result.newCharacters,'nhân vật',c=>{
    if(warn&&typeof c.vi==='string'&&/\p{Script=Han}/u.test(c.vi)&&typeof c.source==='string'&&/^\p{Script=Han}{2,12}$/u.test(c.source)){
      const reading=transcribeHanViet(tify(c.source))??transcribeHanViet(c.source);if(reading){c.vi=reading;warn('Dùng âm Hán Việt từ điển cho tên có bản trả lẫn chữ Hán: '+c.source);}}
    if(!/^N[1-9]\d*$/u.test(c.ref)||typeof c.source!=='string'||!c.source.trim()||isGenericNameForm(c.source)||typeof c.vi!=='string'||!c.vi.trim()||!['person','animal'].includes(c.kind)||/\p{Script=Han}/u.test(c.vi))throw Error('Bản ghi nhân vật mới không hợp lệ: '+c.source);
    try{c.evidence=verifyEvidence(c.evidence,paragraphs,c.source,Boolean(warn));}
    catch(error){const anchored=warn&&Array.isArray(c.evidence)?paragraphs.find(p=>c.evidence.some(e=>e.paragraphId===p.id)&&key(p.text).includes(key(c.source))):undefined;
      if(!anchored)throw error;warn!(`Khớp được tên ${c.source} tại ${anchored.id}; bỏ vai/giới tính chưa có dẫn chứng đúng.`);c.evidence=[{paragraphId:anchored.id,quote:anchored.text}];c.role='';c.gender='unknown';}
  });
  result.aliasUpdates=checked(result.aliasUpdates,'alias',a=>{if(!a.targetId||!a.source||isGenericNameForm(a.source)||!a.vi||!['name','short','address','nickname'].includes(a.kind)||/\p{Script=Han}/u.test(a.vi))throw Error('Alias không hợp lệ: '+a.source);a.evidence=verifyEvidence(a.evidence,paragraphs,a.source,Boolean(warn));});
  result.relations=checked(result.relations,'quan hệ',r=>{if(!r.fromId||!r.toId||r.fromId===r.toId||!r.fact||!Array.isArray(r.samples))throw Error('Quan hệ thiếu hướng/dữ kiện.');r.evidence=verifyEvidence(r.evidence,paragraphs,undefined,Boolean(warn));});
  result.uncertain=checked(result.uncertain,'chưa rõ danh tính',u=>{u.evidence=verifyEvidence(u.evidence,paragraphs,u.source,Boolean(warn));});
  if(result.scenes!==undefined){if(!Array.isArray(result.scenes))throw Error('Ghi chú cảnh không hợp lệ.');result.scenes=checked(result.scenes,'cảnh',scene=>{if(!paragraphs.some(p=>p.id===scene.paragraphId)||!scene.facts||!scene.speaker||!scene.listener)throw Error('Ghi chú cảnh thiếu người nói/nghe hoặc đoạn nguồn.');scene.evidence=verifyEvidence(scene.evidence,paragraphs,undefined,Boolean(warn));});}
  return result;
}
export function applyAnalysis(registry: Registry, analysis: AnalysisResult, warn?: (message:string)=>void): Registry {
  const next=structuredClone(registry),refs=new Map<string,string>();
  if(warn)next.relations=next.relations.filter(r=>relationNamesInEvidence(r,next));
  const checked=(fn:()=>void)=>{try{fn();}catch(error){if(!warn)throw error;warn(String(error));}};
  for(const c of analysis.newCharacters)checked(()=>{
    if(warn&&!refs.has(c.ref)){const existing=next.characters.filter(e=>key(e.source)===key(c.source)&&e.kind===c.kind);if(existing.length===1){refs.set(c.ref,existing[0]!.id);warn('Giữ mã và tên đã khóa cho '+c.source);return;}}
    if(refs.has(c.ref)||next.characters.some(e=>e.forms.some(f=>key(f.source)===key(c.source))))throw new Error('Tên đã tồn tại: phải trả aliasUpdates với targetId, không tạo nhân vật mới: '+c.source);
    const n=Math.max(0,...next.characters.map(e=>Number(e.id.slice(1))||0))+1,id='C'+String(n).padStart(5,'0');refs.set(c.ref,id);
    next.characters.push({id,source:c.source,vi:c.vi,kind:c.kind,gender:c.gender||'unknown',role:c.role||'',forms:[{id:'F01',source:c.source,vi:c.vi,kind:'name',evidence:c.evidence}]});});
  const resolve=(id:string)=>refs.get(id)||id;
  for(const a of analysis.aliasUpdates)checked(()=>{const e=next.characters.find(e=>e.id===resolve(a.targetId));if(!e)throw new Error('Alias trỏ tới mã không tồn tại: '+a.targetId);
    const existing=e.forms.find(f=>key(f.source)===key(a.source));if(existing){if(existing.vi.normalize('NFC').toLowerCase()!==a.vi.normalize('NFC').toLowerCase())throw new Error('Giữ bản dịch alias đã khóa: '+a.source);return;}
    // A speculative alias cannot steal another character's established canonical name.
    if(next.characters.some(other=>other.id!==e.id&&key(other.source)===key(a.source)))throw new Error('Alias đụng tên chính của nhân vật khác: '+a.source);
    e.forms.push({id:'F'+String(e.forms.length+1).padStart(2,'0'),source:a.source,vi:a.vi,kind:a.kind,evidence:a.evidence});});
  for(const r of analysis.relations)checked(()=>{const fromId=resolve(r.fromId),toId=resolve(r.toId);if(fromId===toId||!next.characters.some(e=>e.id===fromId)||!next.characters.some(e=>e.id===toId))throw new Error('Quan hệ tham chiếu mã nhân vật không tồn tại hoặc trùng hai đầu.');
    if(!relationNamesInEvidence({...r,fromId,toId},next))throw Error('Dẫn chứng không nhận diện đủ hai đầu quan hệ: '+r.fact);
    const samples=r.samples.map(s=>({...s,speakerId:resolve(s.speakerId),listenerId:resolve(s.listenerId)})).filter(s=>{const valid=[fromId,toId].includes(s.speakerId)&&[fromId,toId].includes(s.listenerId)&&s.speakerId!==s.listenerId;if(!valid){if(!warn)throw Error('Mẫu xưng hô sai người nói/người nghe.');warn('Bỏ mẫu xưng hô sai hướng, giữ dữ kiện quan hệ đã xác minh.');}return valid;});
    const found=next.relations.find(e=>e.fromId===fromId&&e.toId===toId&&e.fact===r.fact);
    if(found){found.samples=[...found.samples,...samples].filter((s,i,all)=>all.findIndex(x=>JSON.stringify(x)===JSON.stringify(s))===i);}else next.relations.push({...r,fromId,toId,samples});});
  next.unresolved=analysis.uncertain;return next;
}
function relationNamesInEvidence(relation:RelationFact,registry:Registry):boolean {
  // An empty evidence list is possible only for a user-supplied old memory row.
  if(!relation.evidence.length)return true;
  const quoted=relation.evidence.map(e=>key(e.quote));
  return [relation.fromId,relation.toId].every(id=>registry.characters.find(c=>c.id===id)?.forms.some(f=>quoted.some(q=>q.includes(key(f.source)))));
}
export function resolvedResolutions(analysis: AnalysisResult, registry: Registry, paragraphs?:Paragraph[]): AnalysisResult['resolutions'] {
  return analysis.resolutions.flatMap(r=>{const created=analysis.newCharacters.find(c=>c.ref===r.entityId);const entityId=created?registry.characters.find(c=>key(c.source)===key(created.source))?.id:r.entityId;
    if(!entityId||!registry.characters.some(c=>c.id===entityId))throw Error('Phân giải alias trỏ tới nhân vật không tồn tại: '+r.entityId);
    const p=paragraphs?.find(p=>p.id===r.paragraphId);const ranges=p?validatedGarbageRanges(p,analysis):[];
    if(ranges.some(g=>g.start<=r.start&&g.end>=r.end))return [];
    if(ranges.some(g=>g.start<r.end&&g.end>r.start))throw Error('Khoảng rác cắt ngang tên cần phân giải: '+r.paragraphId);
    const shift=ranges.filter(g=>g.end<=r.start).reduce((n,g)=>n+g.end-g.start,0);
    return [{...r,entityId,start:r.start-shift,end:r.end-shift}];});
}
function validatedGarbageRanges(p:Paragraph,analysis:AnalysisResult):AnalysisResult['garbage'] {
  const ranges=analysis.garbage.filter(g=>g.paragraphId===p.id).map(g=>({...g}));
  for(const g of ranges){if(/^\s*Chương\s+\d+/iu.test(p.text))throw Error('Không được xóa tiêu đề chương.');if(g.text&&p.text.slice(g.start,g.end)!==g.text){const start=p.text.indexOf(g.text);if(start>=0&&p.text.indexOf(g.text,start+1)<0){g.start=start;g.end=start+g.text.length;}}
    if(!Number.isSafeInteger(g.start)||!Number.isSafeInteger(g.end)||g.start<0||g.end<=g.start||g.end>p.text.length||p.text.slice(g.start,g.end)!==g.text||!g.reason)throw Error('Khoảng rác không khớp nguồn: '+p.id);}
  ranges.sort((a,b)=>a.start-b.start);let last=0;for(const g of ranges){if(g.start<last)throw Error('Khoảng rác chồng nhau: '+p.id);last=g.end;}return ranges;
}
export function removeVerifiedGarbage(paragraphs: Paragraph[], analysis: AnalysisResult): Paragraph[] {
  if(analysis.garbage.some(g=>!paragraphs.some(p=>p.id===g.paragraphId)))throw Error('Chỉ mục đoạn rác không có trong nguồn.');
  return paragraphs.flatMap(p=>{const ranges=validatedGarbageRanges(p,analysis);
    let text=p.text;for(const g of ranges.reverse())text=text.slice(0,g.start)+text.slice(g.end);return text.trim()?[{...p,text}]:[];});
}
export function encodeBatch(paragraphs: Paragraph[], registry: Registry, resolutions: AnalysisResult['resolutions']): EncodedBatch {
  const forms=registry.characters.flatMap(e=>e.forms.filter(f=>!isGenericNameForm(f.source)).map(f=>({e,f}))).sort((a,b)=>b.f.source.length-a.f.source.length),tokens: EncodedBatch['tokens']=[];
  const out=paragraphs.map(p=>{let text='',i=0;const normalized=sify(p.text.normalize('NFC'));if(normalized.length!==p.text.length)throw new Error('Nguồn không giữ chỉ số UTF-16 khi chuẩn hóa.');
    while(i<p.text.length){const matches=forms.filter(x=>normalized.startsWith(key(x.f.source),i));if(!matches.length){text+=p.text[i++];continue;}
      const length=matches[0]!.f.source.length,candidates=matches.filter(x=>x.f.source.length===length);let chosen=candidates[0]!;
      const r=resolutions.find(r=>r.paragraphId===p.id&&r.start===i&&r.end===i+length);
      const uncertain=(registry.unresolved as AnalysisResult['uncertain']).some(u=>key(u.source)===key(p.text.slice(i,i+length))&&u.evidence.some(e=>e.paragraphId===p.id));
      if(uncertain&&!r){text+=p.text.slice(i,i+length);i+=length;continue;}
      if(new Set(candidates.map(x=>x.e.id)).size>1){chosen=candidates.find(x=>x.e.id===r?.entityId)!;if(!chosen)throw new Error('Tên gọi mơ hồ chưa xác định được người: '+p.text.slice(i,i+length));}
      const token=`⟦${chosen.e.id}.${chosen.f.id}.${(tokens.length+1).toString(36).toUpperCase()}⟧`;tokens.push({token,entityId:chosen.e.id,formId:chosen.f.id,paragraphId:p.id,vi:chosen.f.vi});text+=token;i+=length;
    }return {...p,text};});return {paragraphs:out,tokens,registry,protectChapterHeaders:paragraphs.some(p=>Boolean(parseChapterHeaderLine(p.text)))};
}
export function decodeTranslation(response: string, batch: EncodedBatch): string {
  const data=parseProtocolJson(response);if(!Array.isArray(data.paragraphs))throw new Error('Thiếu danh sách đoạn dịch.');
  const items=data.paragraphs as Array<{id:string;text:string}>;
  if(items.length!==batch.paragraphs.length||new Set(items.map(x=>x.id)).size!==items.length)throw new Error('Thiếu/thừa/trùng đoạn dịch.');
  return batch.paragraphs.map(p=>decodeRow(p.id,items.find(x=>x.id===p.id)?.text,batch)).join('\n\n');
}
function decodeRow(id:string,value:unknown,batch:EncodedBatch):string {
  if(typeof value!=='string'||!value.trim())throw Error('Thiếu nội dung đoạn '+id);
  const expected=batch.tokens.filter(t=>t.paragraphId===id),actual=value.match(/⟦[^⟧]*⟧/gu)||[];
  if(actual.length!==expected.length||actual.some(t=>!expected.some(e=>e.token===t))||expected.some(t=>actual.filter(a=>a===t.token).length!==1))throw Error('Mã tên bị thiếu/thừa/đổi/di chuyển: '+id);
  let text=value;for(const t of expected)text=text.replace(t.token,t.vi);if(/[⟦⟧]/u.test(text))throw Error('Còn mã tên chưa giải mã: '+id);return text;
}

/** Read independent JSON rows. Only complete, uniquely identified rows may be staged. */
export function collectTranslationRows(response:string,batch:EncodedBatch,requireNoHan:boolean):{rows:Record<string,string>;issues:string[];repairs:RowRepair[]} {
  let items:Array<{id:string;text:string}>=[];
  const numericId=(id:string)=>{const m=/^CH(\d+)-P(\d+)$/u.exec(id);return m?`${Number(m[1])}:${Number(m[2])}`:undefined;};
  const markerRows=(text:string)=>[...text.matchAll(/§(CH\d+-P\d+)§[\t ]*([\s\S]*?)§\/§/gu)].map(m=>({id:m[1]!,text:m[2]!.trim()}));
  // Each closed labelled paragraph is independent of dialogue quotation marks.
  for(const match of response.matchAll(/(?:^|\n)[\t ]*§(CH\d+-P\d+)§[\t ]*([\s\S]*?)§\/§/gu))items.push({id:match[1]!,text:match[2]!.trim()});
  const add=(id:string,text:string)=>{const nested=markerRows(text);if(nested.length){if(nested.every(n=>numericId(n.id)===numericId(id)))items.push(...nested);return;}
    if(!text.includes('§CH'))items.push({id,text});};
  const visit=(value:unknown,depth=0):void=>{if(depth>4)return;if(Array.isArray(value)){value.forEach(v=>visit(v,depth+1));return;}if(!value||typeof value!=='object')return;
    const row=value as Record<string,unknown>,text=typeof row.text==='string'?row.text:typeof row.translation==='string'?row.translation:undefined;
    if(typeof row.id==='string'&&numericId(row.id)&&text!==undefined){add(row.id,text);return;}
    for(const field of ['paragraphs','segments'])if(Array.isArray(row[field]))visit(row[field],depth+1);
    for(const [id,text] of Object.entries(row))if(numericId(id)&&typeof text==='string')add(id,text);
  };
  if(!items.length)try{const fenced=response.match(/```(?:json)?\s*([\s\S]*?)```/iu);visit(JSON.parse((fenced?.[1]??response.replace(/^json\s*\n/iu,'')).trim()));}catch{/* old NDJSON or a cut response */}
  if(!items.length){for(const m of response.matchAll(/\{\s*"id"\s*:\s*"CH\d+-P\d+"\s*,\s*"(?:text|translation)"\s*:\s*"(?:[^"\\\x00-\x1f]|\\.)*"\s*\}/gu)){try{visit(JSON.parse(m[0]));}catch{/* incomplete row */}}}
  items=items.map(item=>{if(batch.paragraphs.some(p=>p.id===item.id))return item;
    const n=typeof item.id==='string'?numericId(item.id):undefined,matching=n?batch.paragraphs.filter(p=>numericId(p.id)===n):[];
    return matching.length===1?{...item,id:matching[0]!.id}:item;});
  const rows:Record<string,string>={},issues:string[]=[],repairs:RowRepair[]=[];
  for(const p of batch.paragraphs){const found=items.filter(x=>x?.id===p.id);
    if(found.length!==1){issues.push((found.length?'Trùng':'Thiếu')+' đoạn '+p.id);continue;}
    try{const text=decodeRow(p.id,found[0]!.text,batch);if(requireNoHan&&/\p{Script=Han}/u.test(text))throw Error('Còn chữ Hán: '+p.id);
      if(batch.protectChapterHeaders){const headers=(s:string)=>s.split(/\r?\n/u).flatMap(line=>{const h=parseChapterHeaderLine(line);return h?[h.chapterNumber]:[];});if(JSON.stringify(headers(p.text))!==JSON.stringify(headers(text)))throw Error('Tiêu đề chương sai trong đoạn: '+p.id);}
      rows[p.id]=found[0]!.text;}catch(e){issues.push(String(e));if(typeof found[0]?.text==='string')repairs.push({id:p.id,text:found[0].text,issue:String(e)});}}
  return {rows,issues,repairs};
}

const CONTRACT=`Chỉ trả một khối JSON hoàn chỉnh trong code fence json. Không dùng thẻ HTML vì trình đọc web có thể làm mất nội dung. Không dịch truyện trong bước PHÂN TÍCH.
Danh tính khác nhau phải có mã khác nhau. Không gộp người theo tên Việt giống nhau. Không suy giới tính chỉ từ tên.
Nếu người đã có trong registry và chỉ có tên gọi khác: chỉ trả aliasUpdates, targetId là đúng mã Cxxxxx đã có. Ví dụ registry C00017=柳如煙/Liễu Như Yên, nguồn có 小柳 và chứng minh đó là C00017: {"targetId":"C00017","source":"小柳","vi":"cháu Liễu","kind":"address","evidence":[{"paragraphId":"CH1-P0002","quote":"trích nguyên câu có 小柳"}]}. Không tạo nhân vật mới cho cháu Liễu.
Nếu dạng gọi đã có trong forms thì không trả lại. Bằng chứng alias cần cho thấy hai cách gọi chỉ cùng người qua lời giới thiệu, người nói/người nghe hoặc diễn biến; trùng họ không đủ. Chỉ lưu dạng gọi riêng có thể nhận diện một người. Đại từ và danh xưng chung như 他、她、哥哥、夫人、嬤嬤、大小姐 phải dịch theo cảnh, không khóa toàn truyện thành tên/alias của một người.
Đặc biệt 長公主、大長公主、公主、二老爺、三太太 chỉ là danh xưng chung, không làm alias toàn truyện. 寶慶長公主 và 臨安大長公主 có thể là hai người khác nhau; phải giữ nguyên phần tên riêng để đối chiếu. Danh xưng chung xác định theo cảnh bằng scenes, không tự thêm vào forms.
Nếu dạng gọi là họ kèm chức danh hoặc tên tắt, đối chiếu cả tên chính, forms, vai và người gọi. Nếu có bằng chứng chỉ cùng người, dùng aliasUpdates. Nếu không phân biệt được với một người đã có, dùng uncertain; không mở thêm mã chỉ vì cách viết khác.
Nếu người thực sự chưa có: trả newCharacters với ref=N1, source=tên nguồn nguyên văn, vi=tên chuẩn, kind=person hoặc animal, gender=male/female/unknown, role và evidence. Alias của người vừa tạo dùng targetId=N1. Tool sẽ cấp mã C, AI không tự cấp/đổi mã C.
Nếu chưa chắc một tên gọi riêng như cô Liễu/cháu Liễu chỉ người nào: trả uncertain với candidateIds và bằng chứng, không đoán hoặc tự gộp. Không đưa đại từ/danh xưng chung vào uncertain. Mỗi source/alias phải thật sự xuất hiện trong quote nguyên văn của paragraphId; không lấy động từ/danh từ chung vào tên. Danh xưng phải giữ sắc thái và dạng gọi, không ép mọi dạng thành tên đầy đủ.
Quan hệ là sự thật có hướng fromId/toId và evidence. samples ghi speakerId/listenerId/self/call/scene là mẫu ĐỀ XUẤT, không là luật khóa cứng. Thay đổi xưng hô khi cãi nhau không có nghĩa tự đổi quan hệ thành vợ chồng.
Để ghi quan hệ vào bộ nhớ, các quote phải xác định được cả hai đầu bằng tên/dạng gọi đã có và có căn cứ cho đúng quan hệ. Không lấy một câu về người thứ ba để chứng minh cha/mẹ/anh/em. Nếu chỉ đủ dữ kiện theo cảnh thì ghi scenes với mức độ chắc chắn, không nâng lên quan hệ cố định.
Schema đầy đủ (mọi mảng bắt buộc, rỗng thì []):
{"integrity":[{"chapterId":"CH1","status":"ok hoặc refetch","reason":"căn cứ"}],"garbage":[{"paragraphId":"CH1-P0002","start":0,"end":10,"text":"đúng chuỗi rác","reason":"vì sao chắc là rác"}],"newCharacters":[],"aliasUpdates":[],"relations":[],"uncertain":[],"resolutions":[]}
newCharacters=[{"ref":"N1","source":"柳如煙","vi":"Liễu Như Yên","kind":"person","gender":"female","role":"chưa rõ","evidence":[{"paragraphId":"...","quote":"..."}]}].
relations=[{"fromId":"C00001","toId":"C00002","fact":"A là anh của B","evidence":[{"paragraphId":"...","quote":"..."}],"samples":[{"speakerId":"C00002","listenerId":"C00001","self":"em","call":"anh","scene":"bình thường"}]}].
uncertain=[{"source":"...","candidateIds":["C00001","C00002"],"reason":"...","evidence":[{"paragraphId":"...","quote":"..."}]}].
resolutions=[{"paragraphId":"...","start":0,"end":2,"entityId":"C00001"}] dùng khi một dạng nguồn thuộc nhiều người, chỉ số theo nguyên đoạn UTF-16.
scenes (có thể bỏ qua)=[{"paragraphId":"đoạn thoại","speaker":"C00001 hoặc vai người nói","listener":"C00002 hoặc vai người nghe","facts":"dữ kiện cảnh, mức độ chắc chắn","suggestedAddress":"gợi ý linh hoạt","evidence":[{"paragraphId":"...","quote":"..."}]}]. Dùng cho cảnh cần xác định xưng hô, kể cả người chưa biết tên. Không lưu một danh xưng chung thành nhân vật mới.
Phải xem TOÀN BỘ mẻ, tìm cả nhân vật phụ/thú cưng chỉ xuất hiện một lần. Không tự thêm biến thể không có chứng cứ. Với evidence, ưu tiên một đoạn trích ngắn liền mạch 8–24 chữ, có tên nguồn, đúng dấu câu; không chèn dấu ba chấm. Nếu cần nối hai cách gọi, đưa hai dẫn chứng đúng đoạn.
`;
export function analysisPrompt(paragraphs: Paragraph[], registry: Registry, catalog=false): string {
  const relevantInParagraphs = (c: Registry['characters'][number]) =>
    paragraphs.some((p) => p.text.includes(c.source) || c.forms.some((f) => p.text.includes(f.source)));
  const presentedRegistry = catalog
    ? {
        characters: registry.characters
          .filter(relevantInParagraphs)
          .map((c) => ({
            id: c.id,
            source: c.source,
            vi: c.vi,
            kind: c.kind,
            gender: c.gender,
            role: c.role,
            forms: c.forms.map((f) => ({ id: f.id, source: f.source, vi: f.vi, kind: f.kind })),
          })),
        relations: [],
        unresolved: [],
      }
    : registry;
  return `[TDT_V3_ANALYSIS]\n${CONTRACT}\n${catalog?'Lượt lập bộ nhớ ban đầu chỉ thu tên và alias chắc chắn trong các đoạn trích rời. Chỉ điền newCharacters và aliasUpdates. integrity, garbage, relations, uncertain, resolutions và scenes để []. Không suy diễn quan hệ từ đoạn rời; quan hệ sẽ được lấy trong trinh sát từng mẻ. Mỗi mục dùng một dẫn chứng ngắn, role gọn.':'Kiểm tra từng chương: có bằng chứng thiếu trang, lẫn truyện, cắt giữa câu hoặc mất đoạn thì status=refetch, ghi căn cứ; không đánh dấu chỉ vì đổi cảnh hoặc chương kết mở. Chương bình thường phải trả ok. Nhận diện quảng cáo/lời tác giả/điều hướng rõ ràng, không xóa lời thoại hay tình tiết chỉ vì từ ngữ giống quảng cáo. Chỉ số start/end là UTF-16 trong đúng paragraph, text phải khớp tuyệt đối. Nếu không chắc rác thì không xóa. Chỉ thêm dữ kiện quan hệ mới có chứng cứ và hữu ích cho xưng hô; ghi chú riêng cảnh khó hiểu, không cần chép lại mọi lượt thoại.'}\nREGISTRY_ĐÃ_CÓ (giữ đúng mã và tên):\n${JSON.stringify(presentedRegistry)}\nĐOẠN_NGUỒN:\n${JSON.stringify(paragraphs)}`;
}
export function translationPrompt(batch: EncodedBatch, basePrompt: string): string {
  const ids=new Set(batch.tokens.map(t=>t.entityId));const relations=batch.registry.relations.filter(r=>(ids.has(r.fromId)||ids.has(r.toId))&&relationNamesInEvidence(r,batch.registry));
  for(const r of relations){ids.add(r.fromId);ids.add(r.toId);}const relevant=batch.registry.characters.filter(e=>ids.has(e.id));
  // The model needs the identity and scene, not the spelling it must NOT output.
  // Keep the full name registry at the tool and in scouting only.
  const names=new Map<string,Set<string>>();
  for(const c of batch.registry.characters){for(const name of c.forms.filter(f=>!isGenericNameForm(f.source)).flatMap(f=>[f.source,f.vi])){if(!name.trim())continue;const normalized=name.toLowerCase();const owners=names.get(normalized)??new Set<string>();owners.add(c.id);names.set(normalized,owners);}}
  const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  const substitutions=[...names.entries()].sort((a,b)=>b[0].length-a[0].length).map(([name,owners])=>({pattern:new RegExp(/\p{Script=Han}/u.test(name)?esc(name):`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`,'giu'),replacement:owners.size===1?[...owners][0]!:'người chưa rõ mã'}));
  const mask=(value:string)=>substitutions.reduce((s,x)=>s.replace(x.pattern,x.replacement),value||'');
  const identityHints=relevant.map(c=>({id:c.id,kind:c.kind,gender:c.gender,roleHint:mask(c.role),forms:c.forms.map(f=>({id:f.id,kind:f.kind}))}));
  const relationHints=relations.map(r=>({fromId:r.fromId,toId:r.toId,fact:mask(r.fact),samples:r.samples.map(s=>({...s,self:mask(s.self),call:mask(s.call),scene:mask(s.scene)}))}));
  const sceneHints=(batch.scenes??[]).map(s=>({paragraphId:s.paragraphId,speaker:mask(s.speaker),listener:mask(s.listener),facts:mask(s.facts),suggestedAddress:mask(s.suggestedAddress)}));
  const extraMemory=batch.extraMemory?'QUY TẮC RIÊNG VÀ THUẬT NGỮ ĐÃ LƯU: áp dụng từ vựng/quy tắc; narrationSuggestion chỉ gợi ý lời dẫn, không khóa cứng người nói–người nghe. Mọi mã tên vẫn giữ nguyên.\n'+mask(JSON.stringify(batch.extraMemory))+'\n':'';
  const format='Mỗi đoạn đúng định dạng §CH1-P0001§nội dung dịch§/§, thay CH1-P0001 bằng đúng id đoạn. Mỗi đoạn bắt đầu trên dòng mới, bắt buộc có dấu đóng §/§. Dấu ngoặc kép trong lời thoại viết bình thường; không dùng JSON, không thêm lời dẫn.';
  if(batch.repairs?.length&&batch.repairs.length===batch.paragraphs.length){
    const repairs=batch.repairs.map(r=>{const required=batch.tokens.filter(t=>t.paragraphId===r.id);const actual:string[]=r.text.match(/⟦[^⟧]*⟧/gu)||[];
      const source=batch.paragraphs.find(p=>p.id===r.id)!.text;
      const sourceClause=(token:string)=>{const at=source.indexOf(token);return (source.slice(0,at).match(/[^，,。；;！？!?\r\n]*$/u)?.[0]??'')+token+(source.slice(at+token.length).match(/^[^，,。；;！？!?\r\n]*/u)?.[0]??'');};
      return {...r,missingTokens:required.filter(t=>!actual.includes(t.token)).map(t=>t.token),unexpectedTokens:actual.filter(t=>!required.some(e=>e.token===t)),copyExactly:required.map(t=>({token:t.token,replaceLiteralName:t.vi,sourceClause:sourceClause(t.token)}))};});
    return `[TDT_V3_TRANSLATION]\nSỬA BẢN NHÁP THEO KIỂM TRA. ${format}\nChỉ sửa các đoạn được liệt kê. Giữ câu và nghĩa từ bản nháp đối chiếu nguồn; không dịch lại đoạn đã đúng. Trong từng dòng, thay tên thường tương ứng bằng ĐÚNG các mã copyExactly theo thứ tự xuất hiện trong nguồn. Nếu cùng tên xuất hiện hai lần, dùng đúng hai mã khác nhau; mỗi mã đúng một lần. Không giải mã, không giữ tên thường thay cho mã. sourceClause là vế nguồn chứa chính mã đó: dịch đủ vế này và giữ đúng người thực hiện/được so sánh. Mã thiếu do bỏ vế so sánh thì bổ sung đúng vế; không đổi mã ở vế kế tiếp để bù số lượng. Không lược tên thành đại từ dù văn cảnh vẫn hiểu được. Sửa mọi chữ Hán còn sót, hints chỉ là gợi ý cho tên riêng.\n${extraMemory}DỮ KIỆN NHÂN VẬT, QUAN HỆ VÀ CẢNH THAM KHẢO:\n${JSON.stringify({characters:identityHints,relations:relationHints,scenes:sceneHints})}\nXưng hô chỉ là gợi ý theo cảnh, KHÔNG KHÓA CỨNG; giữ đúng người nói, người nghe và chủ thể theo lời nguồn.\nBẢN NHÁP CẦN SỬA VÀ DANH SÁCH MÃ BẮT BUỘC:\n${JSON.stringify(repairs)}\nĐOẠN_NGUỒN_ĐÃ_MÃ_HÓA:\n${JSON.stringify(batch.paragraphs)}`;
  }
  const style=basePrompt.split(/\r?\n/u).filter(line=>!/^\s*(?:-\s*\*\*(?:Tên riêng|Tên 2 từ, tên thân mật & tên động vật):|7\.\s*Tên riêng đã được khóa)/iu.test(line)).join('\n').replace(/MỘT NHÂN VẬT = MỘT TÊN PHIÊN ÂM DUY NHẤT\.?/giu,'');
  const repairs=batch.repairs?.length?'SỬA ĐÚNG ĐOẠN CHƯA ĐẠT: đối chiếu nguyên văn, sửa phần lỗi, giữ nội dung và mã đúng; không để lại chữ Hán. hints chỉ là âm Hán Việt tham khảo cho tên, từ thường phải dịch nghĩa. Không trả lại bản lỗi.\n'+JSON.stringify(batch.repairs)+'\n':'';
  return `[TDT_V3_TRANSLATION]\nDịch văn học Trung–Việt đầy đủ, tự nhiên, đúng nghĩa. Chỉ làm nhiệm vụ DỊCH; không trinh sát, không xuất THUC_THE_MOI. Toàn bộ văn bản dịch phải là tiếng Việt, kể cả tên chưa có mã; không trộn Hán tự vào tên. Quy tắc mã tên ở đây ưu tiên hơn các quy tắc phiên âm trong hướng dẫn văn phong.\n${style}\nQUY TẮC ĐỊNH DẠNG ƯU TIÊN: ${format} Trả đúng mỗi id đoạn một lần, không gộp/bỏ đoạn, giữ tiêu đề và số chương.\nMọi token ⟦C...⟧ là một lần gọi tên đã xác nhận; giữ nguyên từng byte, đúng một lần trong ĐÚNG đoạn. Không tự dịch, sửa, xóa token hoặc thay bằng tên thường/đại từ. BẢO TOÀN NGUYÊN VẸN TỪNG KÝ TỰ VÀ DẤU THANH TIẾNG VIỆT (Ví dụ: 'Lục Thời Dã' TUYỆT ĐỐI KHÔNG được viết tắt hay rụng chữ thành 'Lục Thời D', 'Chu Húc' không tự ý đổi thành 'Châu'). CHỈ TRẢ TIẾNG VIỆT THUẦN TÚY, tuyệt đối không chèn từ tiếng Anh dẫn nhập (như 'Let\'s', 'Here is', 'Sure'). Tool sẽ giải mã sau. Mã form khác nhau của cùng C là các dạng gọi khác nhau của cùng một người. Không thêm token mới.\nBảng mã nhân vật để hiểu người đang được nhắc; tên dùng để điền được giữ ở tool. roleHint chỉ mô tả vai, không tự suy ra quan hệ gia đình từ đó:\n${JSON.stringify(identityHints)}\nDữ kiện quan hệ và mẫu xưng hô đã gặp:\n${JSON.stringify(relationHints)}\nCảnh cần lưu ý:\n${JSON.stringify(sceneHints)}\n${extraMemory}XƯNG HÔ LINH HOẠT: samples chỉ gợi ý theo cảnh trước, KHÔNG KHÓA CỨNG. Xác định người nói/người nghe từ lời nguồn và ngữ cảnh; có thể anh–em sang anh–tôi hoặc tao–mày khi phù hợp. Giữ đúng anh/em, cha/con, giới tính và quan hệ có bằng chứng; không đổi quan hệ chỉ vì đổi giọng. Giữ chủ thể đúng: mã đứng trước 母親/父親/大哥 là người có mẹ/bố/anh, không phải chính người thực hiện hành động của mẹ/bố/anh.\n${batch.nearby?.length?'ĐOẠN LIỀN KỀ ĐÃ ĐẠT, CHỈ ĐỂ HIỂU CẢNH, KHÔNG TRẢ LẠI:\n'+JSON.stringify(batch.nearby)+'\n':''}${repairs}ĐOẠN_NGUỒN_ĐÃ_MÃ_HÓA:\n${JSON.stringify(batch.paragraphs)}`;
}
