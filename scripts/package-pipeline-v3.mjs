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

// 1. IPC CHANNELS
main=replace(main,'geminiApiTestKey: "story-tool:gemini-api:test-key",','geminiApiTestKey: "story-tool:gemini-api:test-key",\n  deepseekApiGetConfig: "story-tool:deepseek-api:get-config",\n  deepseekApiSetConfig: "story-tool:deepseek-api:set-config",\n  deepseekApiTestKey: "story-tool:deepseek-api:test-key",\n  deepseekApiCheckBalance: "story-tool:deepseek-api:check-balance",');

// 2. PERSISTENCE METHODS
main=replace(main,'async getGeminiApiConfiguration() {',`async getDeepSeekApiConfiguration() {
    const settings = await this.settingsStore.read(EMPTY_SETTINGS);
    const keys = (settings.deepseekApiKeysPlain || []).map((k) => k.trim()).filter((k) => k.length > 5);
    return {
      apiKeys: keys,
      model: settings.deepseekApiModel || "deepseek-chat",
      executionMode: settings.executionMode || "web"
    };
  }
  async updateDeepSeekApiConfiguration(input) {
    const settings = { ...await this.settingsStore.read(EMPTY_SETTINGS) };
    if (Array.isArray(input.apiKeys)) {
      settings.deepseekApiKeysPlain = input.apiKeys.map((k) => k.trim()).filter((k) => k.length > 5);
    }
    if (typeof input.model === "string" && input.model.trim()) {
      settings.deepseekApiModel = input.model.trim();
    }
    if (input.executionMode === "api" || input.executionMode === "web") {
      settings.executionMode = input.executionMode;
    }
    await this.settingsStore.write(settings);
    return this.getDeepSeekApiConfiguration();
  }
  async getGeminiApiConfiguration() {`);

// 3. IPC HANDLERS
main=replace(main,'handle(IPC_CHANNELS.geminiApiTestKey,',`handle(IPC_CHANNELS.deepseekApiGetConfig, async () => {
    return dependencies.persistence.getDeepSeekApiConfiguration();
  });
  handle(IPC_CHANNELS.deepseekApiSetConfig, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Cấu hình DeepSeek API");
    const updated = await dependencies.persistence.updateDeepSeekApiConfiguration({
      apiKeys: Array.isArray(payload.apiKeys) ? payload.apiKeys : void 0,
      model: typeof payload.model === "string" ? payload.model : void 0,
      executionMode: payload.executionMode === "api" || payload.executionMode === "web" ? payload.executionMode : void 0
    });
    if (dependencies.deepseekApi) {
      if (updated.apiKeys) dependencies.deepseekApi.setKeys(updated.apiKeys);
      if (updated.model) dependencies.deepseekApi.setModel(updated.model);
    }
    return updated;
  });
  handle(IPC_CHANNELS.deepseekApiTestKey, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Kiểm tra DeepSeek API Key");
    const apiKey = stringField(payload, "apiKey", { required: true });
    if (dependencies.deepseekApi) {
      return dependencies.deepseekApi.testKey(apiKey);
    }
    const tempAdapter = new pipelineV3.DeepSeekApiAdapter();
    return tempAdapter.testKey(apiKey);
  });
  handle(IPC_CHANNELS.deepseekApiCheckBalance, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Kiểm tra số dư DeepSeek");
    const apiKey = stringField(payload, "apiKey", { required: true });
    if (dependencies.deepseekApi) {
      return dependencies.deepseekApi.fetchBalance(apiKey);
    }
    const tempAdapter = new pipelineV3.DeepSeekApiAdapter();
    return tempAdapter.fetchBalance(apiKey);
  });
  handle(IPC_CHANNELS.geminiApiTestKey,`);

// 4. RUNNER BOOTSTRAP
main=replace(main,'translator = new TranslationJobRunner({ chatGpt, geminiApi, persistence });',`const deepseekApiConfig = await persistence.getDeepSeekApiConfiguration().catch(() => void 0);
  const deepseekApi = new pipelineV3.DeepSeekApiAdapter({
    apiKeys: deepseekApiConfig?.apiKeys || [],
    model: deepseekApiConfig?.model || "deepseek-chat"
  });
  translator = new TranslationJobRunner({ chatGpt, geminiApi, deepseekApi, persistence });`);
main=replace(main,'geminiApi\n      });','geminiApi,\n        deepseekApi\n      });');

// 5. GET AI ADAPTER
main=replace(main,'getAiAdapter(job) {\n    if (job?.executionMode === "api" && this.dependencies.geminiApi) {\n      return this.dependencies.geminiApi;\n    }\n    return this.dependencies.chatGpt;\n  }','getAiAdapter(job) {\n    if (job?.executionMode === "api") {\n      if (job.aiProvider === "deepseek" && this.dependencies.deepseekApi) {\n        return this.dependencies.deepseekApi;\n      }\n      if (this.dependencies.geminiApi) {\n        return this.dependencies.geminiApi;\n      }\n    }\n    return this.dependencies.chatGpt;\n  }');

// 6. SEPARATION OF API PROVIDERS (GEMINI vs DEEPSEEK) IN TRANSLATION RUNNER
main=replace(
  main,
  'const requestedProvider = executionMode === "api" ? "gemini" : normalizeAiProvider(request.aiProvider);',
  'const requestedProvider = executionMode === "api" ? (request.aiProvider === "deepseek" ? "deepseek" : "gemini") : normalizeAiProvider(request.aiProvider);'
);
main=replace(
  main,
  'const allowedAiProviders = executionMode === "api" ? ["gemini"] : normalizeAllowedAiProviders(request.allowedAiProviders, requestedProvider);',
  'const allowedAiProviders = executionMode === "api" ? [requestedProvider] : normalizeAllowedAiProviders(request.allowedAiProviders, requestedProvider);'
);
main=replace(
  main,
  'const initialProvider = executionMode === "api" ? "gemini" : allowedAiProviders.includes(requestedProvider) ? requestedProvider : allowedAiProviders[0];',
  'const initialProvider = executionMode === "api" ? requestedProvider : allowedAiProviders.includes(requestedProvider) ? requestedProvider : allowedAiProviders[0];'
);
main=replace(
  main,
  'if (job.executionMode === "api") {\n      job.aiProvider = "gemini";\n      job.allowedAiProviders = ["gemini"];\n      delete job.manualProviderRescue;\n      job.providerFailover = initialProviderFailover("gemini");',
  'if (job.executionMode === "api") {\n      const apiProv = (aiProvider === "deepseek" || job.aiProvider === "deepseek") ? "deepseek" : "gemini";\n      job.aiProvider = apiProv;\n      job.allowedAiProviders = [apiProv];\n      delete job.manualProviderRescue;\n      job.providerFailover = initialProviderFailover(apiProv);'
);
main=replace(
  main,
  'this.logActivity(job, `Đang kiểm tra phiên ${job.executionMode === "api" ? "Gemini API" : providerLabel2} trước khi dịch tiếp.`);',
  'this.logActivity(job, `Đang kiểm tra phiên ${job.executionMode === "api" ? (job.aiProvider === "deepseek" ? "DeepSeek API" : "Gemini API") : providerLabel2} trước khi dịch tiếp.`);'
);
main=replace(
  main,
  'model: settings.geminiModel || "gemini-3.5-flash-lite",',
  'model: (settings.geminiModel && settings.geminiModel !== "deepseek-chat") ? settings.geminiModel : "gemini-3.5-flash-lite",'
);
main=replace(
  main,
  'if (typeof input.model === "string" && input.model.trim()) {\n      settings.geminiModel = input.model.trim();\n    }',
  'if (typeof input.model === "string" && input.model.trim() && input.model.trim() !== "deepseek-chat") {\n      settings.geminiModel = input.model.trim();\n    }'
);

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
      systemText = "Bạn là chuyên gia dịch thuật và biên tập văn học Trung - Việt. Nhiệm vụ của bạn là sửa chữa các câu tiếng Việt có sót chữ Hán sang tiếng Việt thuần túy, tự nhiên, chuẩn văn cảnh truyện. Tuyệt đối KHÔNG để sót bất kỳ chữ Hán nào. Chỉ trả về các thẻ <CAU_DA_SUA id=\\\"...\\\">câu tiếng Việt đã sửa</CAU_DA_SUA>, không thêm lời chào, giải thích hoặc lời bình.";
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

// Patch preload
const preloadFile = path.join(stage, 'out/preload/index.cjs');
let preload = await fs.readFile(preloadFile, 'utf8');
preload = replace(
  preload,
  'geminiApiTestKey: "story-tool:gemini-api:test-key",',
  'geminiApiTestKey: "story-tool:gemini-api:test-key",\n  deepseekApiGetConfig: "story-tool:deepseek-api:get-config",\n  deepseekApiSetConfig: "story-tool:deepseek-api:set-config",\n  deepseekApiTestKey: "story-tool:deepseek-api:test-key",\n  deepseekApiCheckBalance: "story-tool:deepseek-api:check-balance",'
);
preload = replace(
  preload,
  'testGeminiApiKey: (request) => electron.ipcRenderer.invoke(IPC_CHANNELS.geminiApiTestKey, request),',
  'testGeminiApiKey: (request) => electron.ipcRenderer.invoke(IPC_CHANNELS.geminiApiTestKey, request),\n  getDeepSeekApiConfig: () => electron.ipcRenderer.invoke(IPC_CHANNELS.deepseekApiGetConfig),\n  configureDeepSeekApi: (request) => electron.ipcRenderer.invoke(IPC_CHANNELS.deepseekApiSetConfig, request),\n  testDeepSeekApiKey: (request) => electron.ipcRenderer.invoke(IPC_CHANNELS.deepseekApiTestKey, request),\n  checkDeepSeekBalance: (request) => electron.ipcRenderer.invoke(IPC_CHANNELS.deepseekApiCheckBalance, request),'
);
await fs.writeFile(preloadFile, preload);

// Patch renderer
const list=asar.listPackage(baseline),rendererKey=list.find(n=>/out[\\/]renderer[\\/]assets[\\/]index-[^\\/]+\.js$/u.test(n)).replace(/^[\\/]/u,''),rendererFile=path.join(stage,rendererKey);let renderer=await fs.readFile(rendererFile,'utf8');
renderer=replace(renderer,'const [geminiBatchChapters, setGeminiBatchChapters] = reactExports.useState(2);','const [geminiBatchChapters, setGeminiBatchChapters] = reactExports.useState(2);\n  const v3SourceRefs = reactExports.useRef({ source: "", chapters: [] });');
renderer=replace(renderer,'setGeminiBatchChapters(cfg.batchChaptersCount);','setGeminiBatchChapters(cfg.batchChaptersCount === 3 ? 3 : 2);');
renderer=replace(renderer,'Đã cấu hình gộp ${count} chương / 1 lần gọi API.','Đã cấu hình gộp ${count} chương / 1 lần dịch.');
renderer=replace(renderer,'const result = await getStoryTool().startTranslation({','const result = await getStoryTool().startTranslation({\n        batchChaptersCount: geminiBatchChapters,\n        sourceChapters: v3SourceRefs.current.source === sourceText ? v3SourceRefs.current.chapters : [],');
renderer=replace(renderer,'customPrompt: promptMode === "custom" && customPrompt.trim().length > 0 ? customPrompt.trim() : void 0,','customPrompt: customPrompt.trim().length > 0 ? customPrompt.trim().slice(0, 8000) : void 0,');
renderer=replace(renderer,'onChange: (event) => onCustomPromptChange(event.target.value),','onChange: (event) => onCustomPromptChange(event.target.value.slice(0, 8000)), maxLength: 8000,');
renderer=replace(renderer,'setSource(fetched.combinedSource);','v3SourceRefs.current = { source: fetched.combinedSource, chapters: fetched.chapters.map((c,i) => {const headers = [...fetched.combinedSource.matchAll(/(?:^|\\n)Chương\\s+(\\d+)/gu)];const number=Number(headers[i]?.[1] ?? i+1);return {id:"CH"+number,number,title:c.title,text:"",urls:c.sourceUrls};}) };\n      setSource(fetched.combinedSource);');

// 1. Title fixed to "Tài khoản" in all states
renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [\n                "Tài khoản ",\n                providerLabel\n              ] }),',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "Tài khoản" }),'
);

renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-panel__count", children: [\n                providerAccounts.length,\n                " tài khoản"\n              ] }),',
  '/* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-panel__count", children: [\n                executionMode === "api" ? (apiAccountTab === "deepseek" ? deepseekApiKeys.length : geminiApiKeys.length) : providerAccounts.length,\n                executionMode === "api" ? " key" : " tài khoản"\n              ] }),'
);

// 2. Account Header: Add toggle button in head
renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "account-panel__hint", children: "Xoay vòng theo thứ tự, không quay lại tài khoản đã lỗi" })',
  `/* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "account-panel__hint", children: executionMode === "api" ? (apiAccountTab === "deepseek" ? "API DeepSeek V3 - Hiển thị số dư theo thời gian thực" : "Xoay vòng theo thứ tự key Gemini") : "Xoay vòng theo thứ tự, không quay lại tài khoản đã lỗi" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
                "data-api-mode-switch": "true",
                className: \`button button--tiny \${executionMode === "api" ? "button--primary" : "button--secondary"}\`,
                style: { marginLeft: "auto", fontSize: "11px", padding: "3px 10px", borderRadius: "12px" },
                onClick: () => void toggleExecutionMode(),
                type: "button",
                title: "Chuyển giữa chế độ AI Web và Khóa API",
                children: executionMode === "api" ? "⚡ Khóa API" : "🌐 AI Web"
              })`
);

// 3. Toolbar: Add DeepSeek V3 in Model dropdown
renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "gemini-2.5-flash", children: "Gemini 2.5 Flash (Bản chất lượng cao - 20 lượt/ngày)" })',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "gemini-2.5-flash", children: "Gemini 2.5 Flash (Bản chất lượng cao - 20 lượt/ngày)" }),\n                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "deepseek-chat", children: "DeepSeek V3 (Khuyên dùng - Rẻ nhất)" })'
);

// 4. Toolbar: Remove manual Gộp dropdown completely
const batchAnchor = `/* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "api-select-group", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { htmlFor: "api-batch-select", children: "Gộp:" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "select",
              {
                id: "api-batch-select",
                className: "api-dropdown",
                value: geminiBatchChapters,
                onChange: (e) => void handleBatchChaptersChange(Number(e.target.value)),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: 2, children: "2 chương / lần" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: 1, children: "1 chương / lần" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: 3, children: "3 chương / lần" })
                ]
              }
            )
          ] }),`;
renderer = replace(renderer, batchAnchor, '');

// 5. Toolbar: Key manage button shows count for active model
renderer = replace(
  renderer,
  'geminiApiKeys.length,\n                    " Key"',
  '(geminiApiModel === "deepseek-chat" ? deepseekApiKeys.length : geminiApiKeys.length),\n                    " Key"'
);

// 6. State: Add deepseekApiKeys and deepseekBalances state
renderer = replace(
  renderer,
  'const [isApiKeyPanelOpen, setIsApiKeyPanelOpen] = reactExports.useState(false);',
  `const [isApiKeyPanelOpen, setIsApiKeyPanelOpen] = reactExports.useState(false);
  const [deepseekApiKeys, setDeepseekApiKeys] = reactExports.useState([]);
  const [deepseekBalances, setDeepseekBalances] = reactExports.useState({});
  const [apiAccountTab, setApiAccountTab] = reactExports.useState("deepseek");
  const [newDeepseekKeyInput, setNewDeepseekKeyInput] = reactExports.useState("");`
);

// 7. Account Panel: Tab switching between Gemini Key and DeepSeek Key when executionMode === "api"
renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "account-panel__bots", children: ALL_AI_PROVIDERS.map((provider) => /* @__PURE__ */ jsxRuntimeExports.jsxs(',
  `/* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "account-panel__bots", "data-api-bot-tabs": "true", children: executionMode === "api" ? [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
                "aria-current": apiAccountTab === "gemini",
                className: apiAccountTab === "gemini" ? "is-current" : "",
                onClick: () => setApiAccountTab("gemini"),
                type: "button",
                children: [
                  "Gemini Key",
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("b", { children: [geminiApiKeys.length] })
                ]
              }, "gemini-key-tab"),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
                "aria-current": apiAccountTab === "deepseek",
                className: apiAccountTab === "deepseek" ? "is-current" : "",
                onClick: () => setApiAccountTab("deepseek"),
                type: "button",
                children: [
                  "DeepSeek Key",
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("b", { children: [deepseekApiKeys.length] })
                ]
              }, "deepseek-key-tab")
            ] : ALL_AI_PROVIDERS.map((provider) => /* @__PURE__ */ jsxRuntimeExports.jsxs(`
);

// 8. DeepSeek Balance fetch & Key actions on mount
renderer = replace(
  renderer,
  'if (api.getGeminiApiConfig) {',
  `if (api.getDeepSeekApiConfig) {
      void api.getDeepSeekApiConfig().then(async (cfg) => {
        if (cfg?.apiKeys && cfg.apiKeys.length > 0) {
          setDeepseekApiKeys(cfg.apiKeys);
          for (const k of cfg.apiKeys) {
            if (api.checkDeepSeekBalance) {
              api.checkDeepSeekBalance({ apiKey: k }).then((bal) => {
                if (bal) setDeepseekBalances((prev) => ({ ...prev, [k]: bal }));
              }).catch(() => void 0);
            }
          }
        }
      }).catch(() => void 0);
    }
    if (api.getGeminiApiConfig) {`
);

// 9. DeepSeek helper functions: refresh balance, remove key, add key
renderer = replace(
  renderer,
  'const testSingleKey = async (key) => {',
  `const refreshDeepSeekBalance = async (key) => {
    if (!key || !hasStoryTool()) return;
    const api = getStoryTool();
    if (api.checkDeepSeekBalance) {
      setAppNotice("Đang kiểm tra số dư DeepSeek...");
      const bal = await api.checkDeepSeekBalance({ apiKey: key }).catch(() => "0.00 USD");
      setDeepseekBalances((prev) => ({ ...prev, [key]: bal }));
      setAppNotice(\`Số dư DeepSeek: \${bal}\`);
    }
  };
  const removeDeepSeekKey = async (keyToRemove) => {
    const updated = deepseekApiKeys.filter((k) => k !== keyToRemove);
    setDeepseekApiKeys(updated);
    if (hasStoryTool() && getStoryTool().configureDeepSeekApi) {
      await getStoryTool().configureDeepSeekApi({ apiKeys: updated }).catch(() => void 0);
    }
    setAppNotice(\`Đã xoá 1 DeepSeek API key. Còn lại \${updated.length} key.\`);
  };
  const handleAddNewDeepSeekKeys = async () => {
    const parsed = newDeepseekKeyInput.split(/[\\r\\n,;]+/g).map((k) => k.trim()).filter((k) => k.length > 5);
    if (parsed.length === 0) {
      setAppNotice("Vui lòng nhập ít nhất 1 DeepSeek API key hợp lệ.");
      return;
    }
    const combined = Array.from(new Set([...deepseekApiKeys, ...parsed]));
    setDeepseekApiKeys(combined);
    setNewDeepseekKeyInput("");
    if (hasStoryTool() && getStoryTool().configureDeepSeekApi) {
      await getStoryTool().configureDeepSeekApi({ apiKeys: combined }).catch(() => void 0);
    }
    for (const k of parsed) {
      void refreshDeepSeekBalance(k);
    }
    setAppNotice(\`Đã thêm \${parsed.length} DeepSeek API key mới.\`);
  };
  const testSingleKey = async (key) => {`
);

// 10. StartTranslation provider routing for DeepSeek API
renderer = replace(
  renderer,
  '...aiProvider === "chatgpt" ? {} : { aiProvider },',
  'aiProvider: executionMode === "api" ? (geminiApiModel === "deepseek-chat" ? "deepseek" : "gemini") : aiProvider,'
);

renderer = replace(
  renderer,
  'allowedAiProviders: [...allowedAiProviders],',
  'allowedAiProviders: executionMode === "api" ? (geminiApiModel === "deepseek-chat" ? ["deepseek"] : ["gemini"]) : [...allowedAiProviders],'
);

// Model change handler: route deepseek-chat to DeepSeek config, Gemini models to Gemini config
renderer = replace(
  renderer,
  'const handleModelChange = async (newModel) => {\n    setGeminiApiModel(newModel);\n    if (hasStoryTool() && getStoryTool().configureGeminiApi) {\n      await getStoryTool().configureGeminiApi({ model: newModel }).catch(() => void 0);\n    }\n    setAppNotice(`Đã chọn model: ${newModel}`);\n  };',
  'const handleModelChange = async (newModel) => {\n    setGeminiApiModel(newModel);\n    if (newModel === "deepseek-chat") {\n      if (hasStoryTool() && getStoryTool().configureDeepSeekApi) {\n        await getStoryTool().configureDeepSeekApi({ model: newModel }).catch(() => void 0);\n      }\n    } else {\n      if (hasStoryTool() && getStoryTool().configureGeminiApi) {\n        await getStoryTool().configureGeminiApi({ model: newModel }).catch(() => void 0);\n      }\n    }\n    setAppNotice(`Đã chọn model: ${newModel}`);\n  };'
);

// 11. Account Panel Rows when executionMode === "api"
renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-panel__rows", children: [',
  `/* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-panel__rows", "data-api-rows-switch": "true", children: [
              executionMode === "api" && apiAccountTab === "deepseek" ? (
                deepseekApiKeys.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "account-panel__empty", children: "Chưa có DeepSeek API key nào. Vui lòng nhập key ở bên dưới." }) : deepseekApiKeys.map((key) => {
                  const masked = key.length > 12 ? \`\${key.slice(0, 8)}...\${key.slice(-5)}\` : key;
                  const bal = deepseekBalances[key] || "Đang đọc số dư...";
                  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-row is-active", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "account-row__radio is-on", "aria-hidden": "true" }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-row__who", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: masked }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "DeepSeek V3 (deepseek-chat) · Trả phí qua token" })
                    ] }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "account-tag account-tag--success", style: { fontWeight: 600 }, children: bal }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-row__actions", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
                        "aria-label": \`Kiểm tra số dư \${masked}\`,
                        className: "button button--ghost",
                        onClick: () => void refreshDeepSeekBalance(key),
                        type: "button",
                        title: "Kiểm tra kết nối & đọc số dư",
                        children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sparkles" })
                      }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
                        "aria-label": \`Xoá key \${masked}\`,
                        className: "button button--ghost",
                        onClick: () => void removeDeepSeekKey(key),
                        type: "button",
                        title: "Xóa key này",
                        children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "trash" })
                      })
                    ] })
                  ] }, key);
                })
              ) : executionMode === "api" && apiAccountTab === "gemini" ? (
                geminiApiKeys.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "account-panel__empty", children: "Chưa có Gemini API key nào. Vui lòng nhập key ở bên dưới." }) : geminiApiKeys.map((key, index) => {
                  const keyInfo = keyStatusMap[key];
                  const masked = key.length > 12 ? \`\${key.slice(0, 8)}...\${key.slice(-5)}\` : key;
                  const isReady = keyInfo?.status === "ready";
                  const isBlocked = keyInfo?.status === "blocked";
                  const isQuotaExceeded = keyInfo?.status === "quota_exceeded";
                  const statusTone = isReady ? "success" : isBlocked ? "danger" : isQuotaExceeded ? "warn" : "muted";
                  const statusLabel = isReady ? \`(\${keyInfo?.quota?.usedToday ?? 1}/\${keyInfo?.quota?.rpd || 500})\` : isBlocked ? "Key lỗi" : isQuotaExceeded ? "Hết quota" : "Chưa test";
                  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: \`account-row \${isReady ? "is-active" : ""}\`, children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: \`account-row__radio \${isReady ? "is-on" : ""}\`, "aria-hidden": "true" }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-row__who", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: masked }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: keyInfo?.message || (index === 0 ? "Key mặc định" : "Key dự phòng xoay tua") })
                    ] }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: \`account-tag account-tag--\${statusTone}\`, children: statusLabel }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-row__actions", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
                        "aria-label": \`Kiểm tra key \${masked}\`,
                        className: "button button--ghost",
                        disabled: apiTesting,
                        onClick: () => void testSingleKey(key),
                        type: "button",
                        title: "Kiểm tra kết nối & hạn mức",
                        children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "edit" })
                      }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
                        "aria-label": \`Xoá key \${masked}\`,
                        className: "button button--ghost",
                        onClick: () => void removeApiKey(key),
                        type: "button",
                        title: "Xóa key này",
                        children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "trash" })
                      })
                    ] })
                  ] }, key);
                })
              ) : null,
              executionMode === "api" ? null :`
);

renderer = replace(
  renderer,
  'providerAccounts.map((account) => {',
  'executionMode === "api" ? null : providerAccounts.map((account) => {'
);

// 12. Account Panel Foot when executionMode === "api"
renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-panel__foot", children: [',
  `/* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-panel__foot", "data-api-foot-switch": "true", children: [
              executionMode === "api" && apiAccountTab === "deepseek" ? [
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", {
                  className: "api-key-panel__input",
                  style: { flex: "1 1 auto", minWidth: "180px", padding: "6px 10px", fontSize: "12px", background: "var(--input-bg, #222)", color: "var(--text, #eee)", border: "1px solid var(--border, #444)", borderRadius: "6px" },
                  placeholder: "Dán DeepSeek API key (sk-...)...",
                  value: newDeepseekKeyInput,
                  onChange: (e) => setNewDeepseekKeyInput(e.target.value)
                }, "deepseek-input"),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
                  className: "button button--primary button--tiny",
                  onClick: () => void handleAddNewDeepSeekKeys(),
                  type: "button",
                  children: [/* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sparkles" }), " Thêm Key"]
                }, "deepseek-add-btn"),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
                  className: "button button--secondary button--tiny",
                  onClick: () => { for (const k of deepseekApiKeys) void refreshDeepSeekBalance(k); },
                  type: "button",
                  title: "Làm mới số dư tất cả key",
                  children: [/* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "wand" }), " Kiểm tra số dư"]
                }, "deepseek-check-btn")
              ] : executionMode === "api" && apiAccountTab === "gemini" ? [
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", {
                  className: "api-key-panel__input",
                  style: { flex: "1 1 auto", minWidth: "180px", padding: "6px 10px", fontSize: "12px", background: "var(--input-bg, #222)", color: "var(--text, #eee)", border: "1px solid var(--border, #444)", borderRadius: "6px" },
                  placeholder: "Dán Gemini API key (AIzaSy...)...",
                  value: newKeyInput,
                  onChange: (e) => setNewKeyInput(e.target.value)
                }, "gemini-input"),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
                  className: "button button--primary button--tiny",
                  onClick: () => void handleAddNewKeys(),
                  type: "button",
                  children: [/* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sparkles" }), " Thêm Key"]
                }, "gemini-add-btn"),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
                  className: "button button--secondary button--tiny",
                  disabled: apiTesting,
                  onClick: () => void testAllKeys(),
                  type: "button",
                  children: [/* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "edit" }), " Kiểm tra tất cả Key"]
                }, "gemini-test-all-btn")
              ] : null,
              executionMode === "api" ? null :`
);

renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsxs(\n                "button",\n                {\n                  className: "button button--secondary",\n                  disabled: accountsBusy || connection === "connecting",\n                  onClick: () => void connectAi(),',
  'executionMode === "api" ? null : /* @__PURE__ */ jsxRuntimeExports.jsxs(\n                "button",\n                {\n                  className: "button button--secondary",\n                  disabled: accountsBusy || connection === "connecting",\n                  onClick: () => void connectAi(),'
);

renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsxs(\n                "button",\n                {\n                  className: "button button--secondary",\n                  disabled: accountsBusy || translationState === "running" || translationState === "cancelling",\n                  onClick: () => void cleanupJunk(),',
  'executionMode === "api" ? null : /* @__PURE__ */ jsxRuntimeExports.jsxs(\n                "button",\n                {\n                  className: "button button--secondary",\n                  disabled: accountsBusy || translationState === "running" || translationState === "cancelling",\n                  onClick: () => void cleanupJunk(),'
);

// 13. Popover api-key-panel head, rows, foot for DeepSeek V3
renderer = replace(
  renderer,
  'const defaultModelLimit = geminiApiModel.includes("2.5-flash") && !geminiApiModel.includes("lite") ? 20 : 500;',
  `const isDeepSeekSelected = geminiApiModel === "deepseek-chat";
              if (isDeepSeekSelected) {
                return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-panel__head", "data-api-key-panel-deepseek": "true", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "DeepSeek V3 API Key" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-panel__count", children: [deepseekApiKeys.length, " key đã lưu"] }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "account-panel__hint", children: deepseekApiKeys.length > 0 ? "Hiển thị số dư theo thời gian thực" : "Chưa lưu API key nào" })
                ] });
              }
              const defaultModelLimit = geminiApiModel.includes("2.5-flash") && !geminiApiModel.includes("lite") ? 20 : 500;`
);

renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "account-panel__rows api-key-panel__rows", children: geminiApiKeys.length === 0',
  `/* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "account-panel__rows api-key-panel__rows", children: geminiApiModel === "deepseek-chat" ? (
              deepseekApiKeys.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "account-panel__empty", children: "Chưa có DeepSeek API key nào. Vui lòng nhập key ở bên dưới." }) : deepseekApiKeys.map((key) => {
                const masked = key.length > 12 ? \`\${key.slice(0, 8)}...\${key.slice(-5)}\` : key;
                const bal = deepseekBalances[key] || "Đang đọc số dư...";
                return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-row is-active", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "account-row__radio is-on", "aria-hidden": "true" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-row__who", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: masked }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "DeepSeek V3 (deepseek-chat) · Trả phí qua token" })
                  ] }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "account-tag account-tag--success", style: { fontWeight: 600 }, children: bal }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "account-row__actions", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
                      "aria-label": \`Kiểm tra số dư \${masked}\`,
                      className: "button button--ghost",
                      onClick: () => void refreshDeepSeekBalance(key),
                      type: "button",
                      title: "Kiểm tra kết nối & đọc số dư",
                      children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sparkles" })
                    }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
                      "aria-label": \`Xoá key \${masked}\`,
                      className: "button button--ghost",
                      onClick: () => void removeDeepSeekKey(key),
                      type: "button",
                      title: "Xóa key này",
                      children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "trash" })
                    })
                  ] })
                ] }, key);
              })
            ) : geminiApiKeys.length === 0`
);

renderer = replace(
  renderer,
  '/* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-panel__foot api-key-panel__foot", children: [',
  `/* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "account-panel__foot api-key-panel__foot", children: [
              geminiApiModel === "deepseek-chat" ? [
                /* @__PURE__ */ jsxRuntimeExports.jsx("textarea", {
                  className: "api-key-panel__input",
                  placeholder: "Dán thêm DeepSeek API key (sk-...)...",
                  rows: 2,
                  value: newDeepseekKeyInput,
                  onChange: (e) => setNewDeepseekKeyInput(e.target.value)
                }, "ds-key-input"),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: "8px", width: "100%" }, children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
                    className: "button button--primary button--tiny",
                    onClick: () => void handleAddNewDeepSeekKeys(),
                    type: "button",
                    children: [/* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sparkles" }), " Thêm Key"]
                  }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
                    className: "button button--secondary button--tiny",
                    onClick: () => { for (const k of deepseekApiKeys) void refreshDeepSeekBalance(k); },
                    type: "button",
                    children: [/* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "wand" }), " Kiểm tra số dư"]
                  })
                ] }, "ds-key-actions")
              ] : null,
              geminiApiModel === "deepseek-chat" ? null :`
);

parse(renderer);await fs.writeFile(rendererFile,renderer);
await fs.cp('resources/huli-browser-helper',path.join(stage,'resources/huli-browser-helper'),{recursive:true});
const output=path.join(root,'app-v3.asar');await asar.createPackageWithOptions(stage,output,{unpack:'**/node_modules/playwright-core/**/*'});
const changed=[],added=[];for(const file of asar.listPackage(output)){const key=file.replace(/^[\\/]/u,''),stat=asar.statFile(output,key);if(stat.files||stat.link)continue;if(!list.includes(file))added.push(file);else if(!asar.extractFile(baseline,key).equals(asar.extractFile(output,key)))changed.push(file);}
const allow=[/out[\\/]main[\\/](?:index\.js|story-source-step1\.cjs)$/u,/out[\\/]preload[\\/]index\.cjs$/u,/out[\\/]renderer[\\/]assets[\\/]index-[^\\/]+\.js$/u,/resources[\\/]huli-browser-helper[\\/]/u];
if(changed.some(p=>!allow.some(re=>re.test(p)))||added.some(p=>! /out[\\/]main[\\/]translation-v3\.cjs$/u.test(p)&&!/resources[\\/]huli-browser-helper[\\/]/u.test(p)))throw Error('Unexpected package changes: '+JSON.stringify({changed,added}));
const report={builtAt:new Date().toISOString(),baselineHash:info.archiveHash,archiveHash:hash(await fs.readFile(output)),changed,added,apiUiAndAdaptersPreserved:true,legacyJobsRemainLegacy:true};await fs.writeFile(path.join(root,'package-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
