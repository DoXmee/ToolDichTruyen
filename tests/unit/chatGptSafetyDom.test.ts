// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatGptWebAdapter } from '../../src/main/chatgpt/ChatGptWebAdapter.js';

describe('ChatGptWebAdapter checkChatGptSafetyRefusal DOM isolation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('strips user message wrapper ("Bạn đã nói:" / TDTOWN_) and returns only ChatGPT refusal banner text', async () => {
    document.body.innerHTML = `
      <main>
        <div class="border-red-500 p-2">
          <h5>Bạn đã nói:</h5>
          <div>Bạn</div>
          <div data-message-author-role="user">
            [Metadata nội bộ của Tool Dịch Truyện: TDTOWN_a26a0e2b23c51408c85314cee8072ce9. Không đưa dòng metadata này hoặc mã TDTOWN vào bản dịch.]
            [CẢNH BÁO QUAN TRỌNG KHI DỊCH LẠI - LẦN THỬ 4/4]
          </div>
          <div class="text-red-500">Không thể hiển thị nội dung này vì lý do an toàn. Tìm hiểu thêm về cách chúng tôi tiếp cận các cuộc trò chuyện nhạy cảm.</div>
        </div>
      </main>
    `;

    const adapter = new ChatGptWebAdapter({ profileDirectory: 'test-profile' });
    const fakePage = {
      evaluate: async <T>(fn: () => T): Promise<T> => fn(),
    };

    const result = await (adapter as any).checkChatGptSafetyRefusal(fakePage);
    expect(result).toBe(
      'Không thể hiển thị nội dung này vì lý do an toàn. Tìm hiểu thêm về cách chúng tôi tiếp cận các cuộc trò chuyện nhạy cảm.',
    );
    expect(result).not.toContain('Bạn đã nói');
    expect(result).not.toContain('TDTOWN_');
  });

  it('does not false-trigger when safety keywords appear only inside the user prompt or composer', async () => {
    document.body.innerHTML = `
      <main>
        <div class="border-red-500 p-2">
          <h5>Bạn đã nói:</h5>
          <div data-message-author-role="user">
            [Metadata nội bộ của Tool Dịch Truyện: TDTOWN_11111111111111111111111111111111.]
            Lần dịch trước của bạn chưa hợp lệ do lỗi: ChatGPT từ chối vì lý do an toàn.
          </div>
        </div>
        <div role="alert">
          <div id="prompt-textarea" contenteditable="true">không thể hiển thị nội dung này vì lý do an toàn</div>
        </div>
      </main>
    `;

    const adapter = new ChatGptWebAdapter({ profileDirectory: 'test-profile' });
    const fakePage = {
      evaluate: async <T>(fn: () => T): Promise<T> => fn(),
    };

    const result = await (adapter as any).checkChatGptSafetyRefusal(fakePage);
    expect(result).toBeNull();
  });
});
