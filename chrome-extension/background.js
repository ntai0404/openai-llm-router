const WS_URL =
  "ws://127.0.0.1:8788/extension";

const HTTP_BASE =
  "http://127.0.0.1:8788";

const TEMP_URL =
  "https://chatgpt.com/?temporary-chat=true&router-worker=1";

let socket = null;
let reconnectTimer = null;
let keepAliveTimer = null;

let workerTabId = null;
let workerBusy = false;
let returnTabId = null;

const pendingJobs = [];

const sleep = ms =>
  new Promise(resolve =>
    setTimeout(resolve, ms)
  );

async function loadWorkerState() {
  const state =
    await chrome.storage.local.get([
      "workerTabId"
    ]);

  workerTabId =
    state.workerTabId || null;

  if (workerTabId) {
    try {
      await chrome.tabs.get(
        workerTabId
      );
    } catch {
      workerTabId = null;

      await chrome.storage.local.remove(
        "workerTabId"
      );
    }
  }
}

async function localFetch(
  path,
  options = {}
) {
  const response =
    await fetch(
      `${HTTP_BASE}${path}`,
      options
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      "Local bridge request failed."
    );
  }

  return data;
}

function connectSocket() {
  if (
    socket &&
    (
      socket.readyState ===
        WebSocket.OPEN ||
      socket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return;
  }

  clearTimeout(
    reconnectTimer
  );

  try {
    socket =
      new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    console.log(
      "[Router] Bridge connected"
    );

    clearInterval(
      keepAliveTimer
    );

    keepAliveTimer =
      setInterval(
        () => {
          if (
            socket?.readyState ===
            WebSocket.OPEN
          ) {
            socket.send(
              JSON.stringify({
                type: "keepalive",
                time: Date.now()
              })
            );
          }
        },
        20000
      );
  };

  socket.onmessage =
    event => {
      let message;

      try {
        message =
          JSON.parse(
            event.data
          );
      } catch {
        return;
      }

      if (
        message.type ===
          "job" &&
        message.job
      ) {
        pendingJobs.push(
          message.job
        );

        void pumpQueue();
      }
    };

  socket.onclose = () => {
    socket = null;

    clearInterval(
      keepAliveTimer
    );

    keepAliveTimer = null;

    scheduleReconnect();
  };

  socket.onerror = () => {
    try {
      socket.close();
    } catch {}
  };
}

function scheduleReconnect() {
  clearTimeout(
    reconnectTimer
  );

  reconnectTimer =
    setTimeout(
      connectSocket,
      1000
    );
}

async function ensureWorkerTab() {
  if (workerTabId) {
    try {
      return await chrome.tabs.get(
        workerTabId
      );
    } catch {
      workerTabId = null;
    }
  }

  const tab =
    await chrome.tabs.create({
      url: "about:blank",
      active: false,
      pinned: true
    });

  workerTabId =
    tab.id;

  await chrome.storage.local.set({
    workerTabId
  });

  return tab;
}

async function waitForTabComplete(
  tabId,
  timeoutMs = 30000
) {
  try {
    const current =
      await chrome.tabs.get(tabId);

    if (
      current.status ===
      "complete"
    ) {
      return;
    }
  } catch {}

  await new Promise(
    (resolve, reject) => {
      const timer =
        setTimeout(
          () => {
            chrome.tabs.onUpdated.removeListener(
              listener
            );

            reject(
              new Error(
                "Worker tab load timeout."
              )
            );
          },
          timeoutMs
        );

      const listener =
        (
          updatedTabId,
          changeInfo
        ) => {
          if (
            updatedTabId ===
              tabId &&
            changeInfo.status ===
              "complete"
          ) {
            clearTimeout(
              timer
            );

            chrome.tabs.onUpdated.removeListener(
              listener
            );

            resolve();
          }
        };

      chrome.tabs.onUpdated.addListener(
        listener
      );
    }
  );
}

async function sendToWorker(
  tabId,
  message
) {
  let lastError;

  for (
    let attempt = 0;
    attempt < 30;
    attempt++
  ) {
    try {
      return await chrome.tabs.sendMessage(
        tabId,
        message
      );
    } catch (error) {
      lastError = error;

      await sleep(200);
    }
  }

  throw (
    lastError ||
    new Error(
      "Worker content script unavailable."
    )
  );
}

async function rememberReturnTab() {
  try {
    const tabs =
      await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      });

    const tab = tabs[0];

    if (
      tab?.id &&
      tab.id !== workerTabId
    ) {
      returnTabId =
        tab.id;
    }
  } catch {}
}

async function restoreUserTab() {
  if (!returnTabId) {
    return;
  }

  try {
    const tab =
      await chrome.tabs.get(
        returnTabId
      );

    await chrome.tabs.update(
      returnTabId,
      {
        active: true
      }
    );

    if (tab.windowId) {
      await chrome.windows.update(
        tab.windowId,
        {
          focused: true
        }
      );
    }
  } catch {}

  returnTabId = null;
}

async function parkWorker() {
  if (!workerTabId) {
    return;
  }

  await restoreUserTab();

  try {
    await chrome.tabs.update(
      workerTabId,
      {
        url: "about:blank"
      }
    );

    await waitForTabComplete(
      workerTabId,
      10000
    ).catch(() => {});

    /*
      Best-effort memory release while idle.
      The same tab ID is reused for the
      next job.
    */
    await chrome.tabs.discard(
      workerTabId
    ).catch(() => {});
  } catch {}
}

async function runBrowserJob(job) {
  const tab =
    await ensureWorkerTab();

  await rememberReturnTab();

  await chrome.action.setBadgeText({
    tabId: tab.id,
    text: "..."
  });

  await chrome.tabs.update(
    tab.id,
    {
      url: TEMP_URL,
      active: true
    }
  );

  if (tab.windowId) {
    try {
      await chrome.windows.update(
        tab.windowId,
        {
          focused: true
        }
      );
    } catch {}
  }

  await waitForTabComplete(
    tab.id
  );

  await sleep(500);

  const accepted =
    await sendToWorker(
      tab.id,
      {
        type: "RUN_JOB",
        job
      }
    );

  if (!accepted?.ok) {
    throw new Error(
      accepted?.error ||
      "Worker rejected job."
    );
  }
}

async function pumpQueue() {
  if (
    workerBusy ||
    !pendingJobs.length
  ) {
    return;
  }

  workerBusy = true;

  const job =
    pendingJobs.shift();

  try {
    await runBrowserJob(
      job
    );
  } catch (error) {
    try {
      await localFetch(
        `/internal/jobs/${encodeURIComponent(job.id)}/error`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
            "x-router-job-token":
              job.token
          },
          body: JSON.stringify({
            error:
              error.message
          })
        }
      );
    } catch {}

    await parkWorker();

    workerBusy = false;

    void pumpQueue();
  }
}

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {
    const tabId =
      sender.tab?.id;

    if (
      message?.type ===
      "MARK_ROUTER_JOB_SENT"
    ) {
      localFetch(
        `/internal/jobs/${encodeURIComponent(message.id)}/sent`,
        {
          method: "POST",
          headers: {
            "x-router-job-token":
              message.token
          }
        }
      )
        .then(data =>
          sendResponse({
            ok: true,
            data
          })
        )
        .catch(error =>
          sendResponse({
            ok: false,
            error:
              error.message
          })
        );

      return true;
    }

    if (
      message?.type ===
      "SUBMIT_ROUTER_RESULT"
    ) {
      localFetch(
        `/internal/jobs/${encodeURIComponent(message.id)}/result`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
            "x-router-job-token":
              message.token
          },
          body: JSON.stringify({
            response:
              message.response
          })
        }
      )
        .then(
          async data => {
            if (tabId) {
              await chrome.action.setBadgeText(
                {
                  tabId,
                  text: "OK"
                }
              );
            }

            sendResponse({
              ok: true,
              data
            });

            await sleep(400);

            await parkWorker();

            workerBusy = false;

            void pumpQueue();
          }
        )
        .catch(
          async error => {
            sendResponse({
              ok: false,
              error:
                error.message
            });

            await parkWorker();

            workerBusy = false;

            void pumpQueue();
          }
        );

      return true;
    }

    if (
      message?.type ===
      "MARK_ROUTER_JOB_ERROR"
    ) {
      localFetch(
        `/internal/jobs/${encodeURIComponent(message.id)}/error`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
            "x-router-job-token":
              message.token
          },
          body: JSON.stringify({
            error:
              message.error
          })
        }
      )
        .catch(() => {})
        .finally(
          async () => {
            if (tabId) {
              await chrome.action.setBadgeText(
                {
                  tabId,
                  text: "!"
                }
              );
            }

            sendResponse({
              ok: true
            });

            await parkWorker();

            workerBusy = false;

            void pumpQueue();
          }
        );

      return true;
    }
  }
);

chrome.action.onClicked.addListener(`n  async () => {`n    connectSocket();
    const tab =
      await ensureWorkerTab();

    await chrome.tabs.update(
      tab.id,
      {
        url: TEMP_URL,
        active: true
      }
    );

    if (tab.windowId) {
      try {
        await chrome.windows.update(
          tab.windowId,
          {
            focused: true
          }
        );
      } catch {}
    }
  }
);

chrome.tabs.onRemoved.addListener(
  tabId => {
    if (
      tabId === workerTabId
    ) {
      workerTabId = null;

      chrome.storage.local.remove(
        "workerTabId"
      );
    }
  }
);

void loadWorkerState()
  .finally(
    connectSocket
  );

chrome.runtime.onInstalled.addListener(
  connectSocket
);

chrome.runtime.onStartup.addListener(
  connectSocket
);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "router-ws-reconnect") {
    connectSocket();
  }
});

async function ensureReconnectAlarm() {
  try {
    await chrome.alarms.create(
      "router-ws-reconnect",
      { periodInMinutes: 0.5 }
    );
  } catch {}
}

void ensureReconnectAlarm();
