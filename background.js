const YOUTUBE_URL_PATTERN = "https://www.youtube.com/*";

function isYouTubeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" && parsedUrl.hostname === "www.youtube.com";
  } catch {
    return false;
  }
}

async function injectContentScript(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch {
    // Some YouTube tabs may be unavailable during navigation. The next event will retry.
  }
}

async function injectIntoOpenYouTubeTabs() {
  const tabs = await chrome.tabs.query({ url: YOUTUBE_URL_PATTERN });

  for (const tab of tabs) {
    await injectContentScript(tab.id);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenYouTubeTabs();
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoOpenYouTubeTabs();
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0 || !isYouTubeUrl(details.url)) return;
  injectContentScript(details.tabId);
}, {
  url: [{ hostEquals: "www.youtube.com", schemes: ["https"] }]
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0 || !isYouTubeUrl(details.url)) return;
  injectContentScript(details.tabId);
}, {
  url: [{ hostEquals: "www.youtube.com", schemes: ["https"] }]
});
