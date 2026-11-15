import { describe,expect,it } from 'vitest';
import { applyAnalysis,collectTranslationRows,decodeTranslation,emptyRegistry,encodeBatch,groupChapterChunks,groupAdaptiveChapterChunks,isGenericNameForm,paragraphsFor,parseAnalysis,parseProtocolJson,analysisPrompt,removeVerifiedGarbage,resolvedResolutions,translationPrompt,verifyEvidence,type AnalysisResult } from '../../src/core/translationPipelineV3';
const paragraphs=paragraphsFor([{id:'CH1',number:1,title:'Chương 1',text:'Chương 1\n柳如煙走來。如煙說：「小柳就是我。」\n柳如煙看著小柳。'}]);
const evidence=[{paragraphId:'CH1-P0002',quote:'柳如煙走來。如煙說：「小柳就是我。」'}];
const result=():AnalysisResult=>({integrity:[{chapterId:'CH1',status:'ok',reason:''}],garbage:[],newCharacters:[{ref:'N1',source:'柳如煙',vi:'Liễu Như Yên',kind:'person',gender:'female',role:'',evidence}],aliasUpdates:[{targetId:'N1',source:'如煙',vi:'Như Yên',kind:'short',evidence},{targetId:'N1',source:'小柳',vi:'cháu Liễu',kind:'address',evidence}],relations:[],uncertain:[],resolutions:[]});
const registry=()=>applyAnalysis(emptyRegistry(),result());
describe('V3 identity and output contracts',()=>{
 it('assigns one stable identity to full name, short name and addressed name',()=>{const r=registry();expect(r.characters).toHaveLength(1);expect(r.characters[0]?.id).toBe('C00001');expect(r.characters[0]?.forms.map(f=>f.vi)).toEqual(['Liễu Như Yên','Như Yên','cháu Liễu']);const batch=encodeBatch(paragraphs,r,[]);expect(batch.tokens).toHaveLength(5);const response=JSON.stringify({paragraphs:batch.paragraphs.map(p=>({id:p.id,text:p.text}))});const text=decodeTranslation(response,batch);expect(text).toContain('Liễu Như Yên走來');expect(text).toContain('Như Yên說：「cháu Liễu');expect(text).not.toMatch(/[⟦⟧]/u);});
 it('adds an alias to existing C id and does not create a second character',()=>{const r=registry(),a=result();a.newCharacters=[];a.aliasUpdates=[{targetId:'C00001',source:'小柳',vi:'cháu Liễu',kind:'address',evidence}];expect(applyAnalysis(r,a).characters).toHaveLength(1);});
 it('rejects unknown alias ids and duplicate existing identities',()=>{const a=result();a.aliasUpdates[0]!.targetId='C99999';expect(()=>applyAnalysis(emptyRegistry(),a)).toThrow('không tồn tại');expect(()=>applyAnalysis(registry(),result())).toThrow('đã tồn tại');});
 it('never merges distinct people on the basis of equal Vietnamese names',()=>{const a=result();a.aliasUpdates=[];a.newCharacters.push({...a.newCharacters[0]!,ref:'N2',source:'柳茹煙'});expect(applyAnalysis(emptyRegistry(),a).characters).toHaveLength(2);});
 it('requires a resolution when two people share the same address form',()=>{const r=registry();r.characters.push({id:'C00002',source:'柳青',vi:'Liễu Thanh',kind:'person',gender:'unknown',role:'',forms:[{id:'F01',source:'小柳',vi:'Tiểu Liễu',kind:'address'}]});expect(()=>encodeBatch(paragraphs,r,[])).toThrow('mơ hồ');});
 it('never encodes a generic rank title inside the distinct proper title of another person',()=>{const r=registry();r.characters.push({id:'C00002',source:'寶慶長公主',vi:'Bảo Khánh Trưởng công chúa',kind:'person',gender:'female',role:'',forms:[{id:'F01',source:'寶慶長公主',vi:'Bảo Khánh Trưởng công chúa',kind:'name'},{id:'F02',source:'長公主',vi:'Bảo Khánh Trưởng công chúa',kind:'address'}]});const p=[{id:'CH18-P0065',chapterId:'CH18',text:'臨安大長公主和寶慶長公主說話。'}];const b=encodeBatch(p,r,[]);expect(b.tokens).toHaveLength(1);expect(b.paragraphs[0]?.text).toContain('臨安大長公主');expect(b.tokens[0]?.formId).toBe('F01');});
 it('keeps bare kinship terms contextual instead of globally locking them as names',()=>{for(const source of ['大伯母','母親','外祖母','四哥哥','表姐','阿爹','夫君'])expect(isGenericNameForm(source),source).toBe(true);for(const source of ['柳如煙','小柳','王嬤嬤','陳家大公子','阿珠','珂表姐'])expect(isGenericNameForm(source),source).toBe(false);const r=registry();r.characters.push({id:'C00002',source:'大伯母',vi:'đại bá mẫu',kind:'person',gender:'female',role:'',forms:[{id:'F01',source:'大伯母',vi:'đại bá mẫu',kind:'address'}]});const b=encodeBatch([{id:'CH19-P0034',chapterId:'CH19',text:'大伯母和柳如煙說話。'}],r,[]);expect(b.tokens).toHaveLength(1);expect(b.paragraphs[0]?.text).toContain('大伯母');});
 it('cannot use an alias to hijack another canonical name',()=>{const r=registry();r.characters.push({id:'C00002',source:'柳青',vi:'Liễu Thanh',kind:'person',gender:'unknown',role:'',forms:[{id:'F01',source:'柳青',vi:'Liễu Thanh',kind:'name'}]});const a=result();a.newCharacters=[];a.aliasUpdates=[{targetId:'C00002',source:'柳如煙',vi:'Liễu Như Yên',kind:'short',evidence}];expect(()=>applyAnalysis(r,a)).toThrow('tên chính');});
 it('rejects missing, duplicated, invented or moved name occurrence tokens',()=>{const b=encodeBatch(paragraphs,registry(),[]),p=b.paragraphs;const send=(items:unknown[])=>JSON.stringify({paragraphs:items});const items=p.map(x=>({id:x.id,text:x.text}));expect(()=>decodeTranslation(send(items.map((x,i)=>i===1?{...x,text:x.text.replace(b.tokens[0]!.token,'')}:x)),b)).toThrow('Mã tên');expect(()=>decodeTranslation(send(items.map((x,i)=>i===1?{...x,text:x.text+b.tokens[0]!.token}:x)),b)).toThrow('Mã tên');});
 it('detects omission of a paragraph even when it contains no name',()=>{const b=encodeBatch([...paragraphs,{id:'CH1-P9999',chapterId:'CH1',text:'風在吹。'}],registry(),[]);expect(()=>decodeTranslation(JSON.stringify({paragraphs:b.paragraphs.slice(0,-1).map(p=>({id:p.id,text:p.text}))}),b)).toThrow('đoạn');});
 it('does not accept incomplete JSON or invalid evidence',()=>{expect(()=>parseAnalysis('```json\n{',paragraphs,['CH1'])).toThrow('JSON');const a=result();a.newCharacters[0]!.evidence=[{paragraphId:'CH1-P0002',quote:'not in source'}];expect(()=>parseAnalysis(JSON.stringify(a),paragraphs,['CH1'])).toThrow('Bằng chứng');});
 it('anchors equivalent punctuation and a short context quote to the actual named source paragraph',()=>{const p=[{id:'CH1-P0002',chapterId:'CH1',text:'王嬤嬤低聲道:“我去問問?”'}];expect(verifyEvidence([{paragraphId:p[0]!.id,quote:'低聲道：“我去問問？”'}],p,'王嬤嬤')).toEqual([{paragraphId:p[0]!.id,quote:p[0]!.text}]);expect(()=>verifyEvidence([{paragraphId:p[0]!.id,quote:'低聲道：“我去打聽？”'}],p,'王嬤嬤')).toThrow('Bằng chứng');});
 it('stages only complete rows from a cut reply, including name-free paragraphs',()=>{const b=encodeBatch(paragraphs,registry(),[]);const rows=b.paragraphs.map(p=>JSON.stringify({id:p.id,text:p.text.replace(/[\p{Script=Han}]+/gu,'tiếng Việt')}));const result=collectTranslationRows(rows.slice(0,2).join('\n')+'\n'+rows[2]!.slice(0,-3),b,true);expect(Object.keys(result.rows)).toEqual(['CH1-P0001','CH1-P0002']);expect(result.issues).toEqual(['Thiếu đoạn CH1-P0003']);});
 it('reads dialogue quotes without JSON escaping and rejects a cut labelled paragraph',()=>{const b=encodeBatch(paragraphs,registry(),[]);const reply=b.paragraphs.map((p,i)=>`§${p.id}§${i===0?'Chương 1':(b.tokens.filter(t=>t.paragraphId===p.id).map(t=>t.token).join(' ')+' nói: "Đi thôi!"')}§/§`).join('\n');expect(collectTranslationRows(reply,b,true).issues).toEqual([]);const cut=collectTranslationRows(reply.slice(0,-3),b,true);expect(Object.keys(cut.rows)).toHaveLength(2);expect(cut.issues).toEqual(['Thiếu đoạn CH1-P0003']);});
 it('normalizes only leading zeroes in paragraph labels and still checks exact name tokens',()=>{const b=encodeBatch(paragraphs,registry(),[]);const reply=b.paragraphs.map(p=>`§${p.id.replace('-P','-P0')}§${p.text.replace(/\p{Script=Han}+/gu,'đi')}§/§`).join('\n');expect(collectTranslationRows(reply,b,true).issues).toEqual([]);expect(collectTranslationRows(reply.replace(b.tokens[0]!.token,''),b,true).issues.join(' ')).toContain('Mã tên');});
 it('reads identified JSON arrays, translation fields and labelled rows nested in JSON without guessing ids',()=>{const b=encodeBatch(paragraphs,registry(),[]),rows=b.paragraphs.map(p=>({id:p.id,translation:p.text.replace(/\p{Script=Han}+/gu,'đi')}));for(const response of [JSON.stringify(rows),JSON.stringify({segments:rows.map(r=>({...r,translation:`§${r.id}§${r.translation}§/§`}))}),JSON.stringify(Object.fromEntries(rows.map(r=>[r.id,`§${r.id}§${r.translation}§/§`])))] )expect(collectTranslationRows(response,b,true).issues).toEqual([]);const broken=rows.map((r,i)=>i===1?{id5:r.id,translation:r.translation}:r);expect(collectTranslationRows(JSON.stringify(broken),b,true).issues).toContain('Thiếu đoạn CH1-P0002');});
 it('does not delete text for nonmatching or overlapping junk ranges',()=>{const a=result();a.garbage=[{paragraphId:'CH1-P0002',start:0,end:2,text:'廣告',reason:'ad'}];expect(()=>removeVerifiedGarbage(paragraphs,a)).toThrow('không khớp');});
 it('adjusts a shared-name resolution after deleting a verified ad before that occurrence',()=>{const r=registry();r.characters.push({id:'C00002',source:'柳青',vi:'Liễu Thanh',kind:'person',gender:'unknown',role:'',forms:[{id:'F01',source:'小柳',vi:'Tiểu Liễu',kind:'address'}]});const p=[{id:'CH1-P9999',chapterId:'CH1',text:'廣告小柳來。'}],a=result();a.newCharacters=[];a.garbage=[{paragraphId:p[0]!.id,start:0,end:2,text:'廣告',reason:'ad'}];a.resolutions=[{paragraphId:p[0]!.id,start:2,end:4,entityId:'C00001'}];const b=encodeBatch(removeVerifiedGarbage(p,a),r,resolvedResolutions(a,r,p));expect(b.tokens).toHaveLength(1);expect(b.tokens[0]?.entityId).toBe('C00001');});
 it('retains dynamic address suggestions and does not prescribe fixed self/call',()=>{const b=encodeBatch(paragraphs,registry(),[]),prompt=translationPrompt(b,'Văn phong thuần Việt');expect(prompt).toContain('KHÔNG KHÓA CỨNG');expect(prompt).toContain('không xuất THUC_THE_MOI');});
 it('provides identity and scene hints to translation without offering names to substitute for codes',()=>{const r=registry();r.characters[0]!.role='Liễu Như Yên là chủ quán.';const b=encodeBatch(paragraphs,r,[]),prompt=translationPrompt(b,'Dịch tự nhiên.');expect(prompt).toContain('C00001 là chủ quán');expect(prompt).toContain('female');expect(prompt).not.toContain('Liễu Như Yên');expect(prompt).not.toContain('柳如煙');expect(prompt).toContain(b.tokens[0]!.token);});
 it('preserves the good parts of a draft while listing every literal name to recode on retry',()=>{const b=encodeBatch(paragraphs,registry(),[]);const p=b.paragraphs[1]!;const prompt=translationPrompt({...b,paragraphs:[p],repairs:[{id:p.id,text:'Liễu Như Yên đến chợ.',issue:'Mã tên bị thiếu'}]},'- **Tên riêng:** Phiên âm Hán Việt chuẩn.');expect(prompt).not.toContain('Phiên âm Hán Việt chuẩn');expect(prompt).toContain('copyExactly');expect(prompt).toContain(b.tokens[0]!.token);expect(prompt).toContain('Liễu Như Yên đến chợ.');});
 it('anchors a missing repeated name to its own comparison clause instead of shifting the next code',()=>{const b=encodeBatch([{id:'CH17-P0046',chapterId:'CH17',text:'柳如煙沒有小柳白，臉要比如煙方正一些，柳如煙的眉毛很濃。'}],registry(),[]);const p=b.paragraphs[0]!,missing=b.tokens[2]!;const prompt=translationPrompt({...b,repairs:[{id:p.id,text:b.tokens.filter(t=>t!==missing).map(t=>t.token).join(' ')+' đi đến chợ.',issue:'Mã thiếu'}]},'');const rows=JSON.parse(prompt.split('BẢN NHÁP CẦN SỬA VÀ DANH SÁCH MÃ BẮT BUỘC:\n')[1]!.split('\nĐOẠN_NGUỒN_ĐÃ_MÃ_HÓA:')[0]!);expect(rows[0].missingTokens).toEqual([missing.token]);expect(rows[0].copyExactly[2].sourceClause).toBe('臉要比'+missing.token+'方正一些');expect(prompt).toContain('không đổi mã ở vế kế tiếp');expect(prompt).toContain('QUAN HỆ VÀ CẢNH');expect(prompt).toContain('KHÔNG KHÓA CỨNG');});
 it('does not keep a relation if the cited excerpt only identifies one participant',()=>{const a=result();a.newCharacters.push({...a.newCharacters[0]!,ref:'N2',source:'柳青'});a.relations=[{fromId:'N1',toId:'N2',fact:'Liễu Như Yên là mẹ của Liễu Thanh',evidence,samples:[]}];const warnings:string[]=[];const r=applyAnalysis(emptyRegistry(),a,m=>warnings.push(m));expect(r.relations).toEqual([]);expect(warnings.join(' ')).toContain('không nhận diện đủ hai đầu');});
 it('groups both modes into selected one/two/three whole chapters and adaptively batches without cutting chapters',()=>{const source=Array.from({length:20},(_,i)=>`Chương ${i+1}\n${'柳如煙走來。'.repeat(20)}`).join('\n\n');expect(groupChapterChunks(source,1)).toHaveLength(20);expect(groupChapterChunks(source,2)).toHaveLength(10);expect(groupChapterChunks(source,3)).toHaveLength(7);expect(()=>groupChapterChunks(source,0)).toThrow();expect(()=>groupChapterChunks(source,4)).toThrow();
  // Test adaptive batching (whole chapters only)
  const adaptiveChunks = groupAdaptiveChapterChunks(source, { executionMode: 'web', maxBatchChars: 500 });
  for (const chunk of adaptiveChunks) {
    expect(chunk.text).toMatch(/^Chương \d+/u);
    expect(chunk.chapterCount).toBeGreaterThanOrEqual(1);
    expect(chunk.chapterCount).toBeLessThanOrEqual(3);
  }
});
  it('robustly parses unclosed fences, conversational preambles, and repaired JSON', () => {
    // Unclosed code fence
    expect(parseProtocolJson('```json\n{"integrity": []}\n')).toEqual({ integrity: [] });
    // Conversational preamble + postscript without fence
    expect(parseProtocolJson('Dưới đây là kết quả:\n{"integrity": []}\nHy vọng giúp ích.')).toEqual({ integrity: [] });
    // Trailing comma
    expect(parseProtocolJson('{"integrity": [],\n"newCharacters": [{"ref": "N1", "source": "A",},],}')).toEqual({
      integrity: [],
      newCharacters: [{ ref: 'N1', source: 'A' }],
    });
    // Truncated array
    expect(parseProtocolJson('```json\n{"newCharacters": [{"ref": "N1", "source": "A"}, {"ref": "N2"')).toEqual({
      newCharacters: [{ ref: 'N1', source: 'A' }],
    });
  });
  it('lightens catalog analysis prompt by omitting heavy evidence quotes and irrelevant characters from registry', () => {
    const reg = registry();
    // Add unique historical evidence quote to existing character
    reg.characters[0]!.forms[0]!.evidence = [{ paragraphId: 'CH99-P9999', quote: 'bằng chứng lịch sử cũ không cần gửi' }];
    // Add an irrelevant character not in paragraphs
    reg.characters.push({
      id: 'C00099',
      source: '无名小卒',
      vi: 'Vô Danh Tiểu Tốt',
      kind: 'person',
      gender: 'male',
      role: 'người qua đường',
      forms: [{ id: 'F01', source: '无名小卒', vi: 'Vô Danh Tiểu Tốt', kind: 'name', evidence: [] }],
    });
    const prompt = analysisPrompt(paragraphs, reg, true);
    expect(prompt).toContain('Liễu Như Yên');
    expect(prompt).not.toContain('bằng chứng lịch sử cũ không cần gửi');
    expect(prompt).not.toContain('CH99-P9999');
    expect(prompt).not.toContain('无名小卒');
  });
  it('parses catalog analysis result even if trailing arrays are omitted due to cut-off', () => {
    const cutText = '{"newCharacters": [{"ref": "N1", "source": "柳如煙", "vi": "Liễu Như Yên", "kind": "person", "gender": "female", "role": "chưa rõ", "evidence": [{"paragraphId": "CH1-P0002", "quote": "柳如煙走來。"}]}]}';
    const parsed = parseAnalysis(cutText, paragraphs, ['CH1'], true);
    expect(parsed.newCharacters).toHaveLength(1);
    expect(parsed.integrity).toEqual([]);
    expect(parsed.relations).toEqual([]);
    expect(parsed.aliasUpdates).toEqual([]);
  });
});
