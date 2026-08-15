const CHATGPT_NEW_CHAT = "https://chatgpt.com/";

async function setBadge(tabId, text) {
  if (!tabId) return;

  try {
    await chrome.action.setBadgeText({
      tabId,
      text
    });
  } catch {}
}

chrome.action.onClicked.addListener(async (activeTab) => {
  try {
    let targetTab;

    /*
      IMPORTANT:
      Never search for another existing ChatGPT tab.

      If the USER'S CURRENT TAB is ChatGPT, reuse only that tab.
      Otherwise create a brand-new ChatGPT tab.
    */
    if (
      activeTab?.id &&
      typeof activeTab.url === "string" &&
      activeTab.url.startsWith("https://chatgpt.com/")
    ) {
      targetTab = activeTab;

      await setBadge(targetTab.id, "...");

      await chrome.storage.local.set({
        pendingTemporaryTabId: targetTab.id,
        pendingTemporaryAt: Date.now()
      });

      await chrome.tabs.update(targetTab.id, {
        url: CHATGPT_NEW_CHAT,
        active: true
      });
    } else {
      targetTab = await chrome.tabs.create({
        url: CHATGPT_NEW_CHAT,
        active: true
      });

      await chrome.storage.local.set({
        pendingTemporaryTabId: targetTab.id,
        pendingTemporaryAt: Date.now()
      });

      await setBadge(targetTab.id, "...");
    }
  } catch (error) {
    console.error("Unable to open ChatGPT:", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;

  if (!tabId) return;

  if (message?.type === "TEMPORARY_OK") {
    setBadge(tabId, "OK");

    chrome.storage.local.remove([
      "pendingTemporaryTabId",
      "pendingTemporaryAt"
    ]);
  }

  if (message?.type === "TEMPORARY_FAILED") {
    setBadge(tabId, "!");
  }
});
