(() => {
  let lastUrl = location.href;
  let attempting = false;
  let completedForNavigation = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  }

  function normalize(value) {
    return (value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function label(el) {
    return normalize([
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.textContent
    ].filter(Boolean).join(" "));
  }

  function clickableElements() {
    return [
      ...document.querySelectorAll(
        'button,[role="button"],[role="menuitem"],[role="option"]'
      )
    ].filter(visible);
  }

  function findByPatterns(patterns) {
    return clickableElements().find(el => {
      const text = label(el);
      return patterns.some(pattern => pattern.test(text));
    });
  }

  function isNewChatPage() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    return path === "/";
  }

  function appearsEnabled() {
    return clickableElements().some(el => {
      const text = label(el);
      const pressed = el.getAttribute("aria-pressed");
      const checked = el.getAttribute("aria-checked");

      return (
        /temporary/.test(text) &&
        (
          pressed === "true" ||
          checked === "true" ||
          /temporary chat on/.test(text) ||
          /temporary enabled/.test(text) ||
          /disable temporary/.test(text)
        )
      );
    });
  }

  async function report(type) {
    try {
      await chrome.runtime.sendMessage({ type });
    } catch {}
  }

  async function enableTemporary() {
    if (attempting || completedForNavigation || !isNewChatPage()) return;

    const state = await chrome.storage.local.get({
      autoTemporaryRequested: false
    });

    /*
      Also auto-enable whenever the user manually reaches a fresh New Chat.
      This satisfies the non-functional requirement that NEW CHAT defaults
      to Temporary mode.
    */
    attempting = true;

    try {
      if (appearsEnabled()) {
        completedForNavigation = true;
        await report("TEMPORARY_OK");
        return;
      }

      for (let round = 0; round < 20; round++) {
        let temporary = findByPatterns([
          /^temporary$/,
          /^temporary chat$/,
          /start temporary chat/,
          /enable temporary chat/,
          /turn on temporary/,
          /temporary mode/
        ]);

        if (temporary) {
          temporary.click();
          await sleep(500);

          completedForNavigation = true;
          await report("TEMPORARY_OK");
          return;
        }

        /*
          Some ChatGPT layouts place Temporary inside the model/mode menu.
        */
        const picker = findByPatterns([
          /model selector/,
          /select model/,
          /chat mode/,
          /^chatgpt$/,
          /^chatgpt \d/,
          /choose model/
        ]);

        if (picker) {
          picker.click();
          await sleep(250);

          temporary = findByPatterns([
            /^temporary$/,
            /^temporary chat$/,
            /start temporary chat/,
            /enable temporary chat/,
            /turn on temporary/
          ]);

          if (temporary) {
            temporary.click();
            await sleep(500);

            completedForNavigation = true;
            await report("TEMPORARY_OK");
            return;
          }

          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true
            })
          );
        }

        await sleep(300);
      }

      if (state.autoTemporaryRequested) {
        await report("TEMPORARY_FAILED");
      }
    } finally {
      attempting = false;
    }
  }

  function navigationChanged() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      completedForNavigation = false;
    }

    void enableTemporary();
  }

  const observer = new MutationObserver(navigationChanged);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];

    history[method] = function (...args) {
      const result = original.apply(this, args);

      queueMicrotask(navigationChanged);

      return result;
    };
  }

  addEventListener("popstate", navigationChanged);

  void enableTemporary();
  setTimeout(() => void enableTemporary(), 700);
  setTimeout(() => void enableTemporary(), 1500);
})();
