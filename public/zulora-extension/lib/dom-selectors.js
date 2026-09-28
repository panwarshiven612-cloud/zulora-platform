(function installZuloraSelectorDictionary() {
  globalThis.ZULORA_DOM_SELECTORS = Object.freeze({
    search: [
      'input[type="search"]', 'input[placeholder*="search" i]', 'input[aria-label*="search" i]',
      'input[name*="search" i]', '[role="searchbox"]', '[data-testid*="search" i]'
    ],
    prompt: [
      '#prompt-textarea', 'textarea', '[contenteditable="true"]', '[role="textbox"]',
      '[data-placeholder*="message" i]', '[data-placeholder*="prompt" i]'
    ],
    message: [
      'footer [contenteditable="true"]', '[contenteditable="true"][data-tab="10"]',
      '[role="textbox"][contenteditable="true"]', 'textarea[placeholder*="message" i]'
    ],
    email: [
      'input[type="email"]', 'input[name*="to" i]', 'input[placeholder*="recipient" i]',
      '[contenteditable="true"][aria-label*="message body" i]'
    ],
    submit: [
      'button[type="submit"]', 'button[aria-label*="send" i]', '[role="button"][aria-label*="send" i]',
      '[data-testid="send-button"]', 'button[aria-label*="submit" i]'
    ],
    assistantReply: [
      '[data-message-author-role="assistant"]', 'message-content', 'model-response', '.markdown'
    ],
    whatsappSearch: [
      'div[contenteditable="true"][data-tab="3"]', 'div[role="textbox"][title*="search" i]',
      'input[placeholder*="search" i]'
    ],
    gmailBody: [
      'div[aria-label*="message body" i]', 'div[role="textbox"][aria-label*="message" i]', '.Am.Al.editable'
    ]
  });
})();
