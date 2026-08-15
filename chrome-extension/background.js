const TEMP_URL =
  "https://chatgpt.com/?temporary-chat=true";

async function localFetch(path, options = {}) {
  const response =
    await fetch(`http://127.0.0.1:8788${path}`, options);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Local bridge request failed.");
  }

  return data;
}

chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({
    url: TEMP_URL,
    active: true
  });
});

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    if (message?.type === "GET_ROUTER_JOB") {
      localFetch(
        `/internal/jobs/${encodeURIComponent(message.id)}`,
        {
          headers: {
            "x-router-job-token": message.token
          }
        }
      )
        .then(job => sendResponse({ ok: true, job }))
        .catch(error =>
          sendResponse({ ok: false, error: error.message })
        );

      return true;
    }

    if (message?.type === "MARK_ROUTER_JOB_SENT") {
      localFetch(
        `/internal/jobs/${encodeURIComponent(message.id)}/sent`,
        {
          method: "POST",
          headers: {
            "x-router-job-token": message.token
          }
        }
      )
        .then(data => {
          if (tabId) {
            chrome.action.setBadgeText({
              tabId,
              text: "..."
            });
          }

          sendResponse({ ok: true, data });
        })
        .catch(error =>
          sendResponse({ ok: false, error: error.message })
        );

      return true;
    }

    if (message?.type === "SUBMIT_ROUTER_RESULT") {
      localFetch(
        `/internal/jobs/${encodeURIComponent(message.id)}/result`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-router-job-token": message.token
          },
          body: JSON.stringify({
            response: message.response
          })
        }
      )
        .then(data => {
          if (tabId) {
            chrome.action.setBadgeText({
              tabId,
              text: "OK"
            });
          }

          sendResponse({ ok: true, data });
        })
        .catch(error =>
          sendResponse({ ok: false, error: error.message })
        );

      return true;
    }

    if (message?.type === "MARK_ROUTER_JOB_ERROR") {
      localFetch(
        `/internal/jobs/${encodeURIComponent(message.id)}/error`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-router-job-token": message.token
          },
          body: JSON.stringify({
            error: message.error
          })
        }
      ).catch(() => {});

      if (tabId) {
        chrome.action.setBadgeText({
          tabId,
          text: "!"
        });
      }

      sendResponse({ ok: true });
      return true;
    }
  }
);
