const DEMO_PROMPT = "Explain quantum computing in one sentence.";
const URL = "https://chatgpt.com/?temporary-chat=true&router-demo=1";

chrome.action.onClicked.addListener(async () => {
  try {
    const tab = await chrome.tabs.create({
      url: URL,
      active: true
    });

    if (tab.id) {
      await chrome.action.setBadgeText({
        tabId: tab.id,
        text: "..."
      });
    }
  } catch (error) {
    console.error("[Router Demo]", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;

  if (!tabId) return;

  if (message?.type === "PROMPT_FILLED") {
    chrome.action.setBadgeText({
      tabId,
      text: "OK"
    });
  }

  if (message?.type === "PROMPT_FAILED") {
    chrome.action.setBadgeText({
      tabId,
      text: "!"
    });
  }
});
