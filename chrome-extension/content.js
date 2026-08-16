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

  function findFileInput() {
    const inputs =
      [
        ...document.querySelectorAll(
          'input[type="file"]'
        )
      ].filter(
        input =>
          !input.disabled
      );

    if (!inputs.length) {
      return null;
    }

    const imageInput =
      inputs.find(
        input => {
          const accept =
            (
              input.getAttribute(
                "accept"
              ) || ""
            ).toLowerCase();

          return (
            !accept ||
            accept.includes(
              "image"
            ) ||
            accept.includes(
              "*"
            )
          );
        }
      );

    return (
      imageInput ??
      inputs[
        inputs.length - 1
      ]
    );
  }

  async function waitForFileInput() {
    for (
      let attempt = 0;
      attempt < 60;
      attempt++
    ) {
      const input =
        findFileInput();

      if (input) {
        return input;
      }

      await sleep(200);
    }

    throw new Error(
      "ChatGPT file input was not found."
    );
  }

  async function dataUrlToFile(
    attachment
  ) {
    if (
      attachment?.kind !==
        "image" ||
      attachment?.source_type !==
        "data_url" ||
      typeof attachment.data_url !==
        "string"
    ) {
      throw new Error(
        "Unsupported browser attachment."
      );
    }

    const response =
      await fetch(
        attachment.data_url
      );

    if (!response.ok) {
      throw new Error(
        "Unable to decode image attachment."
      );
    }

    const blob =
      await response.blob();

    if (
      !blob.type.startsWith(
        "image/"
      )
    ) {
      throw new Error(
        "Decoded attachment is not an image."
      );
    }

    return new File(
      [blob],
      attachment.filename ||
        "router-image.png",
      {
        type:
          attachment.mime_type ||
          blob.type,

        lastModified:
          Date.now()
      }
    );
  }

  async function uploadAttachments(
    attachments
  ) {
    if (
      !Array.isArray(
        attachments
      ) ||
      attachments.length === 0
    ) {
      return;
    }

    for (
      const attachment of
      attachments
    ) {
      const file =
        await dataUrlToFile(
          attachment
        );

      const input =
        await waitForFileInput();

      const transfer =
        new DataTransfer();

      transfer.items.add(
        file
      );

      try {
        input.files =
          transfer.files;
      } catch {
        const descriptor =
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "files"
          );

        descriptor?.set?.call(
          input,
          transfer.files
        );
      }

      input.dispatchEvent(
        new Event(
          "input",
          {
            bubbles: true
          }
        )
      );

      input.dispatchEvent(
        new Event(
          "change",
          {
            bubbles: true
          }
        )
      );

      /*
        Give ChatGPT's frontend time to
        consume the File and create its
        upload/preview state before the
        prompt is submitted.
      */
      await sleep(1800);
    }
  }

  function composerText(
    composer
  ) {
    if (!composer) {
      return "";
    }

    if (
      composer instanceof
      HTMLTextAreaElement
    ) {
      return (
        composer.value || ""
      ).trim();
    }

    return (
      composer.innerText ||
      composer.textContent ||
      ""
    ).trim();
  }

  async function waitForComposer() {
    for (
      let attempt = 0;
      attempt < 60;
      attempt++
    ) {
      const composer =
        findComposer();

      if (
        composer &&
        document.contains(
          composer
        )
      ) {
        return composer;
      }

      await sleep(200);
    }

    return null;
  }

  function collectComposerDiagnostics(
    expected
  ) {
    const selectors = [
      "#prompt-textarea",
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      '.ProseMirror[contenteditable="true"]',
      "textarea"
    ];

    const truncate =
      (value, limit = 350) => {
        const text =
          String(
            value ?? ""
          );

        return (
          text.length > limit
            ? text.slice(
                0,
                limit
              ) + "...<truncated>"
            : text
        );
      };

    const candidates = [];

    for (
      const selector of selectors
    ) {
      let nodes = [];

      try {
        nodes =
          [
            ...document.querySelectorAll(
              selector
            )
          ];
      } catch {}

      for (
        let index = 0;
        index < nodes.length;
        index++
      ) {
        const node =
          nodes[index];

        let style = null;

        try {
          style =
            getComputedStyle(
              node
            );
        } catch {}

        const rect =
          node.getBoundingClientRect?.();

        candidates.push({
          selector,
          index,

          tag:
            node.tagName,

          id:
            node.id || null,

          connected:
            node.isConnected,

          visible:
            visible(node),

          role:
            node.getAttribute?.(
              "role"
            ),

          contenteditable:
            node.getAttribute?.(
              "contenteditable"
            ),

          lexical:
            node.getAttribute?.(
              "data-lexical-editor"
            ),

          placeholder:
            node.getAttribute?.(
              "placeholder"
            ),

          aria_label:
            node.getAttribute?.(
              "aria-label"
            ),

          value:
            truncate(
              node.value
            ),

          inner_text:
            truncate(
              node.innerText
            ),

          text_content:
            truncate(
              node.textContent
            ),

          html:
            truncate(
              node.outerHTML,
              700
            ),

          display:
            style?.display ??
            null,

          visibility:
            style?.visibility ??
            null,

          rect:
            rect
              ? {
                  x:
                    Math.round(
                      rect.x
                    ),

                  y:
                    Math.round(
                      rect.y
                    ),

                  width:
                    Math.round(
                      rect.width
                    ),

                  height:
                    Math.round(
                      rect.height
                    )
                }
              : null
        });
      }
    }

    const selected =
      findComposer();

    return {
      expected:
        truncate(
          expected,
          500
        ),

      url:
        location.href,

      title:
        document.title,

      candidate_count:
        candidates.length,

      selected:
        selected
          ? {
              tag:
                selected.tagName,

              id:
                selected.id ||
                null,

              role:
                selected.getAttribute?.(
                  "role"
                ),

              contenteditable:
                selected.getAttribute?.(
                  "contenteditable"
                ),

              lexical:
                selected.getAttribute?.(
                  "data-lexical-editor"
                ),

              value:
                truncate(
                  selected.value
                ),

              inner_text:
                truncate(
                  selected.innerText
                ),

              text_content:
                truncate(
                  selected.textContent
                ),

              html:
                truncate(
                  selected.outerHTML,
                  900
                )
            }
          : null,

      candidates:
        candidates.slice(
          0,
          12
        )
    };
  }
  function normalizePromptVerificationText(
    value
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u00a0/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }
  async function fillAndVerifyPrompt(
    prompt,
    maxAttempts = 30
  ) {
    const expected =
      normalizePromptVerificationText(
        prompt
      );

    if (!expected) {
      return await waitForComposer();
    }

    for (
      let attempt = 0;
      attempt < maxAttempts;
      attempt++
    ) {
      const composer =
        await waitForComposer();

      if (!composer) {
        await sleep(300);
        continue;
      }

      const before =
        normalizePromptVerificationText(
          composerText(
            composer
          )
        );

      if (
        before === expected ||
        before.includes(
          expected
        )
      ) {
        return composer;
      }

      fill(
        composer,
        prompt
      );

      await sleep(400);

      const newestComposer =
        findComposer() ||
        composer;

      const current =
        normalizePromptVerificationText(
          composerText(
            newestComposer
          )
        );

      if (
        current === expected ||
        current.includes(
          expected
        )
      ) {
        return newestComposer;
      }

      await sleep(350);
    }

    const diagnostic =
      collectComposerDiagnostics(
        expected
      );

    console.error(
      "[Router composer diagnostic]",
      diagnostic
    );

    throw new Error(
      "Prompt was not retained in the ChatGPT composer. ROUTER_DOM_DIAGNOSTIC=" +
      JSON.stringify(
        diagnostic
      )
    );
  }

  async function ensurePromptAfterUpload(
    prompt
  ) {
    const expected =
      normalizePromptVerificationText(
        prompt
      );

    if (!expected) {
      return await waitForComposer();
    }

    /*
      Attachment processing can replace
      the editor several times. First give
      the UI time to settle and check
      whether text entered before upload
      survived the rerender.
    */
    for (
      let attempt = 0;
      attempt < 20;
      attempt++
    ) {
      const composer =
        findComposer();

      if (
        composer &&
        document.contains(
          composer
        )
      ) {
        const current =
          composerText(
            composer
          );

        if (
          current === expected ||
          current.includes(
            expected
          )
        ) {
          return composer;
        }
      }

      await sleep(400);
    }

    /*
      If ChatGPT lost the text during its
      attachment rerender, insert it again
      only after that rerender has settled.
    */
    return await fillAndVerifyPrompt(
      prompt,
      40
    );
  }

  async function sendPrompt(
    prompt,
    attachments = []
  ) {
    /*
      ChatGPT's normal user flow is:
      type text -> attach file -> send.

      Verify the prompt BEFORE upload.
      Attachment rendering can replace or wrap
      the editor DOM, so we intentionally do not
      require composerText() to match afterwards.
    */
    const initialComposer =
      await fillAndVerifyPrompt(
        prompt,
        30
      );

    if (!initialComposer) {
      return false;
    }

    if (
      Array.isArray(
        attachments
      ) &&
      attachments.length > 0
    ) {
      await uploadAttachments(
        attachments
      );

      /*
        Let ChatGPT finish attachment/preview
        rendering before looking for Send.
      */
      await sleep(1500);
    }

    for (
      let attempt = 0;
      attempt < 60;
      attempt++
    ) {
      const composer =
        findComposer() ||
        initialComposer;

      const send =
        findSendButton(
          composer
        );

      if (send) {
        await sleep(250);
        send.click();
        return true;
      }

      await sleep(200);
    }

    /*
      Last fallback: Enter on whichever current
      composer exists. Prompt was already verified
      before attachment upload.
    */
    const finalComposer =
      findComposer() ||
      initialComposer;

    if (!finalComposer) {
      return false;
    }

    finalComposer.focus();

    finalComposer.dispatchEvent(
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

  function expectedToolProtocolEndMarker(
    prompt
  ) {
    const match =
      String(
        prompt ?? ""
      ).match(
        /ROUTER_TOOL_V1_END_[A-Za-z0-9_-]+/
      );

    return (
      match?.[0] ??
      null
    );
  }

  async function waitForResponse(
    prompt = ""
  ) {
    const expectedEndMarker =
      expectedToolProtocolEndMarker(
        prompt
      );

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

        /*
          Structured tool responses have a unique
          nonce-delimited END marker in the prompt.

          Do not trust generic "generation stopped"
          UI detection while that marker is still
          missing: ChatGPT can temporarily leave a
          partially-rendered marker stable long enough
          for the old polling logic to return it.
        */
        if (expectedEndMarker) {
          if (
            text.includes(
              expectedEndMarker
            ) &&
            stableCount >= 3
          ) {
            return text;
          }
          /*
            For structured tool output, completion is
            deterministic: the exact nonce END marker
            must appear. Do not return a stable partial
            response just because rendering pauses.

            If the model never emits the marker, the
            normal overall response timeout will report
            the failure instead of sending truncated
            structured data to the strict parser.
          */
        } else if (
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
          job.prompt,
          job.attachments ?? []
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
        await waitForResponse(job.prompt);

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
