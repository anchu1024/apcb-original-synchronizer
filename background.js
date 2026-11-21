chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "setWorkspaceCode" && typeof message.sourceCode === "string") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false });
      return true;
    }
    const sourceCode = message.sourceCode;
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, allFrames: true },
      world: "MAIN",
      func: code => {
        const applyToMonaco = () => {
          if (typeof window.monaco?.editor?.getModels === "function") {
            window.monaco.editor.getModels().forEach(model => {
              if (typeof model?.setValue === "function" && model.getValue?.() !== code) {
                model.setValue(code);
              }
            });
            if (typeof window.monaco.editor?.getEditors === "function") {
              window.monaco.editor.getEditors().forEach(editor => {
                if (typeof editor?.setValue === "function" && editor.getValue?.() !== code) {
                  editor.setValue(code);
                }
              });
            }
          }
          document.querySelectorAll("textarea").forEach(textarea => {
            if (textarea.value !== code) textarea.value = code;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
          });
        };
        applyToMonaco();
        return typeof window.monaco?.editor === "object";
      },
      args: [sourceCode]
    }).then(results => {
      sendResponse({
        ok: results?.some(result => result.result === true) || false
      });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
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
