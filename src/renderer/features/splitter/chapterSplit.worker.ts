import { splitStory } from '../../../core';
import type { Chapter, SplitConfig } from '../../../shared';

interface SplitWorkerRequest {
  id: number;
  sourceText: string;
  config: SplitConfig;
}

interface SplitWorkerResponse {
  id: number;
  chapters?: Chapter[];
  error?: string;
}

function normalizedSplitConfig(config: SplitConfig): SplitConfig {
  return {
    ...config,
    startIndex: Math.max(1, config.startIndex || 1),
    targetWords: Math.max(1, config.targetWords || 800),
  };
}

self.onmessage = (event: MessageEvent<SplitWorkerRequest>) => {
  const request = event.data;
  try {
    const response: SplitWorkerResponse = {
      id: request.id,
      chapters: splitStory(request.sourceText, normalizedSplitConfig(request.config)),
    };
    self.postMessage(response);
  } catch (error) {
    const response: SplitWorkerResponse = {
      id: request.id,
      error: error instanceof Error ? error.message : 'Không thể chia chương với cấu hình hiện tại.',
    };
    self.postMessage(response);
  }
};
