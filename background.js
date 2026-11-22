async function getQueue() {
  const result = await chrome.storage.local.get("apcb_transfer_queue");
  return Array.isArray(result.apcb_transfer_queue) ? result.apcb_transfer_queue : [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ apcb_transfer_queue: queue });
}

async function findSubmissionIdFromMe(contestId, taskId) {
  const response = await fetch(
    `https://atcoder.jp/contests/${contestId}/submissions/me?_=${Date.now()}`,
    { credentials: "include" }
  );
  if (!response.ok) return null;
  const html = await response.text();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const row = rows.find(candidate =>
    candidate.includes(`/contests/${contestId}/tasks/${taskId}`) ||
    candidate.includes(`/tasks/${taskId}`)
  );
  return row?.match(/\/submissions\/(\d+)/)?.[1] || null;
}

async function getSubmissionStatus(contestId, submissionId) {
  const response = await fetch(
    `https://atcoder.jp/contests/${contestId}/submissions/${submissionId}?_=${Date.now()}`,
    { credentials: "include" }
  );
  if (!response.ok) return null;
  const html = await response.text();
  if (/label-success|badge-success|status-ac/i.test(html) && />\s*AC\s*</i.test(html)) return "AC";
  const match = html.match(/<span[^>]*class=["'][^"']*(?:label|badge|status)[^"']*["'][^>]*>\s*(WJ|Judging|AC|WA|TLE|MLE|RE|CE|OLE|IE)\s*</i);
  return match?.[1]?.toUpperCase() || null;
}

async function pollTransferQueue() {
  const queue = await getQueue();
  let changed = false;
  for (const item of queue) {
    if (item.state !== "submitted") continue;
    try {
      const target = new URL(item.targetUrl);
      const contestId = target.pathname.match(/^\/contests\/([^/]+)\//)?.[1];
      const taskId = decodeURIComponent(target.pathname.match(/\/tasks\/([^/?#]+)/)?.[1] || "");
      if (!contestId) continue;
      if (!item.submissionId) {
        item.submissionId = await findSubmissionIdFromMe(contestId, taskId);
        changed = true;
      }
      if (!item.submissionId) continue;
      const status = await getSubmissionStatus(contestId, item.submissionId);
      if (status === "AC") {
        item.state = "ac";
        item.notificationClaimed = false;
        changed = true;
        const stored = await chrome.storage.local.get("submitted_tasks");
        const submitted = stored.submitted_tasks && typeof stored.submitted_tasks === "object"
          ? stored.submitted_tasks
          : {};
        submitted[normalizeQueueUrl(item.targetUrl)] = {
          status: "AC",
          timestamp: Date.now(),
          lectureUrl: item.lectureUrl || "",
          submissionId: item.submissionId
        };
        await chrome.storage.local.set({ submitted_tasks: submitted });
      } else if (status && !/^(WJ|JUDGING)$/i.test(status)) {
        item.state = "finished";
        item.status = status;
        changed = true;
      }
    } catch (_) {}
  }
  if (changed) await setQueue(queue);
}

function normalizeQueueUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return String(url || "").split(/[?#]/)[0].replace(/\/+$/, "");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "pollTransferQueue") {
    pollTransferQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "setNativeSubmitSource" &&
      typeof message.sourceCode === "string" &&
      typeof message.contestId === "string" &&
      typeof message.taskId === "string") {
    if (!sender.tab?.id ||
        !/^[A-Za-z0-9_-]+$/.test(message.contestId) ||
        !/^[A-Za-z0-9_-]+$/.test(message.taskId)) {
      sendResponse({ ok: false });
      return true;
    }

    chrome.webNavigation.getAllFrames({ tabId: sender.tab.id }, frames => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      const targetFrame = frames?.find(frame => {
        if (frame.frameId === sender.frameId) return false;
        try {
          const frameUrl = new URL(frame.url);
          return frameUrl.origin === "https://atcoder.jp" &&
            frameUrl.pathname === `/contests/${message.contestId}/submit` &&
            frameUrl.searchParams.get("taskScreenName") === message.taskId;
        } catch (_) {
          return false;
        }
      });
      if (!targetFrame) {
        sendResponse({ ok: false, retry: true });
        return;
      }

      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [targetFrame.frameId] },
        world: "MAIN",
        func: (sourceCode, contestId, taskId) => new Promise(resolve => {
          const pageUrl = new URL(location.href);
          if (pageUrl.origin !== "https://atcoder.jp" ||
              pageUrl.pathname !== `/contests/${contestId}/submit` ||
              pageUrl.searchParams.get("taskScreenName") !== taskId) {
            resolve({ matched: false });
            return;
          }

          const deadline = Date.now() + 20000;
          let editor = null;
          const applySource = () => {
            const form = document.querySelector("form[action*='/submit']");
            const editorElement = document.getElementById("editor");
            const textareas = form ? Array.from(form.querySelectorAll(
              "textarea[name='sourceCode'], textarea[name='source'], textarea#sourceCode, " +
              "textarea#plain-textarea"
            )) : [];

            if (!form || !editorElement || !textareas.length ||
                typeof window.ace?.edit !== "function") {
              if (Date.now() >= deadline) {
                resolve({
                  matched: true,
                  success: false,
                  textareaCount: textareas.length,
                  editorAvailable: !!editor,
                  aceAvailable: typeof window.ace?.edit === "function"
                });
                return;
              }
              setTimeout(applySource, 100);
              return;
            }

            try {
              editor = editor || window.ace.edit(editorElement);
              if (typeof editor?.setValue !== "function" ||
                  typeof editor?.getValue !== "function") {
                throw new Error("Ace editor is not ready");
              }
            } catch (_) {
              if (Date.now() >= deadline) {
                resolve({
                  matched: true,
                  success: false,
                  textareaCount: textareas.length,
                  editorAvailable: false
                });
                return;
              }
              setTimeout(applySource, 100);
              return;
            }

            if (editor.getValue() !== sourceCode) {
              editor.setValue(sourceCode, -1);
            }
            textareas.forEach(textarea => {
              if (textarea.value === sourceCode) return;
              const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value"
              )?.set;
              if (setter) setter.call(textarea, sourceCode);
              else textarea.value = sourceCode;
              textarea.dispatchEvent(new Event("input", { bubbles: true }));
              textarea.dispatchEvent(new Event("change", { bubbles: true }));
            });

            const aceValueMatches = editor.getValue() === sourceCode;
            const textareasMatch = textareas.every(textarea => textarea.value === sourceCode);
            if (aceValueMatches && textareasMatch) {
              resolve({
                matched: true,
                success: true,
                textareaCount: textareas.length,
                plainTextareaFound: !!form.querySelector("#plain-textarea"),
                aceValueMatches,
                textareasMatch
              });
              return;
            }

            if (Date.now() >= deadline) {
              resolve({
                matched: true,
                success: false,
                textareaCount: textareas.length,
                plainTextareaFound: !!form.querySelector("#plain-textarea"),
                aceValueMatches,
                textareasMatch
              });
              return;
            }
            setTimeout(applySource, 100);
          };

          applySource();
        }),
        args: [message.sourceCode, message.contestId, message.taskId]
      }).then(results => {
        const result = results?.[0]?.result;
        if (!result?.matched) {
          sendResponse({ ok: false, retry: true });
          return;
        }
        sendResponse({ ok: result.success, ...result });
      }).catch(error => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
    });
    return true;
  }
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

chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local" && changes.apcb_transfer_queue) {
    pollTransferQueue();
  }
});
chrome.runtime.onInstalled?.addListener(() => {
  chrome.alarms.create("apcb-transfer-poll", { periodInMinutes: 1 / 6 });
});
chrome.runtime.onStartup?.addListener(() => {
  chrome.alarms.create("apcb-transfer-poll", { periodInMinutes: 1 / 6 });
});
chrome.alarms.onAlarm?.addListener(alarm => {
  if (alarm.name === "apcb-transfer-poll") pollTransferQueue();
});
