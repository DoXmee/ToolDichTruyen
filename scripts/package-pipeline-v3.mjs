// Preserve the installed API UI/adapters. Add the shared V3 controller and
// only the explicit bootstrap, IPC, legacy-memory and batch/provenance seams.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import esbuild from '../node_modules/.pnpm/node_modules/esbuild/lib/main.js';
const require=createRequire(import.meta.url),asar=require('../node_modules/.pnpm/node_modules/@electron/asar/lib/asar.js'),parser=require('../node_modules/.pnpm/node_modules/@babel/parser'),traverse=require('../node_modules/.pnpm/node_modules/@babel/traverse').default;
const root=path.resolve('scratch/pipeline-v3-20261111'),stage=path.join(root,'app'),baseline=path.join(root,'baseline.asar'),info=JSON.parse(await fs.readFile(path.join(root,'baseline.json'),'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
if(hash(await fs.readFile(baseline))!==info.archiveHash)throw Error('Baseline changed');asar.extractAll(baseline,stage);
await esbuild.build({entryPoints:['src/main/translation/TranslationPipelineV3.ts'],outfile:path.join(stage,'out/main/translation-v3.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22'});
await esbuild.build({entryPoints:['src/main/storySources/StorySourceService.ts'],outfile:path.join(stage,'out/main/story-source-step1.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['playwright-core']});
const parse=s=>parser.parse(s,{sourceType:'module'}),mainFile=path.join(stage,'out/main/index.js');let main=await fs.readFile(mainFile,'utf8');const edits=[];
const replace=(source,a,b)=>{if(source.split(a).length!==2)throw Error('Expected unique anchor '+a.slice(0,90));return source.replace(a,b);};
main=replace(main,'translator = new TranslationJobRunner({ chatGpt, geminiApi, persistence });','translator = new TranslationJobRunner({ chatGpt, geminiApi, persistence });');
main=replace(main,'  const gemini = new GeminiTitleService({','  pipelineV3.installTranslationPipelineV3(translator, { refetchRaw: (chapter, signal) => storySources.refetchRawChapter(chapter, signal) });\n  const gemini = new GeminiTitleService({');
main=replace(main,'return dependencies.translator.start({','return dependencies.translator.start({\n      ...pipelineV3.readPipelineOptions(payload),');
main=replace(main,'const keys = (settings.geminiApiKeysPlain || []).filter((k) => !k.startsWith("AQ.Ab8"));','let keys = (settings.geminiApiKeysPlain || []).map((k) => k.trim()).filter((k) => k.length > 5);\n    if (keys.length === 0 && settings.geminiApiKeyEncrypted && this.safeStorage.isEncryptionAvailable()) {\n      try {\n        const decrypted = this.safeStorage.decryptString(Buffer.from(settings.geminiApiKeyEncrypted, "base64")).trim();\n        if (decrypted.length > 5) keys = [decrypted];\n      } catch {}\n    }');
main=replace(main,'const terminalPunctuationPattern = /[.!?。！？…»”"’\'」』)\\]}⟧:：—–~～]\\s*$/u;','const terminalPunctuationPattern = /[.!?。！？…»”"’\'」』)\\]}⟧】〗〕》〉）］｝›>＞:：—–~～]\\s*$/u;');
main=replace(main,'/^[“"「『（(]$/u.test(sourceTrimmed.slice(-1)) && /^[“"「『（(]$/u.test(trimmedTranslation.slice(-1)))','/^[“"「『（(]$/u.test(sourceTrimmed.slice(-1)) && /^[“"「『（(]$/u.test(trimmedTranslation.slice(-1)) || /^[】〗〕》〉）］｝\\])}⟧]$/u.test(sourceTrimmed.slice(-1)) && /^[】〗〕》〉）］｝\\])}⟧]$/u.test(trimmedTranslation.slice(-1)))');
main=main.replace(
  /async expandIxdzsCatalog\(page, requestedUrl, signal\) \{[\s\S]*?\n  \}/u,
  `async expandIxdzsCatalog(page, requestedUrl, signal) {
    let parsed;
    try {
      parsed = parseStoryUrl(requestedUrl);
    } catch {
      return;
    }
    if (parsed.site !== "xszj" || parsed.kind !== "book" || !/^https:\\/\\/ixdzs8\\.com\\/read\\//u.test(parsed.normalizedUrl)) return;
    const trigger = page.locator("h2.catalog-toggle, .catalog-toggle, .catalog-all a, li.catalog-all a, li.catalog-all");
    if (await trigger.count() === 0) return;
    const before = await page.locator(".u-chapter a[href*='/p']").count();
    try {
      await raceStoryOperationWithAbort(trigger.first().click({ timeout: 8e3 }), signal, () => this.discardPage(page));
      await raceStoryOperationWithAbort(page.waitForFunction((count) => document.querySelectorAll(".u-chapter a[href*='/p']").length > count, before, { timeout: 12e3 }), signal, () => this.discardPage(page));
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }`
);
let ast=parse(main);const runner=ast.program.body.find(n=>n.type==='ClassDeclaration'&&n.id?.name==='TranslationJobRunner'),complete=runner.body.body.find(n=>n.key?.name==='completeSegment');
traverse(ast,{VariableDeclarator(p){if(p.node.start<complete.start||p.node.end>complete.end||p.node.id?.name!=='extracted')return;edits.push({start:p.node.init.start,end:p.node.init.end,text:'job.pipelineV3 ? {entities:[], relations:[], recentDialogues:[]} : '+main.slice(p.node.init.start,p.node.init.end)});}});
traverse(ast,{AssignmentExpression(p){if(p.node.start<complete.start||p.node.end>complete.end||p.node.left?.object?.name!=='job'||p.node.left?.property?.name!=='memory'||p.node.right?.callee?.name!=='mergeStoryMemory'||p.node.right.arguments[1]?.name!=='safeExtracted')return;edits.push({start:p.node.right.start,end:p.node.right.end,text:'job.pipelineV3 ? job.memory : '+main.slice(p.node.right.start,p.node.right.end)});}});
const restart=runner.body.body.find(n=>n.key?.name==='restart');
traverse(ast,{CallExpression(p){if(p.node.start<restart.start||p.node.end>restart.end||p.node.callee?.object?.type!=='ThisExpression'||p.node.callee?.property?.name!=='start'||p.node.arguments[0]?.type!=='ObjectExpression')return;const position=p.node.arguments[0].start+1;edits.push({start:position,end:position,text:'\n      ...pipelineV3.pipelineRestartOptions(job),'});}});
const api=ast.program.body.find(n=>n.type==='ClassDeclaration'&&n.id?.name==='GeminiApiAdapter'),send=api.body.body.find(n=>n.key?.name==='sendAndWait'),call=api.body.body.find(n=>n.key?.name==='callGeminiApi');
const newSendAndWait = `async sendAndWait(message, options = {}) {
    await this.ensureReady();
    if (!message || message.trim().length === 0) {
      throw new TypeError("Nội dung gửi Gemini API không được để trống.");
    }
    this.updateStatus("busy", \`Đang gửi bản dịch qua Gemini API (\${this.currentModel})...\`);
    this.abortController = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, this.abortController.signal]) : this.abortController.signal;
    const maxAttempts = Math.max(this.keys.length * 4, 8);
    let attempts = 0;
    let highDemandAttempts = 0;
    let lastError = null;
    while (attempts < maxAttempts) {
      if (signal.aborted) {
        throw new Error("Tác vụ dịch đã bị hủy.");
      }
      const currentKey = this.keys[this.activeKeyIndex] || this.keys[0];
      if (!currentKey) {
        throw new Error("Không có API key nào khả dụng.");
      }
      attempts += 1;
      try {
        const result = await this.callGeminiApi(currentKey, this.currentModel, message, signal);
        this.recordKeySuccess(currentKey);
        this.updateStatus("ready", \`Dịch xong lượt với key \${maskKey(currentKey)} (\${this.currentModel})\`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errMessage = lastError.message || "";
        const isQuotaOrRateLimit = /429|quota|RESOURCE_EXHAUSTED|rateLimitExceeded/iu.test(errMessage);
        const isHighDemand = /503|high demand|overloaded|spikes in demand|timeout|fetch failed|ECONNRESET/iu.test(errMessage);
        const isProjectDisabled = /403|free tier is not available|PERMISSION_DENIED/iu.test(errMessage);
        const errorDetails = lastError.details;
        const violations = errorDetails?.find((d) => d["@type"]?.includes("QuotaFailure"))?.violations;
        const violation = violations?.[0];
        const retryInfo = errorDetails?.find((d) => d["@type"]?.includes("RetryInfo"));
        const retryDelayStr = retryInfo?.retryDelay || "";
        const retrySec = parseInt(retryDelayStr, 10) || 0;
        const isMinuteLimit = violation?.quotaMetric?.includes("minute") || /per minute/i.test(violation?.description || "") || /per minute/i.test(errMessage) || (retrySec > 0 && retrySec <= 60);
        if (isQuotaOrRateLimit) {
          const quotaLimit = Number(violation?.quotaValue) || (this.currentModel.includes("2.5-flash") && !this.currentModel.includes("lite") ? 20 : 500);
          this.recordKeyError(currentKey, "quota_exceeded", isMinuteLimit ? "Chạm hạn mức phút (15 RPM)" : \`Hết hạn mức ngày (\${quotaLimit} RPD)\`);
        } else if (isProjectDisabled) {
          this.recordKeyError(currentKey, "blocked", "Chưa bật Free Tier (403)");
        }
        if (isMinuteLimit && isQuotaOrRateLimit && this.keys.length > 1) {
          const prevKeyMasked = maskKey(currentKey);
          this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
          const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
          this.updateStatus(
            "busy",
            \`Key \${prevKeyMasked} chạm 15 RPM. Tự động đổi sang key \${nextKeyMasked} và tiếp tục...\`
          );
          await new Promise((resolve) => setTimeout(resolve, 600));
          continue;
        }
        if (isMinuteLimit && attempts < maxAttempts) {
          const waitTime = Math.min(Math.max(retrySec, 15), 30);
          this.updateStatus("busy", \`Chạm hạn mức 15 RPM. Tự động tạm nghỉ \${waitTime}s để hạ nhiệt rồi dịch tiếp...\`);
          await new Promise((resolve) => setTimeout(resolve, waitTime * 1e3));
          continue;
        }
        if (isQuotaOrRateLimit && !isMinuteLimit) {
          if (this.currentModel === "gemini-3.5-flash-lite") {
            this.currentModel = "gemini-3.1-flash-lite";
            this.updateStatus(
              "busy",
              \`Key \${maskKey(currentKey)} hết 500 lượt của 3.5. Tự động chuyển sang Gemini 3.1 Flash-Lite (thêm 500 lượt) trên cùng key...\`
            );
            await new Promise((resolve) => setTimeout(resolve, 800));
            continue;
          }
          if (this.currentModel === "gemini-3.1-flash-lite" && this.keys.length > 1) {
            const prevKeyMasked = maskKey(currentKey);
            this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
            this.currentModel = "gemini-3.5-flash-lite";
            const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
            this.updateStatus(
              "busy",
              \`Key \${prevKeyMasked} đã dùng hết cả 1,000 lượt (3.5 & 3.1). Tự động xoay sang key \${nextKeyMasked} với Gemini 3.5 Flash-Lite...\`
            );
            await new Promise((resolve) => setTimeout(resolve, 800));
            continue;
          }
          if (this.currentModel !== "gemini-2.5-flash" && this.keys.length === 1) {
            this.currentModel = "gemini-2.5-flash";
            this.updateStatus("busy", \`Hết 1,000 lượt 3.5/3.1. Chuyển sang Gemini 2.5 Flash và gửi lại...\`);
            await new Promise((resolve) => setTimeout(resolve, 800));
            continue;
          }
        }
        if (isHighDemand) {
          highDemandAttempts += 1;
          const waitSec = Math.min(2 + highDemandAttempts * 2, 12);
          const prevKeyMasked = maskKey(currentKey);
          if (this.currentModel === "gemini-3.5-flash-lite" && (highDemandAttempts >= 2 || this.keys.length <= 1)) {
            this.currentModel = "gemini-3.1-flash-lite";
            this.updateStatus(
              "busy",
              \`Cụm máy chủ 3.5 Flash-Lite quá tải (503). Tự động chuyển sang Gemini 3.1 Flash-Lite (nghỉ \${waitSec}s) và gửi lại...\`
            );
            await new Promise((resolve) => setTimeout(resolve, waitSec * 1e3));
            continue;
          }
          if (this.currentModel === "gemini-3.1-flash-lite" && highDemandAttempts >= 4) {
            this.currentModel = "gemini-2.5-flash";
            this.updateStatus(
              "busy",
              \`Cụm máy chủ Flash-Lite quá tải (503). Tự động chuyển sang Gemini 2.5 Flash (nghỉ \${waitSec}s) và gửi lại...\`
            );
            await new Promise((resolve) => setTimeout(resolve, waitSec * 1e3));
            continue;
          }
          if (this.keys.length > 1) {
            this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
            const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
            this.updateStatus(
              "busy",
              \`Máy chủ Google quá tải (503) với key \${prevKeyMasked}. Đổi sang key \${nextKeyMasked}, tạm nghỉ \${waitSec}s rồi gửi lại...\`
            );
            await new Promise((resolve) => setTimeout(resolve, waitSec * 1e3));
            continue;
          } else {
            this.updateStatus(
              "busy",
              \`Máy chủ Google tạm thời quá tải (503). Tạm nghỉ \${waitSec}s để hạ nhiệt rồi gửi lại (lần \${attempts}/\${maxAttempts})...\`
            );
            await new Promise((resolve) => setTimeout(resolve, waitSec * 1e3));
            continue;
          }
        }
        if (isProjectDisabled && this.keys.length > 1) {
          const prevKeyMasked = maskKey(currentKey);
          this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
          const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
          this.updateStatus(
            "busy",
            \`Key \${prevKeyMasked} chưa mở free tier (403). Tự động đổi sang key \${nextKeyMasked} và gửi lại...\`
          );
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        this.updateStatus("error", \`Lỗi Gemini API: \${errMessage}\`);
        throw lastError;
      }
    }
    this.updateStatus("error", \`Đã thử tất cả API key nhưng đều báo bận/hết hạn mức.\`);
    throw lastError || new Error("Không thể hoàn tất lượt dịch qua Gemini API.");
  }`;
const newCallGeminiApi = `async callGeminiApi(key, model, prompt, signal) {
    const url = \`https://generativelanguage.googleapis.com/v1beta/models/\${encodeURIComponent(model)}:generateContent?key=\${encodeURIComponent(key)}\`;
    const isAnalysisOrScout = /^\[TDT_(?:SCOUT|V3_ANALYSIS)\]/u.test(prompt) || prompt.startsWith("[TDT_V3_ANALYSIS]");
    const isLocalizedRepair = prompt.includes("<CAU_CAN_SUA>") || prompt.includes("SỬA CỤC BỘ");

    let systemText = PURE_VIETNAMESE_SYSTEM_INSTRUCTION;
    if (isAnalysisOrScout) {
      systemText = "Bạn là chuyên gia phân tích và trinh sát nội dung truyện. Tuân thủ tuyệt đối cấu trúc JSON trong prompt. CHỈ trả về duy nhất 1 khối JSON hợp lệ theo định dạng yêu cầu, tuyệt đối KHÔNG dịch văn bản, KHÔNG xuất thẻ HTML và KHÔNG thêm lời chào.";
    } else if (isLocalizedRepair) {
      systemText = "Bạn là chuyên gia dịch thuật và biên tập văn học Trung - Việt. Nhiệm vụ của bạn là sửa chữa các câu tiếng Việt có sót chữ Hán sang tiếng Việt thuần túy, tự nhiên, chuẩn văn cảnh truyện. Tuyệt đối KHÔNG để sót bất kỳ chữ Hán nào. Chỉ trả về các thẻ <CAU_DA_SUA id=\\"...\\">câu tiếng Việt đã sửa</CAU_DA_SUA>, không thêm lời chào, giải thích hoặc lời bình.";
    }

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemText }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: isAnalysisOrScout ? 0.1 : isLocalizedRepair ? 0.2 : 0.3,
        topP: 0.95,
        maxOutputTokens: 65536
      }
    };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal
    });
    let data;
    const responseText = await response.text();
    try {
      data = JSON.parse(responseText);
    } catch {
    }
    if (!response.ok || data?.error) {
      const code = data?.error?.code ?? response.status;
      const msg = data?.error?.message ?? (responseText.slice(0, 300) || response.statusText);
      const err = new Error(\`Gemini API HTTP \${code}: \${msg}\`);
      err.details = data?.error?.details;
      err.code = code;
      throw err;
    }
    return readGeminiTextResponse(data);
  }`;
edits.push({start:send.start,end:send.end,text:newSendAndWait});
edits.push({start:call.start,end:call.end,text:newCallGeminiApi});
if(edits.length!==5)throw Error('Expected exactly memory, restart and upgraded API send/call patches, got '+edits.length);
for(const e of edits.sort((a,b)=>b.start-a.start))main=main.slice(0,e.start)+e.text+main.slice(e.end);
main='const pipelineV3 = (await import("./translation-v3.cjs")).default;\n'+main;parse(main);await fs.writeFile(mainFile,main);
const list=asar.listPackage(baseline),rendererKey=list.find(n=>/out[\\/]renderer[\\/]assets[\\/]index-[^\\/]+\.js$/u.test(n)).replace(/^[\\/]/u,''),rendererFile=path.join(stage,rendererKey);let renderer=await fs.readFile(rendererFile,'utf8');
renderer=replace(renderer,'const [geminiBatchChapters, setGeminiBatchChapters] = reactExports.useState(2);','const [geminiBatchChapters, setGeminiBatchChapters] = reactExports.useState(2);\n  const v3SourceRefs = reactExports.useRef({ source: "", chapters: [] });');
renderer=replace(renderer,'setGeminiBatchChapters(cfg.batchChaptersCount);','setGeminiBatchChapters(cfg.batchChaptersCount === 3 ? 3 : 2);');
renderer=replace(renderer,'Đã cấu hình gộp ${count} chương / 1 lần gọi API.','Đã cấu hình gộp ${count} chương / 1 lần dịch.');
renderer=replace(renderer,'const result = await getStoryTool().startTranslation({','const result = await getStoryTool().startTranslation({\n        batchChaptersCount: geminiBatchChapters,\n        sourceChapters: v3SourceRefs.current.source === sourceText ? v3SourceRefs.current.chapters : [],');
renderer=replace(renderer,'setSource(fetched.combinedSource);','v3SourceRefs.current = { source: fetched.combinedSource, chapters: fetched.chapters.map((c,i) => {const headers = [...fetched.combinedSource.matchAll(/(?:^|\\n)Chương\\s+(\\d+)/gu)];const number=Number(headers[i]?.[1] ?? i+1);return {id:"CH"+number,number,title:c.title,text:"",urls:c.sourceUrls};}) };\n      setSource(fetched.combinedSource);');
parse(renderer);await fs.writeFile(rendererFile,renderer);
await fs.cp('resources/huli-browser-helper',path.join(stage,'resources/huli-browser-helper'),{recursive:true});
const output=path.join(root,'app-v3.asar');await asar.createPackageWithOptions(stage,output,{unpack:'**/node_modules/playwright-core/**/*'});
const changed=[],added=[];for(const file of asar.listPackage(output)){const key=file.replace(/^[\\/]/u,''),stat=asar.statFile(output,key);if(stat.files||stat.link)continue;if(!list.includes(file))added.push(file);else if(!asar.extractFile(baseline,key).equals(asar.extractFile(output,key)))changed.push(file);}
const allow=[/out[\\/]main[\\/](?:index\.js|story-source-step1\.cjs)$/u,/out[\\/]renderer[\\/]assets[\\/]index-[^\\/]+\.js$/u,/resources[\\/]huli-browser-helper[\\/]/u];
if(changed.some(p=>!allow.some(re=>re.test(p)))||added.some(p=>! /out[\\/]main[\\/]translation-v3\.cjs$/u.test(p)&&!/resources[\\/]huli-browser-helper[\\/]/u.test(p)))throw Error('Unexpected package changes: '+JSON.stringify({changed,added}));
const report={builtAt:new Date().toISOString(),baselineHash:info.archiveHash,archiveHash:hash(await fs.readFile(output)),changed,added,apiUiAndAdaptersPreserved:true,legacyJobsRemainLegacy:true};await fs.writeFile(path.join(root,'package-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
