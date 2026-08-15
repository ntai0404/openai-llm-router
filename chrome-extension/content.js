(() => {
  const STATE = {
    lastUrl: location.href,
    working: false,
    lastAttemptAt: 0,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }

  function normalize(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function textOf(el) {
    return normalize([
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.textContent,
    ].filter(Boolean).join(' '));
  }

  function allClickable() {
    return [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"]')]
      .filter(visible);
  }

  function findClickable(matchers) {
    return allClickable().find((el) => {
      const text = textOf(el);
      return matchers.some((m) => m.test(text));
    });
  }

  function looksLikeNewChat() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    // Chat pages currently use /c/<id>. New-chat landing pages are normally /.
    return p === '/' || !/^\/c\//.test(p);
  }

  function temporaryLooksEnabled() {
    const candidates = allClickable();
    return candidates.some((el) => {
      const t = textOf(el);
      const pressed = el.getAttribute('aria-pressed');
      const checked = el.getAttribute('aria-checked');
      return /temporary( chat)?/.test(t) &&
        (pressed === 'true' || checked === 'true' || /temporary chat on|temporary enabled|disable temporary/.test(t));
    });
  }

  async function tryEnableTemporary() {
    if (STATE.working || !looksLikeNewChat()) return;

    const settings = await chrome.storage.sync.get({ autoTemporary: true });
    if (!settings.autoTemporary) return;

    const now = Date.now();
    if (now - STATE.lastAttemptAt < 1200) return;
    STATE.lastAttemptAt = now;
    STATE.working = true;

    try {
      if (temporaryLooksEnabled()) return;

      // Strategy 1: Temporary is directly exposed as a button/toggle.
      let target = findClickable([
        /^temporary chat$/,
        /^temporary$/,
        /start temporary chat/,
        /enable temporary/,
      ]);
      if (target) {
        target.click();
        await sleep(250);
        return;
      }

      // Strategy 2: open the model/chat-mode picker, then click Temporary.
      const opener = findClickable([
        /model selector/,
        /select model/,
        /chat mode/,
        /^chatgpt\b/,
      ]);

      if (opener) {
        opener.click();
        await sleep(250);

        target = findClickable([
          /^temporary chat$/,
          /^temporary$/,
          /start temporary chat/,
          /enable temporary/,
        ]);
        if (target) {
          target.click();
          await sleep(250);
          return;
        }

        // Close the picker if we opened it but did not find Temporary.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    } finally {
      STATE.working = false;
    }
  }

  // SPA navigation does not reload the content script, so watch DOM + URL.
  const observer = new MutationObserver(() => {
    if (location.href !== STATE.lastUrl) {
      STATE.lastUrl = location.href;
    }
    void tryEnableTemporary();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Patch history to react quickly to New Chat navigation.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => void tryEnableTemporary());
      return result;
    };
  }
  addEventListener('popstate', () => void tryEnableTemporary());

  // Initial and delayed attempts for hydrated UI.
  void tryEnableTemporary();
  setTimeout(() => void tryEnableTemporary(), 800);
  setTimeout(() => void tryEnableTemporary(), 2000);
})();
