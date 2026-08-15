/**
 * ChatGPT Web is not a public DOM API. Keep every selector in one module so a
 * website update can be repaired without touching the translation runner.
 */
export const CHATGPT_SELECTORS = Object.freeze({
  composer: [
    "#prompt-textarea",
    '[data-testid="prompt-textarea"]',
    'div[contenteditable="true"][data-lexical-editor="true"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="Tin nhắn"]',
  ] as const,
  sendButton: [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Gửi"]',
  ] as const,
  stopButton: [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label*="Dừng"]',
  ] as const,
  assistantMessages: [
    '[data-message-author-role="assistant"]',
    'article:has([data-message-author-role="assistant"])',
    '[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"])',
  ] as const,
  // Resolve the owning turn relative to the exact assistant-message locator.
  // This remains correct when ChatGPT virtualizes older turns and prevents a
  // delayed Copy action from an old turn from completing the latest response.
  assistantTurnContainerFromMessage: [
    'xpath=ancestor-or-self::*[starts-with(@data-testid, "conversation-turn-")][1]',
    'xpath=ancestor-or-self::article[1]',
  ] as const,
  assistantTurnCompletionAction: [
    '[data-testid="copy-turn-action-button"]',
  ] as const,
  toolConversationUserMessages: [
    'main [data-message-author-role="user"]',
    '[role="main"] [data-message-author-role="user"]',
  ] as const,
  newChat: [
    'a[data-testid="create-new-chat-button"]',
    'button[data-testid="create-new-chat-button"]',
    'a[aria-label="New chat"]',
    'a[aria-label*="Đoạn chat mới"]',
  ] as const,
  // These target only the options menu of the conversation that is currently
  // open. The adapter separately verifies the exact /c/{id} URL immediately
  // before every destructive click.
  currentConversationMenu: [
    '[data-testid="thread-header-right-actions"] button[data-testid="conversation-options-button"]',
    '[data-testid="thread-header-right-actions-container"] button[data-testid="conversation-options-button"]',
    'main button[data-testid="conversation-options-button"]',
    '[role="main"] button[data-testid="conversation-options-button"]',
    'main button[aria-label="Open conversation options"]',
    '[role="main"] button[aria-label="Open conversation options"]',
    'main button[aria-label="Conversation options"]',
    '[role="main"] button[aria-label="Conversation options"]',
    'main button[aria-label="Mở tùy chọn cuộc trò chuyện"]',
    '[role="main"] button[aria-label="Mở tùy chọn cuộc trò chuyện"]',
    'main button[aria-label="Tùy chọn cuộc trò chuyện"]',
    '[role="main"] button[aria-label="Tùy chọn cuộc trò chuyện"]',
  ] as const,
  deleteCurrentConversation: [
    '[role="menu"] [role="menuitem"][data-testid="delete-conversation"]',
    '[role="menu"] [role="menuitem"][data-testid="delete-conversation-menu-item"]',
    '[role="menu"] [role="menuitem"]:text-is("Delete")',
    '[role="menu"] [role="menuitem"]:text-is("Xóa")',
  ] as const,
  confirmDeleteConversation: [
    '[role="dialog"] button[data-testid="delete-conversation-confirm-button"]',
    '[role="dialog"] button:text-is("Delete")',
    '[role="dialog"] button:text-is("Xóa")',
  ] as const,
  retryButton: [
    'button:has-text("Retry")',
    'button:has-text("Regenerate")',
    'button:has-text("Thử lại")',
  ] as const,
  loginLink: [
    'a[href*="/auth/login"]',
    'button:has-text("Log in")',
    'button:has-text("Đăng nhập")',
  ] as const,
});

