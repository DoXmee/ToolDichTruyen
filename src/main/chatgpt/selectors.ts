import { stripRestartedOpening } from "./geminiAnswer.js";

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
  /**
   * Positive proof that the session is already authenticated. Only providers
   * whose sign-in state cannot be inferred from a URL are expected to set it.
   */
  signedInMarkers?: readonly string[];
  /**
   * Nodes that carry `aria-busy="true"` while the provider is still producing
   * the answer. When set, a stable-looking answer is not treated as finished
   * until this flag clears, which prevents capturing a half-written reply.
   */
  streamingIndicators?: readonly string[];
  /** Some providers let the user pick which model answers. */
  modelPicker?: ChatWebModelPicker;
  /**
   * Final repair of the captured answer for providers whose page can keep an
   * abandoned fragment next to the finished reply.
   */
  cleanupResponse?: (text: string) => string;
  /**
   * Whether the conversation id is part of the page URL. Gemini stopped putting
   * it there, so its chats are identified by the ownership marker the tool
   * submits instead. Defaults to true.
   */
  conversationIdInUrl?: boolean;
}

export interface ChatWebModelPicker {
  /** Button that opens the model menu. */
  trigger: readonly string[];
  /** Element whose text is the currently selected model name. */
  currentLabel: readonly string[];
  /** One entry per selectable model inside the opened menu. */
  options: readonly string[];
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
    'textarea[placeholder*="Nhắn tin cho DeepSeek" i]',
    'textarea[placeholder*="Send a message" i]',
    'textarea[placeholder*="Ask DeepSeek" i]',
    'textarea[aria-label*="message" i]',
    'textarea[name="search"]',
  ],
  sendButton: [
    'button[aria-label="Send"]',
    'button[aria-label*="send message" i]',
    'button[aria-label*="Gửi" i]',
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

/**
 * Gemini Web selectors, verified against a live, signed-in gemini.google.com.
 *
 * Verified structure:
 *   <rich-textarea><div class="ql-editor" contenteditable role="textbox">  composer
 *   <user-query>                        the prompt the user sent
 *   <message-content>                   the model answer, and nothing else
 *     <structured-content-container class="model-response-text">
 *       <div class="response-container">  also holds "Gemini đã nói" chrome
 *   <div class="model-response-label-announcer" aria-live="polite">  screen-reader label
 *
 * Google renders an `accounts.google.com` anchor on the signed-out page too
 * (a hidden `ServiceLogin` link), and the signed-in page carries an account
 * chip that also points at `accounts.google.com`. Matching that host by href
 * therefore cannot tell the two states apart, which is why `loginLink` lists
 * only explicit sign-in affordances and `signedInMarkers` supplies the
 * positive proof.
 *
 * Two traps that only a live run exposes:
 *  - `div[aria-live="polite"]` matches the always-present label announcer, so a
 *    brand-new chat looked non-empty and the tool refused to send. It would
 *    also return the words "Gemini đã nói" instead of the answer.
 *  - `.response-container` and `<model-response>` wrap that same label, so only
 *    `<message-content>` may be read as the answer.
 *
 * Google localises aria-labels, so every control lists both the English and the
 * Vietnamese wording (this account runs a Vietnamese interface).
 */
export const GEMINI_SELECTORS: ChatWebSelectors = Object.freeze({
  composer: [
    'div[contenteditable="true"][role="textbox"]',
    'rich-textarea .ql-editor[contenteditable="true"]',
    '[contenteditable="true"][aria-label*="prompt" i]',
    'rich-textarea div[contenteditable="true"]',
    'textarea[aria-label*="prompt" i]',
    'textarea[placeholder*="Enter a prompt" i]',
    'textarea[placeholder*="Message" i]',
  ],
  sendButton: [
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
    'button[aria-label*="Submit" i]',
    'button:has(mat-icon:has-text("send"))',
    '[role="button"][aria-label*="Send" i]',
  ],
  stopButton: [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Dừng" i]',
    'button[aria-label*="Cancel" i]',
    '[role="button"][aria-label*="Stop" i]',
  ],
  // Only <message-content> carries the model answer. The wrappers also contain
  // the localised "Gemini đã nói" label, so they are never read on their own.
  assistantMessages: [
    'message-content',
    '.model-response-text',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
  ],
  assistantTurnContainerFromMessage: [
    'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " response-container ")][1]',
    'xpath=ancestor-or-self::message-content[1]',
    'xpath=ancestor-or-self::model-response[1]',
    'xpath=ancestor-or-self::article[1]',
  ],
  assistantTurnCompletionAction: [
    'button[aria-label*="Copy" i]',
    'button[aria-label*="Sao chép" i]',
    'button:has-text("Copy")',
  ],
  toolConversationUserMessages: [
    'user-query',
    'user-query-content',
    '.user-query',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
  ],
  newChat: [
    'button[aria-label*="New chat" i]',
    'button[aria-label*="Cuộc trò chuyện mới" i]',
    'button[aria-label*="Chat mới" i]',
    'a[aria-label*="New chat" i]',
    'button:has-text("New chat")',
  ],
  currentConversationMenu: [
    'button[aria-label*="More" i]',
    'button[aria-label*="Hiện thêm" i]',
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
  // Signed-out only. `ServiceLogin` is Google's anonymous sign-in endpoint;
  // the account chip of an authenticated session uses `SignOutOptions`.
  loginLink: [
    'a[href*="ServiceLogin"]',
    'button:has-text("Sign in")',
    'a:has-text("Sign in")',
    'button:has-text("Đăng nhập")',
    'a:has-text("Đăng nhập")',
  ],
  // Signed-in only. Any visible match proves an authenticated Google session.
  signedInMarkers: [
    'a[href*="SignOutOptions"]',
    'a[aria-label*="Google Account" i]',
    'button[aria-label*="New chat" i]',
    'button[aria-label*="Cuộc trò chuyện mới" i]',
    'img[alt*="Profile" i]',
  ],
  // Gemini marks the answer body `aria-busy="true"` for the whole thinking and
  // streaming phase and clears it only when the reply is complete.
  streamingIndicators: [
    'message-content .markdown[aria-busy]',
    'message-content[aria-busy]',
  ],
  // Live structure: <bard-mode-switcher><button aria-haspopup="true"
  // aria-label="Mở công cụ chọn chế độ, hiện tại là Flash">Flash</button>.
  // The menu renders inside the CDK overlay as <gem-menu><gem-menu-item>.
  modelPicker: {
    trigger: [
      'bard-mode-switcher button[aria-haspopup]',
      'bard-mode-switcher button',
      '.model-picker-container button',
    ],
    currentLabel: [
      // The button carries the real model name in its aria-label ("... hiện
      // tại là Gemini Pro"). The short label element below it can hold just the
      // brand ("Gemini"), so it is only a fallback.
      'bard-mode-switcher button[aria-haspopup]',
      'bard-mode-switcher button',
      'bard-mode-switcher .picker-primary-text',
    ],
    options: [
      'gem-menu gem-menu-item',
      '.cdk-overlay-container gem-menu-item',
      '.cdk-overlay-container [role="menuitem"]',
    ],
  },
  cleanupResponse: stripRestartedOpening,
  // Measured on 2026-09-20: sending a message leaves the address bar on
  // `https://gemini.google.com/app` — no `/app/{id}` ever appears — so the chat
  // is identified by the tool's own ownership marker instead.
  conversationIdInUrl: false,
});
