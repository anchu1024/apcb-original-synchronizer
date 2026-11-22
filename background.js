chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "setAtCoderSource" && typeof message.sourceCode === "string") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false });
      return true;
    }
    const sourceCode = message.sourceCode;
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, allFrames: false },
      world: "MAIN",
      func: code => {
        const analyze = source => ({
          length: source?.length || 0,
          prefix: source?.slice(0, 120) || "",
          suffix: source?.slice(-120) || "",
          newlineCount: (source?.match(/\n/g)?.length || 0),
          controlCharCount: (source?.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length || 0),
          hebrewCharCount: (source?.match(/[\u0590-\u05FF]/g)?.length || 0),
          xCharCount: (source?.match(/X/g)?.length || 0),
          sourceCode: source || ""
        });
        console.group("[APCB] MAIN world insertion");
        console.log("[APCoder] source before insertion:", analyze(code));
        let changed = false;
        const plainTextarea = document.querySelector(
          "#plain-textarea, textarea[name='sourceCode'], textarea[name='source'], textarea#sourceCode"
        );
        if (plainTextarea) {
          const prototype = Object.getPrototypeOf(plainTextarea);
          const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");
          if (descriptor?.set) {
            descriptor.set.call(plainTextarea, code);
          } else if (plainTextarea.value !== code) {
            plainTextarea.value = code;
          }
          ["input", "change", "keyup"].forEach(type => {
            plainTextarea.dispatchEvent(new Event(type, { bubbles: true }));
          });
          changed = changed || plainTextarea.value === code;
        }

        if (typeof window.ace?.edit === "function") {
          const editorElement = document.getElementById("editor");
          if (editorElement) {
            const editor = window.ace.edit(editorElement);
            if (typeof editor?.setValue === "function") {
              editor.setValue(code, -1);
              changed = changed || editor.getValue?.() === code;
            }
          }
        }

        if (typeof window.jQuery === "function") {
          window.jQuery(".editor").each((_index, element) => {
            const editor = window.jQuery(element).data("editor");
            if (typeof editor?.doc?.setValue === "function") {
              editor.doc.setValue(code);
              changed = true;
            }
          });
        }

        if (typeof window.CodeMirror?.setValue === "function") {
          window.CodeMirror.setValue(code);
          changed = true;
        }
        document.querySelectorAll(".CodeMirror").forEach(element => {
          if (element.CodeMirror && typeof element.CodeMirror.setValue === "function") {
            element.CodeMirror.setValue(code);
            changed = true;
          }
        });
        const actual = {
          plainTextarea: plainTextarea?.value || null,
          aceEditor: (() => {
            if (typeof window.ace?.edit !== "function") return null;
            const editorElement = document.getElementById("editor");
            if (!editorElement) return null;
            return window.ace.edit(editorElement).getValue?.() || null;
          })(),
          codeMirror: document.querySelector(".CodeMirror")?.CodeMirror?.getValue?.() || null
        };
        console.log("[APCB] source after insertion:", {
          requested: analyze(code),
          actual
        });
        console.log("[APCB] exact requested source:", code);
        console.log("[APCB] exact actual plaintext:", actual.plainTextarea);
        console.log("[APCB] exact actual Ace:", actual.aceEditor);
        console.log("[APCB] exact actual CodeMirror:", actual.codeMirror);
        console.groupEnd();
        return changed;
      },
      args: [sourceCode]
    }).then(results => {
      sendResponse({ ok: results?.some(result => result.result === true) || false });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
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
        console.group("[APCB] Workspace MAIN world insertion");
        console.log("[APCB] requested Workspace source:", {
          length: code.length,
          prefix: code.slice(0, 120),
          suffix: code.slice(-120),
          sourceCode: code
        });
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
        const monacoValues = typeof window.monaco?.editor?.getModels === "function"
          ? window.monaco.editor.getModels().map(model => model.getValue?.() || "")
          : [];
        console.log("[APCB] actual Workspace Monaco values:", monacoValues);
        console.log("[APCB] exact requested Workspace source:", code);
        monacoValues.forEach((value, index) => {
          console.log(`[APCB] exact actual Workspace Monaco model ${index}:`, value);
        });
        console.groupEnd();
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
