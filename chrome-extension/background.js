const TEMPORARY_CHAT_URL = "https://chatgpt.com/?temporary-chat=true";

chrome.action.onClicked.addListener(async () => {
  try {
    /*
      Always create a BRAND-NEW tab.
      Never search for, focus, reload, or modify an existing ChatGPT tab.
    */
    const tab = await chrome.tabs.create({
      url: TEMPORARY_CHAT_URL,
      active: true
    });

    if (!tab.id) return;

    await chrome.action.setBadgeText({
      tabId: tab.id,
      text: "..."
    });

    const onUpdated = async (tabId, changeInfo) => {
      if (tabId !== tab.id || changeInfo.status !== "complete") return;

      chrome.tabs.onUpdated.removeListener(onUpdated);

      try {
        await chrome.action.setBadgeText({
          tabId,
          text: "OK"
        });
      } catch {}
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

  } catch (error) {
    console.error("[Temporary Router]", error);
  }
});
