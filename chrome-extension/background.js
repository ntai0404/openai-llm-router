const WS_URL = "ws://127.0.0.1:8788/extension";
const HTTP_BASE = "http://127.0.0.1:8788";
const PARK_URL = chrome.runtime.getURL("worker.html");
const TEMP_BASE = "https://chatgpt.com/?temporary-chat=true&router-worker=1";
const IDLE_CLOSE_MS = 60000;

let socket = null;
let reconnectTimer = null;
let keepAliveTimer = null;
let idleCloseTimer = null;

let workerTabId = null;
let workerBusy = false;
let returnTabId = null;

const pendingJobs = [];

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function isWorkerUrl(value) {
  if (!value) return false;

  if (value === PARK_URL) {
    return true;
  }

  try {
    const url = new URL(value);

    return (
      url.origin === "https://chatgpt.com" &&
      url.searchParams.get("router-worker") === "1"
    );
  } catch {
    return false;
  }
}

async function localFetch(path, options = {}) {
  const response =
    await fetch(`${HTTP_BASE}${path}`, options);

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

async function reconcileWorkerTab() {
  const stored =
    await chrome.storage.local.get({
      workerTabId: null
    });

  const tabs =
    await chrome.tabs.query({});

  const workers =
    tabs.filter(tab =>
      isWorkerUrl(
        tab.url ||
        tab.pendingUrl ||
        ""
      )
    );

  let keep = null;

  if (stored.workerTabId) {
    keep =
      workers.find(
        tab =>
          tab.id === stored.workerTabId
      ) || null;
  }

  if (!keep && workers.length) {
    keep = workers[0];
  }

  for (const tab of workers) {
    if (
      keep &&
      tab.id &&
      tab.id !== keep.id
    ) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
    }
  }

  if (keep?.id) {
    workerTabId = keep.id;

    await chrome.storage.local.set({
      workerTabId
    });

    try {
      await chrome.tabs.update(
        workerTabId,
        {
          pinned: false
        }
      );
    } catch {}

    return keep;
  }

  workerTabId = null;

  await chrome.storage.local.remove(
    "workerTabId"
  );

  return null;
}

async function ensureWorkerTab() {
  clearTimeout(idleCloseTimer);

  if (workerTabId) {
    try {
      const tab =
        await chrome.tabs.get(workerTabId);

      if (
        isWorkerUrl(
          tab.url ||
          tab.pendingUrl ||
          ""
        )
      ) {
        return tab;
      }
    } catch {}

    workerTabId = null;
  }

  const existing =
    await reconcileWorkerTab();

  if (existing) {
    return existing;
  }

  const tab =
    await chrome.tabs.create({
      url: PARK_URL,
      active: false,
      pinned: false
    });

  workerTabId = tab.id;

  await chrome.storage.local.set({
    workerTabId
  });

  console.log(
    "[Router] worker created",
    workerTabId
  );

  return tab;
}

async function rememberCurrentTab() {
  try {
    const tabs =
      await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      });

    const active = tabs[0];

    if (
      active?.id &&
      active.id !== workerTabId
    ) {
      returnTabId = active.id;
    }
  } catch {}
}

async function restorePreviousTab() {
  if (!returnTabId) return;

  try {
    const tab =
      await chrome.tabs.get(returnTabId);

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

async function waitForTabComplete(
  tabId,
  timeoutMs = 30000
) {
  try {
    const tab =
      await chrome.tabs.get(tabId);

    if (tab.status === "complete") {
      return;
    }
  } catch {}

  await new Promise(
    (resolve, reject) => {
      const timer =
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(
            listener
          );

          reject(
            new Error(
              "Worker tab load timeout."
            )
          );
        }, timeoutMs);

      const listener =
        (
          updatedId,
          changeInfo
        ) => {
          if (
            updatedId === tabId &&
            changeInfo.status === "complete"
          ) {
            clearTimeout(timer);

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
    attempt < 40;
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

async function closeIdleWorker() {
  if (
    workerBusy ||
    pendingJobs.length ||
    !workerTabId
  ) {
    return;
  }

  const id = workerTabId;
  workerTabId = null;

  await chrome.storage.local.remove(
    "workerTabId"
  );

  try {
    await chrome.tabs.remove(id);
  } catch {}

  console.log(
    "[Router] idle worker closed",
    id
  );
}

async function parkWorker() {
  clearTimeout(idleCloseTimer);

  if (!workerTabId) {
    return;
  }

  await restorePreviousTab();

  try {
    await chrome.tabs.update(
      workerTabId,
      {
        url: PARK_URL,
        active: false,
        pinned: false
      }
    );

    await waitForTabComplete(
      workerTabId,
      10000
    ).catch(() => {});

    await sleep(300);

    const tab =
      await chrome.tabs.get(workerTabId);

    if (!tab.active) {
      await chrome.tabs.discard(
        workerTabId
      ).catch(() => {});
    }

    console.log(
      "[Router] worker parked",
      workerTabId
    );

    idleCloseTimer =
      setTimeout(
        () => {
          void closeIdleWorker();
        },
        IDLE_CLOSE_MS
      );
  } catch (error) {
    console.warn(
      "[Router] park failed",
      error
    );
  }
}

function connectSocket() {
  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  clearTimeout(reconnectTimer);

  try {
    socket =
      new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    console.log(
      "[Router] bridge connected"
    );

    clearInterval(
      keepAliveTimer
    );

    keepAliveTimer =
      setInterval(() => {
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
      }, 20000);

    void pumpQueue();
  };

  socket.onmessage = event => {
    let message;

    try {
      message =
        JSON.parse(event.data);
    } catch {
      return;
    }

    if (
      message.type === "job" &&
      message.job
    ) {
      if (
        !pendingJobs.some(
          job =>
            job.id === message.job.id
        )
      ) {
        pendingJobs.push(
          message.job
        );
      }

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
  clearTimeout(reconnectTimer);

  reconnectTimer =
    setTimeout(
      connectSocket,
      1000
    );
}

async function reportJobError(
  job,
  error
) {
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
            error.message ||
            String(error)
        })
      }
    );
  } catch {}
}

async function runBrowserJob(job) {
  clearTimeout(idleCloseTimer);

  const tab =
    await ensureWorkerTab();

  await rememberCurrentTab();

  const url =
    TEMP_BASE +
    "&router-run=" +
    encodeURIComponent(job.id);

  console.log(
    "[Router] reuse worker",
    tab.id,
    "job",
    job.id
  );

  await chrome.tabs.update(
    tab.id,
    {
      url,
      active: true,
      pinned: false
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
    pendingJobs.length === 0
  ) {
    return;
  }

  workerBusy = true;

  const job =
    pendingJobs.shift();

  try {
    await runBrowserJob(job);
  } catch (error) {
    await reportJobError(
      job,
      error
    );

    workerBusy = false;

    await parkWorker();

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
        .then(data => {
          sendResponse({
            ok: true,
            data
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
        .then(async data => {
          if (tabId) {
            await chrome.action.setBadgeText({
              tabId,
              text: "OK"
            });
          }

          sendResponse({
            ok: true,
            data
          });

          workerBusy = false;

          await sleep(250);
          await parkWorker();

          void pumpQueue();
        })
        .catch(async error => {
          sendResponse({
            ok: false,
            error: error.message
          });

          workerBusy = false;

          await parkWorker();

          void pumpQueue();
        });

      return true;
    }

    if (
      message?.type ===
      "MARK_ROUTER_JOB_ERROR"
    ) {
      const fakeJob = {
        id: message.id,
        token: message.token
      };

      reportJobError(
        fakeJob,
        new Error(
          message.error ||
          "Browser worker failed."
        )
      )
        .finally(async () => {
          sendResponse({
            ok: true
          });

          workerBusy = false;

          await parkWorker();

          void pumpQueue();
        });

      return true;
    }
  }
);

chrome.action.onClicked.addListener(
  async () => {
    connectSocket();

    const tab =
      await ensureWorkerTab();

    await chrome.tabs.update(
      tab.id,
      {
        url: TEMP_BASE,
        active: true,
        pinned: false
      }
    );
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

chrome.alarms.onAlarm.addListener(
  alarm => {
    if (
      alarm.name ===
      "router-ws-reconnect"
    ) {
      connectSocket();
    }
  }
);

async function init() {
  await reconcileWorkerTab();

  if (workerTabId) {
    await parkWorker();
  }

  try {
    await chrome.alarms.create(
      "router-ws-reconnect",
      {
        periodInMinutes: 0.5
      }
    );
  } catch {}

  connectSocket();
}

chrome.runtime.onInstalled.addListener(
  () => {
    void init();
  }
);

chrome.runtime.onStartup.addListener(
  () => {
    void init();
  }
);

void init();
