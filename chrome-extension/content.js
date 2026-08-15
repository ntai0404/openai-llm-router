(() => {
  const DEMO_PROMPT =
    "Explain quantum computing in one sentence.";

  const params =
    new URLSearchParams(location.search);

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
      r.width > 100 &&
      r.height > 20 &&
      s.display !== "none" &&
      s.visibility !== "hidden"
    );
  }

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      '.ProseMirror[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const matches =
        [...document.querySelectorAll(selector)]
          .filter(visible);

      if (matches.length) {
        matches.sort((a, b) => {
          return (
            b.getBoundingClientRect().top -
            a.getBoundingClientRect().top
          );
        });

        return matches[0];
      }
    }

    return null;
  }

  function fillTextarea(el, text) {
    const prototype =
      Object.getPrototypeOf(el);

    const descriptor =
      Object.getOwnPropertyDescriptor(
        prototype,
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

  async function run() {
    /*
      Wait for Temporary Chat UI + composer hydration.
    */
    for (let i = 0; i < 40; i++) {
      const composer =
        findComposer();

      if (composer) {
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

        await sleep(300);

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
          chrome.runtime.sendMessage({
            type: "PROMPT_FILLED"
          });

          console.log(
            "[Router Demo] Prompt filled."
          );

          return;
        }
      }

      await sleep(250);
    }

    chrome.runtime.sendMessage({
      type: "PROMPT_FAILED"
    });

    console.error(
      "[Router Demo] Composer not found."
    );
  }

  void run();
})();
