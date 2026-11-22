async function getQueue() {
  const result = await chrome.storage.local.get(TRANSFER_QUEUE_KEY);
  return Array.isArray(result[TRANSFER_QUEUE_KEY]) ? result[TRANSFER_QUEUE_KEY] : [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [TRANSFER_QUEUE_KEY]: queue });
}

const TRANSFER_QUEUE_KEY = "apcb_transfer_queue";
const SUBMISSION_LOCK_KEY = "apcb_submission_lock";
let queueMutationTail = Promise.resolve();

function withQueueMutation(operation) {
  const result = queueMutationTail.then(operation, operation);
  queueMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function applyQueueDelta(queue, updates, removeIds) {
  const removed = new Set(removeIds || []);
  const merged = queue.filter(item => !removed.has(item.id));
  for (const update of updates || []) {
    const index = merged.findIndex(item => item.id === update.id);
    if (update.item) {
      if (index < 0) merged.unshift({ ...update.item });
      else merged[index] = { ...merged[index], ...update.item };
      continue;
    }
    if (index < 0) continue;
    Object.assign(merged[index], update.changes || {});
    (update.unset || []).forEach(key => delete merged[index][key]);
  }
  return merged
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
    .slice(0, 20);
}

async function enqueueTransferQueueItem(item) {
  return withQueueMutation(async () => {
    const queue = await getQueue();
    const existing = queue.find(candidate =>
      candidate.lectureSubmissionUrl &&
      candidate.lectureSubmissionUrl === item.lectureSubmissionUrl
    );
    if (existing) return existing;
    queue.unshift(item);
    const updated = queue
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
      .slice(0, 20);
    await setQueue(updated);
    return item;
  });
}

async function mergeTransferQueue(updates, removeIds) {
  return withQueueMutation(async () => {
    const queue = applyQueueDelta(await getQueue(), updates, removeIds);
    await setQueue(queue);
  });
}

async function acquireSubmissionSlot(queueId, ownerToken, tabId) {
  return withQueueMutation(async () => {
    const stored = await chrome.storage.local.get(SUBMISSION_LOCK_KEY);
    let lock = stored[SUBMISSION_LOCK_KEY];
    if (lock?.expiresAt > Date.now()) {
      if (lock.queueId === queueId && lock.ownerToken === ownerToken) {
        return { ok: true, acquired: true };
      }
      return { ok: true, acquired: false, reason: "busy" };
    }
    if (lock) {
      await chrome.storage.local.remove(SUBMISSION_LOCK_KEY);
    }

    const queue = await getQueue();
    const item = queue.find(candidate => candidate.id === queueId);
    if (!item) return { ok: false, reason: "missing_queue_item" };
    if (item.state !== "ready") {
      return { ok: true, acquired: false, reason: "already_started", item };
    }

    lock = {
      queueId,
      ownerToken,
      tabId,
      expiresAt: Date.now() + 120000
    };
    await chrome.storage.local.set({ [SUBMISSION_LOCK_KEY]: lock });
    return { ok: true, acquired: true };
  });
}

async function releaseSubmissionSlot(queueId, ownerToken) {
  return withQueueMutation(async () => {
    const stored = await chrome.storage.local.get(SUBMISSION_LOCK_KEY);
    const lock = stored[SUBMISSION_LOCK_KEY];
    if (lock?.queueId === queueId && lock.ownerToken === ownerToken) {
      await chrome.storage.local.remove(SUBMISSION_LOCK_KEY);
    }
    return { ok: true };
  });
}

async function releaseSubmissionSlotForQueueItem(queueId) {
  const stored = await chrome.storage.local.get(SUBMISSION_LOCK_KEY);
  const lock = stored[SUBMISSION_LOCK_KEY];
  if (lock?.queueId === queueId) {
    await chrome.storage.local.remove(SUBMISSION_LOCK_KEY);
  }
}

function submissionRowMatchesTask(row, contestId, taskId) {
  const taskPath = `/contests/${contestId}/tasks/${taskId}`;
  const links = Array.from(row.matchAll(/href=["']([^"']+)["']/gi));
  return links.some(([, href]) => {
    try {
      const url = new URL(href, "https://atcoder.jp");
      return url.pathname.replace(/\/+$/, "") === taskPath;
    } catch (_) {
      return false;
    }
  });
}

async function findSubmissionIdFromMe(contestId, taskId, previousSubmissionId) {
  const response = await fetch(
    `https://atcoder.jp/contests/${contestId}/submissions/me?_=${Date.now()}`,
    { credentials: "include" }
  );
  if (!response.ok) return null;
  const html = await response.text();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const row = rows.find(candidate =>
    submissionRowMatchesTask(candidate, contestId, taskId)
  );
  const submissionId = row?.match(/\/submissions\/(\d+)/)?.[1] || null;
  return submissionId && submissionId !== previousSubmissionId ? submissionId : null;
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
  const changes = [];

  for (const item of queue) {
    if (!["submitting", "submitted"].includes(item.state)) continue;
    const original = { ...item };
    let acRecord = null;
    try {
      if (item.state === "submitted" && !item.preSubmitBaselineCaptured) {
        item.state = "unverified";
        item.status = "受付未確認";
        delete item.submissionId;
      } else {
        const target = new URL(item.targetUrl);
        const contestId = target.pathname.match(/^\/contests\/([^/]+)\//)?.[1];
        const taskId = decodeURIComponent(target.pathname.match(/\/tasks\/([^/?#]+)/)?.[1] || "");
        if (!contestId) continue;
        if (!item.submissionId) {
          if (!item.preSubmitBaselineCaptured) {
            item.state = "unverified";
            item.status = "受付未確認";
          } else {
            item.submissionId = await findSubmissionIdFromMe(
              contestId,
              taskId,
              item.previousSubmissionId
            );
            if (item.submissionId) {
              item.state = "submitted";
            } else if (Date.now() - item.submittedAt >= 90000) {
              item.state = "failed";
              item.status = "受付未確認";
            }
          }
        }
        if (item.submissionId) {
          const status = await getSubmissionStatus(contestId, item.submissionId);
          if (status === "AC") {
            item.state = "ac";
            item.notificationClaimed = false;
            acRecord = {
              targetUrl: normalizeQueueUrl(item.targetUrl),
              submissionId: item.submissionId,
              lectureUrl: item.lectureUrl || ""
            };
          } else if (status && !/^(WJ|JUDGING)$/i.test(status)) {
            item.state = "finished";
            item.status = status;
          }
        }
      }
    } catch (error) {
      if (item.state === "submitting" &&
          Date.now() - (item.submittedAt || 0) >= 90000) {
        item.state = "failed";
        item.status = "受付未確認";
      }
      console.error("[APCB] transfer queue polling failed", error);
    }

    const patch = {};
    const unset = [];
    Object.keys(item).forEach(key => {
      if (JSON.stringify(item[key]) !== JSON.stringify(original[key])) patch[key] = item[key];
    });
    Object.keys(original).forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(item, key)) unset.push(key);
    });
    if (Object.keys(patch).length || unset.length) {
      changes.push({
        id: item.id,
        expectedState: original.state,
        expectedSubmissionId: original.submissionId || null,
        patch,
        unset,
        acRecord
      });
    }
  }

  if (!changes.length) return;
  await withQueueMutation(async () => {
    const latestQueue = await getQueue();
    const releaseQueueIds = [];
    const acceptedRecords = [];
    let changed = false;
    for (const update of changes) {
      const current = latestQueue.find(item => item.id === update.id);
      if (!current || current.state !== update.expectedState ||
          (current.submissionId || null) !== update.expectedSubmissionId) continue;
      Object.assign(current, update.patch);
      update.unset.forEach(key => delete current[key]);
      changed = true;
      if (update.acRecord) acceptedRecords.push(update.acRecord);
      if (["submitted", "failed", "unverified"].includes(update.patch.state)) {
        releaseQueueIds.push(update.id);
      }
    }
    if (changed) await setQueue(latestQueue);
    if (acceptedRecords.length) {
      const stored = await chrome.storage.local.get("submitted_tasks");
      const submitted = stored.submitted_tasks && typeof stored.submitted_tasks === "object"
        ? stored.submitted_tasks
        : {};
      acceptedRecords.forEach(record => {
        submitted[record.targetUrl] = {
          status: "AC",
          timestamp: Date.now(),
          lectureUrl: record.lectureUrl,
          submissionId: record.submissionId
        };
      });
      await chrome.storage.local.set({ submitted_tasks: submitted });
    }
    for (const queueId of releaseQueueIds) {
      await releaseSubmissionSlotForQueueItem(queueId);
    }
  });
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
  if (message?.type === "mergeTransferQueue") {
    if (!Array.isArray(message.updates) || !Array.isArray(message.removeIds)) {
      sendResponse({ ok: false, error: "Invalid transfer queue delta" });
      return false;
    }
    mergeTransferQueue(message.updates, message.removeIds)
      .then(() => sendResponse({ ok: true }))
      .catch(error => {
        console.error("[APCB] transfer queue merge failed", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }
  if (message?.type === "enqueueTransferQueueItem") {
    const item = message.item;
    if (!item || typeof item.id !== "string" ||
        typeof item.lectureSubmissionUrl !== "string" ||
        typeof item.targetUrl !== "string") {
      sendResponse({ ok: false, error: "Invalid transfer queue item" });
      return false;
    }
    enqueueTransferQueueItem(item)
      .then(queuedItem => sendResponse({ ok: true, item: queuedItem }))
      .catch(error => {
        console.error("[APCB] transfer queue enqueue failed", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }
  if (message?.type === "acquireSubmissionSlot") {
    if (typeof message.queueId !== "string" || typeof message.ownerToken !== "string") {
      sendResponse({ ok: false, error: "Invalid submission slot request" });
      return false;
    }
    acquireSubmissionSlot(message.queueId, message.ownerToken, sender.tab?.id)
      .then(sendResponse)
      .catch(error => {
        console.error("[APCB] submission slot acquisition failed", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }
  if (message?.type === "releaseSubmissionSlot") {
    if (typeof message.queueId !== "string" || typeof message.ownerToken !== "string") {
      sendResponse({ ok: false, error: "Invalid submission slot release" });
      return false;
    }
    releaseSubmissionSlot(message.queueId, message.ownerToken)
      .then(sendResponse)
      .catch(error => {
        console.error("[APCB] submission slot release failed", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }
  if (message?.type === "pollTransferQueue") {
    pollTransferQueue()
      .then(() => sendResponse({ ok: true }))
      .catch(error => {
        console.error("[APCB] transfer queue poll failed", error);
        sendResponse({ ok: false, error: error.message });
      });
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

function startTransferQueuePolling(source) {
  pollTransferQueue().catch(error => {
    console.error(`[APCB] transfer queue poll failed (${source})`, error);
  });
}

chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local" && changes.apcb_transfer_queue) {
    startTransferQueuePolling("storage change");
  }
});
chrome.runtime.onInstalled?.addListener(() => {
  chrome.alarms.create("apcb-transfer-poll", { periodInMinutes: 1 / 6 });
});
chrome.runtime.onStartup?.addListener(() => {
  chrome.alarms.create("apcb-transfer-poll", { periodInMinutes: 1 / 6 });
});
chrome.alarms.onAlarm?.addListener(alarm => {
  if (alarm.name === "apcb-transfer-poll") startTransferQueuePolling("alarm");
});
