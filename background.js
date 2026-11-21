chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "getProblemModels") {
    getProblemModels()
      .then(models => sendResponse({ ok: true, models }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
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

async function getProblemModels() {
  const key = "problem_models_cache";
  const ttl = 24 * 60 * 60 * 1000;
  const cached = await chrome.storage.local.get(key);
  const entry = cached[key];
  if (entry?.models && Date.now() - entry.timestamp < ttl) {
    return entry.models;
  }

  const response = await fetch("https://kenkoooo.com/atcoder/resources/problem-models.json");
  if (!response.ok) throw new Error(`Difficulty API returned ${response.status}`);
  const models = await response.json();
  await chrome.storage.local.set({
    [key]: {
      timestamp: Date.now(),
      models
    }
  });
  return models;
}
