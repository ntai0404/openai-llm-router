const WS_URL = "ws://127.0.0.1:8788/extension";
const HTTP_BASE = "http://127.0.0.1:8788";
const PARK_URL = chrome.runtime.getURL("worker.html");
const TEMP_BASE = "https://chatgpt.com/?temporary-chat=true&router-worker=1";
const IDLE_CLOSE_MS = 60000;
const IDLE_ALARM = "router-idle-close";

let socket = null;
let reconnectTimer = null;
let keepAliveTimer = null;
let idleCloseTimer = null;
let workerParkGeneration = 0;

let workerTabId = null;
let workerWindowId = null;
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
  await chrome.alarms.clear(IDLE_ALARM).catch(() => {});

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
        if (tab.discarded) {
          console.log(
            "[Router] replacing discarded worker",
            workerTabId
          );

          try {
            await chrome.tabs.remove(
              workerTabId
            );
          } catch {}

          workerTabId = null;

          await chrome.storage.local.remove(
            "workerTabId"
          );
        } else {
          return tab;
        }
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
  if (workerBusy || pendingJobs.length) {
    return;
  }

  let id = workerTabId;

  if (!id) {
    const stored = await chrome.storage.local.get({
      workerTabId: null
    });

    id = stored.workerTabId;
  }

  if (!id) {
    return;
  }

  try {
    await chrome.tabs.get(id);
  } catch {
    if (workerTabId === id) {
      workerTabId = null;
    }

    await chrome.storage.local.remove("workerTabId");
    return;
  }

  console.log("[Router] idle deadline reached, closing worker", id);

  if (workerTabId === id) {
    workerTabId = null;
  }

  await chrome.storage.local.remove("workerTabId");

  try {
    await chrome.tabs.remove(id);
  } catch {}

  console.log("[Router] idle worker closed", id);
}

async function parkWorker() {
  /* ROUTER_WORKER_PARK_RACE_V2
     Do not let stale post-job parking steal focus from a new job.
  */
  const parkGeneration = workerParkGeneration;

  await sleep(750);

  if (
    workerBusy ||
    pendingJobs.length ||
    parkGeneration !== workerParkGeneration
  ) {
    console.log(
      "[Router] stale park cancelled by new work"
    );
    return;
  }

  await chrome.alarms.clear(IDLE_ALARM).catch(() => {});

  if (!workerTabId) return;

  await restorePreviousTab();

  try {
    const tab = await chrome.tabs.get(workerTabId);
    /*
      Keep the inactive worker loaded between jobs.
      Discarding it prevents reliable background
      navigation until Chrome activates the tab.
    */

    console.log("[Router] worker idle/kept loaded", workerTabId);

    await chrome.alarms.create(
      IDLE_ALARM,
      {
        when: Date.now() + IDLE_CLOSE_MS
      }
    );

    console.log(
      "[Router] idle close scheduled",
      workerTabId,
      "in",
      IDLE_CLOSE_MS,
      "ms"
    );
  } catch (error) {
    console.warn("[Router] park failed", error);
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
    workerParkGeneration += 1;
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

async function ensureDedicatedWorkerWindow(
  tab
) {
  if (!tab?.id) {
    throw new Error(
      "Worker tab is unavailable."
    );
  }

  let current =
    await chrome.tabs.get(
      tab.id
    );

  /*
    workerWindowId is the only authority for whether
    a Chrome window belongs to the router.

    Never infer ownership merely because a window
    happens to contain one tab.
  */
  const stored =
    await chrome.storage.local.get({
      workerWindowId:
        null
    });

  if (!workerWindowId) {
    workerWindowId =
      stored.workerWindowId ??
      null;
  }

  /*
    Validate persisted router-owned window.
  */
  if (workerWindowId) {
    const existingWindow =
      await chrome.windows
        .get(
          workerWindowId
        )
        .catch(() => null);

    if (!existingWindow) {
      workerWindowId =
        null;

      await chrome.storage.local.remove(
        "workerWindowId"
      );
    }
  }

  /*
    Reuse only when:
      1. this exact window ID was stored by router;
      2. current worker tab belongs to it;
      3. it contains only this worker tab.
  */
  if (
    workerWindowId &&
    current.windowId ===
      workerWindowId
  ) {
    const ownedTabs =
      await chrome.tabs.query({
        windowId:
          workerWindowId
      });

    if (
      ownedTabs.length === 1 &&
      ownedTabs[0]?.id ===
        current.id
    ) {
      current =
        await chrome.tabs.update(
          current.id,
          {
            active:
              true,

            autoDiscardable:
              false,

            pinned:
              false
          }
        );

      console.log(
        "[Router] reuse router-owned worker window",
        {
          tabId:
            current.id,

          windowId:
            current.windowId
        }
      );

      return current;
    }

    /*
      Window is no longer dedicated.
      Forget ownership and create a new one.
    */
    workerWindowId =
      null;

    await chrome.storage.local.remove(
      "workerWindowId"
    );
  }

  /*
    Current worker is in a user/unknown window.

    Move this exact tab into a new router-owned
    unfocused Chrome window.
  */
  const createdWindow =
    await chrome.windows.create({
      tabId:
        current.id,

      focused:
        false,

      type:
        "normal"
    });

  if (!createdWindow?.id) {
    throw new Error(
      "Unable to create router-owned worker window."
    );
  }

  workerWindowId =
    createdWindow.id;

  await chrome.storage.local.set({
    workerWindowId
  });

  await sleep(300);

  current =
    await chrome.tabs.get(
      current.id
    );

  current =
    await chrome.tabs.update(
      current.id,
      {
        active:
          true,

        autoDiscardable:
          false,

        pinned:
          false
      }
    );

  const verifiedWindow =
    await chrome.windows
      .get(
        current.windowId
      )
      .catch(() => null);

  const verifiedTabs =
    await chrome.tabs.query({
      windowId:
        current.windowId
    });

  if (
    current.windowId !==
      workerWindowId
  ) {
    throw new Error(
      "Worker tab is not inside the router-owned window."
    );
  }

  if (
    verifiedTabs.length !== 1 ||
    verifiedTabs[0]?.id !==
      current.id
  ) {
    throw new Error(
      "Router-owned worker window is not dedicated."
    );
  }

  if (
    !current.active ||
    current.discarded
  ) {
    throw new Error(
      "Router-owned worker tab is not active and loaded."
    );
  }

  console.log(
    "[Router] created router-owned worker window",
    {
      tabId:
        current.id,

      windowId:
        current.windowId,

      storedWindowId:
        workerWindowId,

      active:
        current.active,

      discarded:
        current.discarded,

      autoDiscardable:
        current.autoDiscardable,

      focused:
        verifiedWindow?.focused ??
        null
    }
  );

  return current;
}
async function runBrowserJob(job) {
  await chrome.alarms
    .clear(IDLE_ALARM)
    .catch(() => {});

  /*
    ensureWorkerTab keeps all existing reconciliation
    and discarded-worker recovery behavior from Phase 5.
  */
  let tab =
    await ensureWorkerTab();

  /*
    Record the user's foreground tab BEFORE creating or
    activating the dedicated worker window.
  */
  await rememberCurrentTab();

  /*
    This is the only behavioral change in this patch:
    host the worker as the active tab of its own window.
  */
  tab =
    await ensureDedicatedWorkerWindow(
      tab
    );

  /* ROUTER_WORKER_FOCUS_V1
     Keep ChatGPT Web foreground-renderable while executing.
     Retry because Chrome window focus transitions are asynchronous.
  */
  await chrome.tabs.update(
    tab.id,
    {
      active: true,
      autoDiscardable: false,
      pinned: false
    }
  );

  let focusedWorkerWindow = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await chrome.windows.update(
      tab.windowId,
      { focused: true }
    );

    await sleep(250);

    focusedWorkerWindow =
      await chrome.windows.get(tab.windowId);

    tab = await chrome.tabs.get(tab.id);

    if (
      focusedWorkerWindow.focused &&
      tab.active &&
      !tab.discarded
    ) {
      break;
    }
  }

  if (
    !focusedWorkerWindow?.focused ||
    !tab.active ||
    tab.discarded
  ) {
    throw new Error(
      "Dedicated worker could not enter focused execution state."
    );
  }

  console.log(
    "[Router] worker focused for execution",
    { tabId: tab.id, windowId: tab.windowId }
  );

  const url =
    TEMP_BASE +
    "&router-run=" +
    encodeURIComponent(
      job.id
    );

  console.log(
    "[Router] run dedicated worker",
    tab.id,
    "job",
    job.id
  );

  await chrome.tabs.update(
    tab.id,
    {
      url,
      active: true,
      autoDiscardable: false,
      pinned: false
    }
  );

  const beforeLoad =
    await chrome.tabs.get(
      tab.id
    );

  const workerWindow =
    await chrome.windows
      .get(
        beforeLoad.windowId
      )
      .catch(() => null);

  console.log(
    "[Router] worker execution state",
    {
      tabId:
        beforeLoad.id,

      windowId:
        beforeLoad.windowId,

      active:
        beforeLoad.active,

      discarded:
        beforeLoad.discarded,

      autoDiscardable:
        beforeLoad.autoDiscardable,

      windowFocused:
        workerWindow?.focused ??
        null
    }
  );

  if (
    !beforeLoad.active ||
    beforeLoad.discarded
  ) {
    throw new Error(
      "Dedicated worker is not active and loaded."
    );
  }

  await waitForTabComplete(
    tab.id
  );

  await sleep(500);

  const afterLoad =
    await chrome.tabs.get(
      tab.id
    );

  if (
    !afterLoad.active ||
    afterLoad.discarded
  ) {
    throw new Error(
      "Dedicated worker lost active state before job dispatch."
    );
  }

  const accepted =
    await sendToWorker(
      tab.id,
      {
        type:
          "RUN_JOB",

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

    if (pendingJobs.length) {
      void pumpQueue();
    } else {
      await parkWorker();
    }
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

          if (pendingJobs.length) {
            void pumpQueue();
          } else {
            await parkWorker();
          }
        })
        .catch(async error => {
          sendResponse({
            ok: false,
            error: error.message
          });

          workerBusy = false;

    if (pendingJobs.length) {
      void pumpQueue();
    } else {
      await parkWorker();
    }
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

    if (pendingJobs.length) {
      void pumpQueue();
    } else {
      await parkWorker();
    }
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
    if (alarm.name === IDLE_ALARM) {
      void closeIdleWorker();
      return;
    }

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



