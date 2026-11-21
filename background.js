chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "openInTab" || typeof message.url !== "string") {
    return false;
  }

  try {
    const url = new URL(message.url);
    if (url.origin !== "https://atcoder.jp") {
      sendResponse({ ok: false });
      return true;
    }
    chrome.tabs.create({ url: url.href, active: true });
    sendResponse({ ok: true });
  } catch (_) {
    sendResponse({ ok: false });
  }
  return true;
});
