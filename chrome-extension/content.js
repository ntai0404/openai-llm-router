(() => {
  let running = false;

  const sleep = ms =>
    new Promise(resolve =>
      setTimeout(resolve, ms)
    );

  function visible(el) {
    if (!el) return false;

    const r =
      el.getBoundingClientRect();

    const s =
      getComputedStyle(el);

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
      const found =
        [
          ...document.querySelectorAll(
            selector
          )
        ].filter(visible);

      if (found.length) {
        return found[
          found.length - 1
        ];
      }
    }

    return null;
  }

  function fill(
    el,
    text
  ) {
    el.focus();

    if (
      el instanceof
      HTMLTextAreaElement
    ) {
      const proto =
        Object.getPrototypeOf(el);

      const descriptor =
        Object.getOwnPropertyDescriptor(
          proto,
          "value"
        );

      if (descriptor?.set) {
        descriptor.set.call(
          el,
          text
        );
      } else {
        el.value =
          text;
      }

      el.dispatchEvent(
        new InputEvent(
          "input",
          {
            bubbles: true,
            inputType:
              "insertText",
            data: text
          }
        )
      );

      return;
    }

    const selection =
      window.getSelection();

    const range =
      document.createRange();

    range.selectNodeContents(
      el
    );

    selection.removeAllRanges();

    selection.addRange(
      range
    );

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
      el.textContent =
        text;

      el.dispatchEvent(
        new InputEvent(
          "input",
          {
            bubbles: true,
            inputType:
              "insertText",
            data: text
          }
        )
      );
    }
  }

  function findSendButton(
    composer
  ) {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="send prompt" i]',
      'button[aria-label*="send message" i]',
      'button[aria-label="Send"]',
      'button[type="submit"]'
    ];

    for (
      const selector of selectors
    ) {
      const button =
        [
          ...document.querySelectorAll(
            selector
          )
        ].find(
          el =>
            visible(el) &&
            !el.disabled &&
            el.getAttribute(
              "aria-disabled"
            ) !== "true"
        );

      if (button) {
        return button;
      }
    }

    if (!composer) {
      return null;
    }

    const cr =
      composer.getBoundingClientRect();

    const candidates =
      [
        ...document.querySelectorAll(
          "button"
        )
      ].filter(
        button => {
          if (
            !visible(button) ||
            button.disabled ||
            button.getAttribute(
              "aria-disabled"
            ) === "true"
          ) {
            return false;
          }

          const r =
            button.getBoundingClientRect();

          return (
            r.left >= cr.left &&
            r.right <=
              cr.right + 100 &&
            r.top >=
              cr.top - 30 &&
            r.bottom <=
              cr.bottom + 30 &&
            r.width >= 30 &&
            r.width <= 80 &&
            r.height >= 30 &&
            r.height <= 80
          );
        }
      );

    candidates.sort(
      (a, b) =>
        b.getBoundingClientRect()
          .left -
        a.getBoundingClientRect()
          .left
    );

    return (
      candidates[0] ||
      null
    );
  }

  function assistantElements() {
    const direct =
      [
        ...document.querySelectorAll(
          '[data-message-author-role="assistant"]'
        )
      ].filter(visible);

    if (direct.length) {
      return direct;
    }

    return [
      ...document.querySelectorAll(
        'article[data-testid^="conversation-turn-"]'
      )
    ].filter(
      el => {
        if (!visible(el)) {
          return false;
        }

        return !el.querySelector(
          '[data-message-author-role="user"]'
        );
      }
    );
  }

  function latestAssistantText() {
    const items =
      assistantElements();

    if (!items.length) {
      return "";
    }

    const last =
      items[
        items.length - 1
      ];

    return (
      last.innerText ||
      last.textContent ||
      ""
    ).trim();
  }

  function isGenerating() {
    const selectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="stop generating" i]',
      'button[aria-label*="stop response" i]'
    ];

    return selectors.some(
      selector =>
        [
          ...document.querySelectorAll(
            selector
          )
        ].some(visible)
    );
  }

  async function sendPrompt(
    prompt
  ) {
    for (
      let attempt = 0;
      attempt < 60;
      attempt++
    ) {
      const composer =
        findComposer();

      if (!composer) {
        await sleep(200);
        continue;
      }

      fill(
        composer,
        prompt
      );

      await sleep(500);

      for (
        let i = 0;
        i < 30;
        i++
      ) {
        const send =
          findSendButton(
            composer
          );

        if (send) {
          send.click();
          return true;
        }

        await sleep(150);
      }

      composer.focus();

      composer.dispatchEvent(
        new KeyboardEvent(
          "keydown",
          {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          }
        )
      );

      return true;
    }

    return false;
  }

  async function waitForResponse() {
    let lastText = "";
    let stableCount = 0;

    for (
      let i = 0;
      i < 600;
      i++
    ) {
      const text =
        latestAssistantText();

      if (text) {
        if (
          text === lastText
        ) {
          stableCount++;
        } else {
          lastText =
            text;

          stableCount = 0;
        }

        if (
          stableCount >= 4 &&
          !isGenerating()
        ) {
          return text;
        }
      }

      await sleep(500);
    }

    throw new Error(
      "Timed out waiting for ChatGPT response."
    );
  }

  async function runJob(
    job
  ) {
    try {
      const sent =
        await sendPrompt(
          job.prompt
        );

      if (!sent) {
        throw new Error(
          "Unable to send prompt."
        );
      }

      const sentResult =
        await chrome.runtime.sendMessage(
          {
            type:
              "MARK_ROUTER_JOB_SENT",
            id: job.id,
            token:
              job.token
          }
        );

      if (!sentResult?.ok) {
        throw new Error(
          sentResult?.error ||
          "Unable to mark job sent."
        );
      }

      const response =
        await waitForResponse();

      const result =
        await chrome.runtime.sendMessage(
          {
            type:
              "SUBMIT_ROUTER_RESULT",
            id: job.id,
            token:
              job.token,
            response
          }
        );

      if (!result?.ok) {
        throw new Error(
          result?.error ||
          "Unable to submit response."
        );
      }
    } catch (error) {
      try {
        await chrome.runtime.sendMessage(
          {
            type:
              "MARK_ROUTER_JOB_ERROR",
            id: job.id,
            token:
              job.token,
            error:
              error.message
          }
        );
      } catch {}
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener(
    (
      message,
      _sender,
      sendResponse
    ) => {
      if (
        message?.type !==
        "RUN_JOB"
      ) {
        return;
      }

      if (running) {
        sendResponse({
          ok: false,
          error:
            "Worker is already busy."
        });

        return;
      }

      running = true;

      sendResponse({
        ok: true
      });

      void runJob(
        message.job
      );
    }
  );
})();
