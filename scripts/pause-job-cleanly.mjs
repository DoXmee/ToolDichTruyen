import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const jobPath = 'C:\\Users\\dthuo\\AppData\\Roaming\\tool-dich-truyen\\jobs\\5dbc420f-f482-42cd-beb4-ebe9b354cd8e.json';
const promptFile = 'e:\\Tool dịch truyện\\resources\\prompts\\nien-dai.txt';
const newPrompt = fs.readFileSync(promptFile, 'utf8').replace(/^\uFEFF/u, '').trim();

console.log('Terminating ToolDichTruyen processes cleanly...');
try {
  execSync('taskkill /F /IM ToolDichTruyen.exe /T', { stdio: 'inherit' });
} catch (e) {
  console.log('ToolDichTruyen was not running or closed.');
}

// Small delay to ensure all file handles are released
await new Promise(r => setTimeout(r, 1500));

// Read job JSON
const d = JSON.parse(fs.readFileSync(jobPath, 'utf8'));

// Find which segments are genuinely completed
let lastCompletedIdx = -1;
for (let i = 0; i < d.segments.length; i++) {
  const seg = d.segments[i];
  if (seg.translatedText && seg.translatedText.trim().length > 100) {
    seg.status = 'completed';
    lastCompletedIdx = i;
  } else {
    seg.status = 'queued';
    seg.translatedText = '';
  }
}

const nextIdx = lastCompletedIdx + 1;
d.currentSegmentIndex = nextIdx;
d.status = 'paused';
d.conversationInitialized = false;
d.conversationHasBasePrompt = false;
d.conversationRecoveryPending = lastCompletedIdx >= 0;

// Update resolvedPrompt with our latest nien-dai.txt!
d.resolvedPrompt = newPrompt;

// Add new rules into memory customRules
if (!d.memory) d.memory = {};
if (!d.memory.customRules) d.memory.customRules = [];
const ruleToAdd = 'TUYỆT ĐỐI CẤM từ cổ trang: "nàng" -> "cô", "chàng" -> "anh", "huynh" -> "anh", "muội" -> "em". Chỉ giữ "sư huynh/sư muội" khi là đồng môn.';
if (!d.memory.customRules.includes(ruleToAdd)) {
  d.memory.customRules.push(ruleToAdd);
}
d.updatedAt = new Date().toISOString();

// Save atomically
const tmpPath = `${jobPath}.${Date.now()}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(d, null, 2), 'utf8');
fs.renameSync(tmpPath, jobPath);

console.log(`Successfully preserved job! Total completed segments: ${lastCompletedIdx + 1} / ${d.segments.length}. Next segment to resume: ${nextIdx} (${d.segments[nextIdx]?.id}).`);
