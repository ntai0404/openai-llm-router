(() => {
  let running = false;
  let done = false;
  let currentUrl = location.href;

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function normalize(value) {
    return (value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisible(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function getLabel(element) {
    return normalize([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("data-testid"),
      element.textContent
    ].filter(Boolean).join(" "));
  }

  function clickableElements() {
    return [
      ...document.querySelectorAll(
        [
          "button",
          "[role='button']",
          "[role='menuitem']",
          "[role='option']",
          "a",
          "[data-testid*='temporary' i]"
        ].join(",")
      )
    ].filter(isVisible);
  }

  function isNewChat() {
    const path =
      location.pathname.replace(/\/+$/, "") || "/";

    return path === "/";
  }

  function temporaryAlreadyEnabled() {
    return clickableElements().some(element => {
      const label = getLabel(element);

      return (
        element.getAttribute("aria-pressed") === "true" &&
        label.includes("temporary")
      ) || (
        element.getAttribute("aria-checked") === "true" &&
        label.includes("temporary")
      ) ||
        /turn off temporary|disable temporary|temporary chat on|temporary enabled/.test(label);
    });
  }

  function findTemporaryBySemanticLabel() {
    const explicitSelectors = [
      '[aria-label*="temporary" i]',
      '[title*="temporary" i]',
      '[data-testid*="temporary" i]'
    ];

    for (const selector of explicitSelectors) {
      const candidate =
        [...document.querySelectorAll(selector)]
          .find(isVisible);

      if (candidate) {
        return (
          candidate.closest(
            "button,[role='button'],a"
          ) || candidate
        );
      }
    }

    return clickableElements().find(element => {
      const label = getLabel(element);

      return (
        /temporary chat/.test(label) ||
        /^temporary$/.test(label) ||
        /turn on temporary/.test(label) ||
        /start temporary/.test(label) ||
        /enable temporary/.test(label)
      );
    });
  }

  /*
    Current ChatGPT UI can render Temporary as an icon-only control.

    On New Chat, the Temporary control is in the upper-right area
    of the ChatGPT document.

    This fallback NEVER looks inside the sidebar and only considers
    small clickable controls at the extreme upper-right of the page.
  */
  function findTemporaryByPosition() {
    const candidates = clickableElements()
      .map(element => ({
        element,
        rect: element.getBoundingClientRect(),
        label: getLabel(element)
      }))
      .filter(({ rect, label }) => {
        const rightSide =
          rect.left > window.innerWidth - 180;

        const topArea =
          rect.top >= 0 &&
          rect.top < 120;

        const sensibleSize =
          rect.width >= 20 &&
          rect.width <= 120 &&
          rect.height >= 20 &&
          rect.height <= 80;

        const clearlyWrong =
          /profile|account|sidebar|share|close/.test(label);

        return (
          rightSide &&
          topArea &&
          sensibleSize &&
          !clearlyWrong
        );
      });

    candidates.sort((a, b) => {
      const aDistance =
        (window.innerWidth - a.rect.right) +
        a.rect.top;

      const bDistance =
        (window.innerWidth - b.rect.right) +
        b.rect.top;

      return aDistance - bDistance;
    });

    return candidates[0]?.element || null;
  }

  async function report(type) {
    try {
      await chrome.runtime.sendMessage({ type });
    } catch {}
  }

  async function clickTemporary() {
    if (running || done || !isNewChat()) return;

    running = true;

    try {
      /*
        Give the React app enough time to hydrate.
      */
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!isNewChat()) return;

        if (temporaryAlreadyEnabled()) {
          done = true;
          await report("TEMPORARY_OK");
          return;
        }

        let target =
          findTemporaryBySemanticLabel();

        /*
          Only use positional fallback after UI has had
          some time to render.
        */
        if (!target && attempt >= 4) {
          target =
            findTemporaryByPosition();
        }

        if (target) {
          target.click();

          await sleep(700);

          done = true;
          await report("TEMPORARY_OK");

          console.log(
            "[Auto Temporary] Temporary control clicked",
            target
          );

          return;
        }

        await sleep(250);
      }

      await report("TEMPORARY_FAILED");

      console.warn(
        "[Auto Temporary] Temporary control not found."
      );
    } finally {
      running = false;
    }
  }

  function handleNavigation() {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      done = false;
    }

    void clickTemporary();
  }

  const observer =
    new MutationObserver(handleNavigation);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  for (const method of [
    "pushState",
    "replaceState"
  ]) {
    const original = history[method];

    history[method] = function (...args) {
      const result =
        original.apply(this, args);

      queueMicrotask(handleNavigation);

      return result;
    };
  }

  addEventListener(
    "popstate",
    handleNavigation
  );

  /*
    Initial hydration retries.
  */
  setTimeout(
    () => void clickTemporary(),
    300
  );

  setTimeout(
    () => void clickTemporary(),
    1000
  );

  setTimeout(
    () => void clickTemporary(),
    2000
  );
})();
