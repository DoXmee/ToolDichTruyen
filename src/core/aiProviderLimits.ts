/**
 * ============================================================================
 * CẤU HÌNH THỐNG NHẤT GIỚI HẠN VÀ TẢI CHO 3 LUỒNG AI (AI PROVIDER LIMITS)
 * ============================================================================
 * Nguồn cấu hình duy nhất (Single Source of Truth) quy định hạn mức đầu vào,
 * đầu ra và dung lượng gom mẻ cho 3 luồng AI hoàn toàn độc lập:
 * 1. CHATGPT WEB (Browser UI / DOM)
 * 2. DEEPSEEK API (REST API)
 * 3. GEMINI API (REST API)
 */

export interface ProviderLimitConfig {
  aiProvider: 'chatgpt' | 'kimi' | 'deepseek' | 'gemini';
  executionMode: 'web' | 'api';
  /** Dung lượng tối đa người dùng được nhập vào ô Prompt tùy chỉnh (ký tự) */
  maxCustomPromptChars: number;
  /** Dung lượng ước tính của khung prompt kỹ thuật cố định (Blocks A, B, C, D, E, F, H) */
  estimatedBasePromptChars: number;
  /** Trần an toàn tin nhắn gửi đi (DOM textarea hoặc input token budget) */
  safeTotalMessageChars: number;
  /** Trần an toàn mẻ dịch văn bản nguồn (chữ Hán) */
  defaultMaxBatchChars: number;
  /** Trần an toàn mẻ trinh sát chùm Cluster Scout (chữ Hán) */
  maxClusterScoutChars: number;
  /** Giới hạn token đầu ra (completion output tokens) của model */
  maxOutputTokens: number;
  /** Ngưỡng ký tự tối thiểu của mẻ nguồn khi bị khấu trừ bởi custom prompt dài */
  minBatchCharsFloor: number;
}

export const AI_PROVIDER_LIMITS: Record<string, ProviderLimitConfig> = {
  'web:chatgpt': {
    aiProvider: 'chatgpt',
    executionMode: 'web',
    maxCustomPromptChars: 3000,
    estimatedBasePromptChars: 4800,
    safeTotalMessageChars: 12500, // Trần tin nhắn an toàn trên DOM ChatGPT Web
    defaultMaxBatchChars: 2200,
    maxClusterScoutChars: 4000,
    maxOutputTokens: 4096,
    minBatchCharsFloor: 1200,
  },
  'web:kimi': {
    aiProvider: 'kimi',
    executionMode: 'web',
    maxCustomPromptChars: 3000,
    estimatedBasePromptChars: 4800,
    safeTotalMessageChars: 14000,
    defaultMaxBatchChars: 2500,
    maxClusterScoutChars: 5000,
    maxOutputTokens: 4096,
    minBatchCharsFloor: 1200,
  },
  'api:deepseek': {
    aiProvider: 'deepseek',
    executionMode: 'api',
    maxCustomPromptChars: 6000,
    estimatedBasePromptChars: 5500,
    safeTotalMessageChars: 128000, // DeepSeek 64k-128k context
    defaultMaxBatchChars: 3800, // Cân đối tỷ lệ nở 2.5x-3.0x tiếng Việt trong giới hạn 8192 max_tokens
    maxClusterScoutChars: 36000, // Trinh sát chùm tới ~30 chương
    maxOutputTokens: 8192,
    minBatchCharsFloor: 2000,
  },
  'api:gemini': {
    aiProvider: 'gemini',
    executionMode: 'api',
    maxCustomPromptChars: 10000,
    estimatedBasePromptChars: 6000,
    safeTotalMessageChars: 1000000, // Gemini 1M tokens context
    defaultMaxBatchChars: 5000, // Cân đối đầu ra trong trần 65536 maxOutputTokens
    maxClusterScoutChars: 50000, // Trinh sát chùm tới ~50 chương
    maxOutputTokens: 65536,
    minBatchCharsFloor: 3000,
  },
};

export function getProviderLimits(
  aiProvider: string = 'chatgpt',
  executionMode: string = 'web',
): ProviderLimitConfig {
  const mode = executionMode === 'api' ? 'api' : 'web';
  const provider = (aiProvider || 'chatgpt').toLowerCase();
  const key = `${mode}:${provider}`;
  if (AI_PROVIDER_LIMITS[key]) {
    return AI_PROVIDER_LIMITS[key]!;
  }
  // Fallbacks
  if (mode === 'api') {
    return provider === 'deepseek' ? AI_PROVIDER_LIMITS['api:deepseek']! : AI_PROVIDER_LIMITS['api:gemini']!;
  }
  return AI_PROVIDER_LIMITS['web:chatgpt']!;
}
