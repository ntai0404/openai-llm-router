(() => {
  const DEMO_PROMPT = "Explain quantum computing in one sentence.";

  const params = new URLSearchParams(location.search);

  if (params.get("router-demo") !== "1") {
    return;
  }

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
      const els = [...document.querySelectorAll(selector)]
        .filter(visible);

      if (els.length) {
        return els[els.length - 1];
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

    /*
      Fallback for ChatGPT layouts where the send arrow
      does not expose a stable selector.
      Search buttons close to the composer on its right side.
    */
    if (composer) {
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

      candidates.sort((a, b) =>
        b.getBoundingClientRect().left -
        a.getBoundingClientRect().left
      );

      return candidates[0] || null;
    }

    return null;
  }

  async function sendMessage(composer) {
    /*
      Wait for ChatGPT/React to recognize the new prompt
      and enable the Send button.
    */
    for (let i = 0; i < 30; i++) {
      const sendButton =
        findSendButton(composer);

      if (sendButton) {
        sendButton.focus();
        sendButton.click();

        console.log(
          "[Router Demo] Send clicked.",
          sendButton
        );

        return true;
      }

      await sleep(150);
    }

    /*
      Last-resort fallback: submit with Enter.
    */
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

    composer.dispatchEvent(
      new KeyboardEvent("keyup", {
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

  async function run() {
    for (let i = 0; i < 50; i++) {
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
          DEMO_PROMPT
        );
      } else {
        fillContentEditable(
          composer,
          DEMO_PROMPT
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

      if (
        current.includes(
          "Explain quantum computing"
        )
      ) {
        console.log(
          "[Router Demo] Prompt filled."
        );

        await sleep(500);

        const sent =
          await sendMessage(composer);

        if (sent) {
          try {
            chrome.runtime.sendMessage({
              type: "PROMPT_FILLED"
            });
          } catch {}

          console.log(
            "[Router Demo] Prompt sent."
          );

          return;
        }
      }

      await sleep(250);
    }

    try {
      chrome.runtime.sendMessage({
        type: "PROMPT_FAILED"
      });
    } catch {}

    console.error(
      "[Router Demo] Failed to fill/send."
    );
  }

  void run();
})();
