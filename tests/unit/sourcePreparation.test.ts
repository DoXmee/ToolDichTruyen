// @vitest-environment node
import { readFile } from 'node:fs/promises';
// @ts-expect-error jsdom is provided by the existing test environment.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { PlaywrightPageClient, classifyCloudflareChallenge } from '../../src/main/storySources/PlaywrightStoryPageClient';
import { adapterFor } from '../../src/main/storySources/adapters';
import { parseStoryUrl } from '../../src/main/storySources/urlRules';
import { cleanIxdzsStoryText, cleanXbanxiaStoryText, mergeTextParts, normalizeText } from '../../src/main/storySources/text';
import { stripCrawlerNoise } from '../../src/core/crawlerSanitizer';

const paragraphs = [
  '他推开门，沿着熟悉的小路走到院子里，仔细查看昨天留下的脚印。',
  '她问：“作者有话要说，是不是这一页的标题？”他把书放回桌上，没有删去任何一句话。',
  '他们读到了假太监权谋和立即入局这些字，但仍然继续自己的谈话，然后一起离开了院子。',
];
const prose = paragraphs.join('\n');
const body = paragraphs.map(p => `<p>${p}</p>`).join('');

async function browserSnapshot(url: string, container: string, heading = '<h1>第1章 测试</h1>') {
  const dom = new JSDOM(`<html><head><title>测试</title><link rel="canonical" href="${url}"></head><body>${heading}${container}</body></html>`, {url, runScripts:'outside-only'});
  const page = {
    on() {}, mainFrame: () => ({}), goto: async () => undefined,
    url: () => url, waitForFunction: async () => undefined,
    evaluate: async (fn: Function, arg: unknown) => dom.window.eval(`(${fn.toString()})(${JSON.stringify(arg)})`),
  };
  const guard = {assert: async () => undefined,clearNavigationFailure() {},takeNavigationFailure: () => undefined};
  const client = new PlaywrightPageClient({newPage:async () => page} as never, guard as never);
  return client.visit(url);
}

describe('prepared source boundary', () => {
  it.each([
    ['huliwang','https://m.huliwang.net/1703891/1.html',`<div id="nr">${body}<script>AD_JS</script></div>`,'<h1 id="nr_title">第1章 测试</h1>'],
    ['timotxt','https://www.timotxt.com/1509589610/13.html',`<div class="chapter-content"><div class="content">${body}<script>AD_JS</script></div></div>`],
    ['qingrenyouxi','https://www.qingrenyouxi.com/book/114551/33074751.html',`<div id="htmlContent">${body}<script>AD_JS</script></div>`],
    ['xbanxia','https://www.xbanxia.cc/books/143300/28251886.html',`<div id="nr1">${body}<script>AD_JS</script></div>`,'<h1 id="nr_title">第1章 测试</h1>'],
    ['xszj','https://xszj.org/b/485734/c/856451',`<div id="booktxt">${body}<div class="ad">AD_CONTENT</div></div>`],
    ['xszj','https://ixdzs8.com/read/646225/p1.html',`<article class="page-content"><h2>测试</h2><div class="chapter-meta">OTHER_AUTHOR</div><section>${body}</section><div id="cf-top-feed-box">OTHER_CHARACTERS</div></article>`],
    ['liehuozw','https://m.liehuozw.com/74/74628/5591191.html',`<div class="novelcontent">${body}<ul class="novelbutton"><li>下一章</li></ul><script>AD_JS</script></div>`],
    ['c6k6','https://m.c6k6.com/1/1064/338151.html',`<div class="novelcontent">${body}<script>AD_JS</script></div>`],
    ['czbooks','https://czbooks.net/n/cr3e38/crd0k',`<div class="chapter-detail"><div class="content">${body}<script>AD_JS</script></div></div>`],
    ['uaa002','https://www.uaa.com/novel/chapter?id=1100866346280947712',`<div class="reader-content">${body}<script>AD_JS</script></div>`],
    ['novel543','https://www.novel543.com/1013669909/8096_1.html',`<div class="chapter-content"><div class="content">${body}<script>AD_JS</script></div></div>`],
  ])('preserves prose through snapshot and adapter for %s (%s)', async (site,url,container,heading?: string) => {
    const snapshot = await browserSnapshot(url!,container!,heading);
    const parsed = parseStoryUrl(url!);
    const chapter = {id:'fixture',order:0,title:'测试',numberLabel:'第1章',url:url!,partUrls:[url!],isIntroduction:false,selectedByDefault:true};
    const analysis = {analysisId:'fixture',site,inputKind:'chapter',bookId:parsed.bookId,bookTitle:'测试',chapters:[chapter]};
    const visit = async () => snapshot;
    const result = await adapterFor(parsed.site).fetch(analysis as never,chapter,{client:{visit},visit,signal:new AbortController().signal,reportCatalogProgress(){},maxCatalogPages:2,maxChapterPages:5,decoders:[]});
    expect(result.sourceText).toBe(prose);
    expect(result.sourcePreparation?.sha256).toMatch(/^[a-f\d]{64}$/);
    expect(result.sourcePreparation?.version).toBe('source-v1');
    expect(stripCrawlerNoise(result.sourceText)).toBe(result.sourceText);
  });

  it('keeps quoted author-note and advert keywords, question lines and repeated prose', () => {
    expect(cleanIxdzsStoryText(prose)).toBe(prose);
    expect(cleanIxdzsStoryText(prose+'\n??今天你要去哪儿？')).toBe(prose+'\n??今天你要去哪儿？');
    expect(cleanXbanxiaStoryText(prose+'\npsychology 是他正在看的书名。')).toBe(prose+'\npsychology 是他正在看的书名。');
    const part='她又一次望着同一扇窗户，想起了许多年前的事情。';
    expect(mergeTextParts([part+'\n'+prose,part]).text).toBe(part+'\n'+prose+'\n\n'+part);
    expect(normalizeText(prose+'\n她说：“点击下一页继续，只是书上的一句话。”\n他们继续走。')).toContain('他们继续走。');
  });

  it('removes only a bounded advertisement and keeps prose following its closing line', () => {
    const ad='🔥 读完本章的人还在玩 · 真人互动多结局爽剧\nOTHER_CHARACTER\n免下载秒玩\n立即入局 ▸\n⚡ 游戏操作';
    const raw=prose+'\n'+ad+'\n'+paragraphs[0];
    const clean=stripCrawlerNoise(raw);
    expect(clean).toContain(prose);
    expect(clean.endsWith(paragraphs[0]!)).toBe(true);
    expect(clean).not.toContain('OTHER_CHARACTER');
    expect(stripCrawlerNoise(clean)).toBe(clean);
  });

  it.each(['Chờ một chút...','Just a moment...','请稍候'])('recognizes localized challenge %s without misclassifying real prose', (title) => {
    const input={title,bodyText:'Thực hiện xác minh bảo mật Cloudflare',hasVisibleChallengeControl:false,hasStorySurface:false};
    expect(classifyCloudflareChallenge(input)).toBe('passive');
    expect(classifyCloudflareChallenge({...input,hasStorySurface:true})).toBe('none');
    expect(classifyCloudflareChallenge({...input,title:'未知',bodyText:'',hasChallengeDocument:true})).toBe('passive');
    expect(classifyCloudflareChallenge({...input,hasStorySurface:true,hasChallengeDocument:true})).toBe('passive');
  });

  it('takes every declared XSZJ page and rejects an absent successor', async () => {
    const first='https://xszj.org/b/485734/c/856451';
    const second=first+'?page=2';
    const one=await browserSnapshot(first,`<div id="booktxt">${body}</div><a href="?page=2">下一页</a>`,'<h1>第1章 测试 (1/2)</h1>');
    const two=await browserSnapshot(second,`<div id="booktxt">${body}</div>`,'<h1>第1章 测试 (2/2)</h1>');
    const chapter={id:'pages',order:0,title:'测试',number:1,numberLabel:'第1章',url:first,partUrls:[first],isIntroduction:false,selectedByDefault:true};
    const analysis={analysisId:'pages',site:'xszj',bookId:'485734',chapters:[chapter]};
    const visits:string[]=[];
    const visit=async (url:string)=>{visits.push(url);return url===first?one:two;};
    const runtime={client:{visit},visit,signal:new AbortController().signal,reportCatalogProgress(){},maxCatalogPages:2,maxChapterPages:5,decoders:[]};
    const result=await adapterFor('xszj').fetch(analysis as never,chapter,runtime);
    expect(visits).toEqual([first,second]);
    expect(result.mergedPartCount).toBe(2);
    one.links=[];
    await expect(adapterFor('xszj').fetch(analysis as never,chapter,runtime)).rejects.toMatchObject({code:'SOURCE_CHANGED'});
  });

  it('rejects an unrelated whole-page fallback when the verified C6K6 reader is missing', async () => {
    const url='https://m.c6k6.com/1/1064/338151.html';
    const snapshot=await browserSnapshot(url,`<main>${body}</main>`);
    const chapter={id:'missing',order:0,title:'测试',numberLabel:'第1章',url,partUrls:[url],isIntroduction:false,selectedByDefault:true};
    const visit=async()=>snapshot;
    await expect(adapterFor('c6k6').fetch({site:'c6k6',bookId:'1064'} as never,chapter,{client:{visit},visit,signal:new AbortController().signal,reportCatalogProgress(){},maxCatalogPages:1,maxChapterPages:2,decoders:[]})).rejects.toMatchObject({code:'SOURCE_CHANGED'});
  });

  it('reuses a verified Huli redirect alias without accepting another chapter', async () => {
    const protocol=await import(new URL('../../resources/huli-browser-helper/lib/protocol.js',import.meta.url).href);
    const original='https://m.huliwang.net/1703891/50.html';
    const redirected='https://m.ihuliwang.com/1703891/50.html';
    expect(protocol.huliPageIdentity(original)).toBe(protocol.huliPageIdentity(redirected));
    expect(protocol.pairedTabAction(redirected,original).type).toBe('reuse');
    expect(protocol.huliPageIdentity(original)).not.toBe(protocol.huliPageIdentity('https://m.ihuliwang.com/1703891/51.html'));
  });

  it.each([
    ['huli-content.js','https://m.ihuliwang.com/1703891/50.html'],
    ['xszj-content.js','https://xszj.org/b/485734/c/856451'],
    ['timotxt-content.js','https://www.timotxt.com/1509589610/13.html'],
    ['novel543-content.js','https://www.novel543.com/1013669909/8096_1.html'],
  ])('helper %s reports a localized challenge without pretending HTTP 200', async (file,url) => {
    const dom=new JSDOM('<html><head><title>Chờ một chút...</title></head><body><div id="challenge-stage">Thực hiện xác minh bảo mật</div></body></html>',{url,runScripts:'outside-only'});
    let listener: any;
    Object.defineProperty(dom.window,'TextEncoder',{value:TextEncoder});
    Object.defineProperty(dom.window,'chrome',{value:{runtime:{connect:()=>({onDisconnect:{addListener(){}}}),onMessage:{addListener(fn:any){listener=fn;}}}}});
    dom.window.eval(await readFile('resources/huli-browser-helper/'+file,'utf8'));
    const response:any=await new Promise(resolve=>listener({type:'collect-snapshot',requestedUrl:url},{},resolve));
    expect(response.ok).toBe(true);
    expect(response.snapshot.challenge).toBe('passive');
    expect(response.snapshot.status).toBeUndefined();
  });
});
