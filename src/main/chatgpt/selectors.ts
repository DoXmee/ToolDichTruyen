/**
 * ChatGPT Web is not a public DOM API. Keep every selector in one module so a
 * website update can be repaired without touching the translation runner.
 */
export interface ChatWebSelectors {
  composer: readonly string[];
  sendButton: readonly string[];
  stopButton: readonly string[];
  assistantMessages: readonly string[];
  assistantTurnContainerFromMessage: readonly string[];
  assistantTurnCompletionAction: readonly string[];
  toolConversationUserMessages: readonly string[];
  newChat: readonly string[];
  currentConversationMenu: readonly string[];
  deleteCurrentConversation: readonly string[];
  confirmDeleteConversation: readonly string[];
  retryButton: readonly string[];
  loginLink: readonly string[];
}

export const CHATGPT_SELECTORS: ChatWebSelectors = Object.freeze({
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

/**
 * Kimi's DOM is intentionally kept separate from ChatGPT's selectors.  The
 * translation runner only sees the common adapter contract, while a website
 * markup change can be repaired here without touching checkpoint logic.
 */
export const KIMI_SELECTORS: ChatWebSelectors = Object.freeze({
  composer: [
    'div.chat-input-editor[contenteditable="true"][data-lexical-editor="true"]',
    'div.chat-input-editor[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Message"]',
  ],
  sendButton: [
    'div.send-button-container:not(.disabled)',
    'button.send-button:not([disabled])',
    'button[aria-label="Send"]',
    'button[aria-label*="send" i]',
  ],
  stopButton: [
    'div.send-button-container.stop',
    'button.task-bar-stop',
    'div.send-button-container:has(.stop-icon)',
    'button[aria-label="Stop"]',
    'button[aria-label*="stop" i]',
  ],
  assistantMessages: [
    '.assistant-content',
    '.segment-assistant',
    '.chat-content-item-assistant',
    '[data-role="assistant"]',
    '[data-message-author-role="assistant"]',
    '.chat-message.assistant',
  ],
  assistantTurnContainerFromMessage: [
    'xpath=ancestor-or-self::*[contains(@class, "chat-content-item")][1]',
    'xpath=ancestor-or-self::*[contains(@class, "segment")][1]',
    'xpath=ancestor-or-self::article[1]',
  ],
  assistantTurnCompletionAction: [
    'button[aria-label*="Copy" i]',
    '.segment-assistant-actions button',
    '.message-actions button',
  ],
  toolConversationUserMessages: [
    '[data-role="user"]',
    '[data-message-author-role="user"]',
    '.chat-content-item-user',
    '.user-content',
    '.segment-user',
    '.chat-message.user',
  ],
  newChat: [
    'a[href*="chat_enter_method=new_chat"]',
    'a:has-text("New Chat")',
    'button:has-text("New Chat")',
  ],
  currentConversationMenu: [
    'button[aria-label*="More" i]',
    'button[aria-label*="options" i]',
    '.chat-header button:has(.more-icon)',
  ],
  deleteCurrentConversation: [
    '[role="menuitem"]:has-text("Delete")',
    '[role="menuitem"]:has-text("Xóa")',
    'button:has-text("Delete chat")',
  ],
  confirmDeleteConversation: [
    '[role="dialog"] button:has-text("Delete")',
    '[role="dialog"] button:has-text("Xóa")',
  ],
  retryButton: [
    'button:has-text("Retry")',
    'button:has-text("Regenerate")',
    'button:has-text("Try again")',
  ],
  loginLink: [
    'button:has-text("Log in to sync chat history")',
    'button:has-text("Log in")',
    'a:has-text("Log in")',
  ],
});

/**
 * DeepSeek selectors stay isolated from the two existing providers. The
 * semantic fallbacks intentionally avoid generated class names so a site
 * deployment cannot make the tool click an unrelated control.
 */
export const DEEPSEEK_SELECTORS: ChatWebSelectors = Object.freeze({
  composer: [
    'div[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="Message DeepSeek" i]',
    'textarea[placeholder*="Send a message" i]',
    'textarea[placeholder*="Ask DeepSeek" i]',
    'textarea[aria-label*="message" i]',
  ],
  sendButton: [
    'button[aria-label="Send"]',
    'button[aria-label*="send message" i]',
    '[role="button"][aria-label*="send" i]',
  ],
  stopButton: [
    'button[aria-label*="Stop" i]',
    '[role="button"][aria-label*="Stop" i]',
    'button:has-text("Stop generating")',
  ],
  assistantMessages: [
    '.ds-assistant-message-main-content',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.assistant-message',
    '.ds-markdown',
  ],
  assistantTurnContainerFromMessage: [
    'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " ds-message ")][1]',
    'xpath=ancestor-or-self::*[@data-message-author-role="assistant"][1]',
    'xpath=ancestor-or-self::*[@data-role="assistant"][1]',
    'xpath=ancestor-or-self::article[1]',
  ],
  assistantTurnCompletionAction: [
    'button[aria-label*="Copy" i]',
    'button:has-text("Copy")',
  ],
  toolConversationUserMessages: [
    '.ds-collapsible-text',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '.user-message',
  ],
  newChat: [
    'button:has-text("New chat")',
    'a:has-text("New chat")',
    'button[aria-label*="New chat" i]',
  ],
  currentConversationMenu: [
    'button[aria-label*="More" i]',
    'button[aria-label*="Conversation options" i]',
  ],
  deleteCurrentConversation: [
    '[role="menuitem"]:has-text("Delete")',
    'button:has-text("Delete chat")',
  ],
  confirmDeleteConversation: [
    '[role="dialog"] button:has-text("Delete")',
  ],
  retryButton: [
    'button:has-text("Retry")',
    'button:has-text("Regenerate")',
    'button:has-text("Try again")',
  ],
  loginLink: [
    'button:has-text("Log in")',
    'a[href*="sign_in"]',
    'a[href*="login"]',
  ],
});
