(() => {
  const params =
    new URLSearchParams(location.search);

  if (params.get("router-demo") !== "1") {
    return;
  }

  const jobId =
    params.get("router-job");

  const jobToken =
    params.get("router-token");

  const FALLBACK_PROMPT =
    "Explain quantum computing in one sentence.";

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function visible(el) {
    if (!el) return false;

    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);

    return (
      r.width > 0 &&
      r.height > 0 &&
      s.display !== "none" &&
      s.visibility !== "hidden"
    );
  }

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      '.ProseMirror[contenteditable="true"]',
      "textarea"
    ];

    for (const selector of selectors) {
      const matches =
        [...document.querySelectorAll(selector)]
          .filter(visible);

      if (matches.length) {
        return matches[matches.length - 1];
      }
    }

    return null;
  }

  function fillTextarea(el, text) {
    const proto = Object.getPrototypeOf(el);

    const descriptor =
      Object.getOwnPropertyDescriptor(
        proto,
        "value"
      );

    if (descriptor?.set) {
      descriptor.set.call(el, text);
    } else {
      el.value = text;
    }

    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      })
    );

    el.dispatchEvent(
      new Event("change", {
        bubbles: true
      })
    );
  }

  function fillContentEditable(el, text) {
    el.focus();

    const selection =
      window.getSelection();

    const range =
      document.createRange();

    range.selectNodeContents(el);

    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;

    try {
      inserted =
        document.execCommand(
          "insertText",
          false,
          text
        );
    } catch {}

    if (!inserted) {
      el.textContent = text;

      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text
        })
      );
    }

    el.dispatchEvent(
      new Event("change", {
        bubbles: true
      })
    );
  }

  function findSendButton(composer) {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="send prompt" i]',
      'button[aria-label*="send message" i]',
      'button[aria-label="Send"]',
      'button[type="submit"]'
    ];

    for (const selector of selectors) {
      const button =
        [...document.querySelectorAll(selector)]
          .find(el =>
            visible(el) &&
            !el.disabled &&
            el.getAttribute("aria-disabled") !== "true"
          );

      if (button) {
        return button;
      }
    }

    if (!composer) return null;

    const cr =
      composer.getBoundingClientRect();

    const candidates =
      [...document.querySelectorAll("button")]
        .filter(button => {
          if (
            !visible(button) ||
            button.disabled ||
            button.getAttribute("aria-disabled") === "true"
          ) {
            return false;
          }

          const r =
            button.getBoundingClientRect();

          return (
            r.left >= cr.left &&
            r.right <= cr.right + 100 &&
            r.top >= cr.top - 30 &&
            r.bottom <= cr.bottom + 30 &&
            r.width >= 30 &&
            r.width <= 80 &&
            r.height >= 30 &&
            r.height <= 80
          );
        });

    candidates.sort(
      (a, b) =>
        b.getBoundingClientRect().left -
        a.getBoundingClientRect().left
    );

    return candidates[0] || null;
  }

  async function getPrompt() {
    if (!jobId || !jobToken) {
      return FALLBACK_PROMPT;
    }

    const response =
      await chrome.runtime.sendMessage({
        type: "GET_ROUTER_JOB",
        id: jobId,
        token: jobToken
      });

    if (!response?.ok) {
      throw new Error(
        response?.error || "Unable to load prompt."
      );
    }

    return response.job.prompt;
  }

  async function sendPrompt(prompt) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const composer =
        findComposer();

      if (!composer) {
        await sleep(200);
        continue;
      }

      composer.focus();

      if (
        composer instanceof
        HTMLTextAreaElement
      ) {
        fillTextarea(
          composer,
          prompt
        );
      } else {
        fillContentEditable(
          composer,
          prompt
        );
      }

      await sleep(500);

      const current =
        (
          composer.value ||
          composer.innerText ||
          composer.textContent ||
          ""
        ).trim();

      if (!current) {
        await sleep(200);
        continue;
      }

      for (let i = 0; i < 30; i++) {
        const send =
          findSendButton(composer);

        if (send) {
          send.click();

          return true;
        }

        await sleep(150);
      }

      composer.focus();

      composer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        })
      );

      return true;
    }

    return false;
  }

  async function run() {
    try {
      const prompt =
        await getPrompt();

      const sent =
        await sendPrompt(prompt);

      if (!sent) {
        throw new Error(
          "Could not send prompt."
        );
      }

      if (jobId && jobToken) {
        await chrome.runtime.sendMessage({
          type: "MARK_ROUTER_JOB_SENT",
          id: jobId,
          token: jobToken
        });
      } else {
        await chrome.runtime.sendMessage({
          type: "PROMPT_SENT"
        });
      }

      console.log(
        "[Router Demo] Dynamic prompt sent:",
        prompt
      );
    } catch (error) {
      console.error(
        "[Router Demo]",
        error
      );

      try {
        await chrome.runtime.sendMessage({
          type: "PROMPT_FAILED"
        });
      } catch {}
    }
  }

  void run();
})();
