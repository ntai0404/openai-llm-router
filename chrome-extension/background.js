const DEMO_URL =
  "https://chatgpt.com/?temporary-chat=true&router-demo=1";

chrome.action.onClicked.addListener(async () => {
  const tab = await chrome.tabs.create({
    url: DEMO_URL,
    active: true
  });

  if (tab.id) {
    chrome.action.setBadgeText({
      tabId: tab.id,
      text: "..."
    });
  }
});

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    if (message?.type === "GET_ROUTER_JOB") {
      const { id, token } = message;

      fetch(
        `http://127.0.0.1:8788/internal/jobs/${encodeURIComponent(id)}`,
        {
          headers: {
            "x-router-job-token": token
          }
        }
      )
        .then(async response => {
          const data = await response.json();

          if (!response.ok) {
            throw new Error(
              data.error || "Unable to read router job."
            );
          }

          sendResponse({
            ok: true,
            job: data
          });
        })
        .catch(error => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      return true;
    }

    if (message?.type === "MARK_ROUTER_JOB_SENT") {
      const { id, token } = message;

      fetch(
        `http://127.0.0.1:8788/internal/jobs/${encodeURIComponent(id)}/sent`,
        {
          method: "POST",
          headers: {
            "x-router-job-token": token
          }
        }
      )
        .then(() => {
          if (tabId) {
            chrome.action.setBadgeText({
              tabId,
              text: "OK"
            });
          }

          sendResponse({ ok: true });
        })
        .catch(error => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      return true;
    }

    if (message?.type === "PROMPT_SENT") {
      if (tabId) {
        chrome.action.setBadgeText({
          tabId,
          text: "OK"
        });
      }
    }

    if (message?.type === "PROMPT_FAILED") {
      if (tabId) {
        chrome.action.setBadgeText({
          tabId,
          text: "!"
        });
      }
    }
  }
);
