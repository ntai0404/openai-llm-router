const CHATGPT_URL = "https://chatgpt.com/";

async function badge(tabId, text) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
  } catch {}
}

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });

  let tab;

  if (tabs.length) {
    tab = tabs.find(t => t.active) || tabs[0];
    await chrome.tabs.update(tab.id, {
      url: CHATGPT_URL,
      active: true
    });

    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } else {
    tab = await chrome.tabs.create({
      url: CHATGPT_URL,
      active: true
    });
  }

  await chrome.storage.local.set({
    autoTemporaryRequested: true,
    autoTemporaryTabId: tab.id,
    autoTemporaryRequestedAt: Date.now()
  });

  await badge(tab.id, "...");
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id) return;

  if (message?.type === "TEMPORARY_OK") {
    badge(sender.tab.id, "OK");
    chrome.storage.local.set({ autoTemporaryRequested: false });
  }

  if (message?.type === "TEMPORARY_FAILED") {
    badge(sender.tab.id, "!");
  }
});
