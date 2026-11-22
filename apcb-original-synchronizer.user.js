const CONFIG = Object.freeze({
  LECTURE_CONTEST_REGEX: /^apcb_exercise_/,
  PENDING_TRANSFER_TTL_MS: 10 * 60 * 1000,
  SUBMITTED_TASKS_KEY: "submitted_tasks",
  PENDING_TRANSFER_KEY: "pending_transfer",
  TRANSFER_QUEUE_KEY: "apcb_transfer_queue",
  PROBLEM_MODELS_CACHE_KEY: "problem_models_cache",
  PROBLEM_MODELS_URL: "https://kenkoooo.com/atcoder/resources/problem-models.json",
  PROBLEM_MODELS_TTL_MS: 24 * 60 * 60 * 1000
});

let chromeStorageCache = {
  submitted_tasks: {},
  pending_transfer: null,
  apcb_transfer_queue: [],
  problem_models_cache: null
};

function isExtensionContextValid() {
  try {
    return typeof chrome !== "undefined"
      && !!chrome.runtime
      && typeof chrome.runtime.id === "string"
      && chrome.runtime.id.length > 0;
  } catch (_) {
    return false;
  }
}

function safeRuntimeSendMessage(message, callback) {
  try {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime?.lastError?.message;
      if (error) {
        callback?.({ ok: false, error });
        return;
      }
      callback?.(response);
    });
  } catch (error) {
    callback?.({ ok: false, error: String(error?.message || error) });
  }
}

function normalizeAtCoderUrl(url) {
  try {
    const parsed = new URL(url, "https://atcoder.jp");
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return String(url || "").split(/[?#]/)[0].replace(/\/+$/, "");
  }
}

function resolveOriginalTaskUrl(lectureTaskUrl) {
  try {
    const parsed = new URL(lectureTaskUrl, "https://atcoder.jp");
    const contestMatch = parsed.pathname.match(/\/contests\/([^/]+)\/tasks\/([^/?#]+)\/?$/);
    if (!contestMatch || !CONFIG.LECTURE_CONTEST_REGEX.test(contestMatch[1])) {
      return null;
    }

    const taskId = decodeURIComponent(contestMatch[2]);
    const underscoreIndex = taskId.indexOf("_");
    if (underscoreIndex <= 0) {
      return null;
    }

    const originalContestId = taskId.slice(0, underscoreIndex);
    return `https://atcoder.jp/contests/${originalContestId}/tasks/${taskId}`;
  } catch (_) {
    return null;
  }
}

function extractTaskId(url) {
  try {
    const match = new URL(url, "https://atcoder.jp").pathname.match(
      /\/tasks\/([^/?#]+)\/?$/
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch (_) {
    return null;
  }
}

function normalizeDifficulty(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) {
    return Math.round(400 / Math.exp((1 - value) / 400));
  }
  return value;
}

function getDifficultyColor(difficulty) {
  if (difficulty < 400) return "#808080";
  if (difficulty < 800) return "#804000";
  if (difficulty < 1200) return "#008000";
  if (difficulty < 1600) return "#00C0C0";
  if (difficulty < 2000) return "#0000FF";
  if (difficulty < 2400) return "#C0C000";
  if (difficulty < 2800) return "#FF8000";
  return "#FF0000";
}

function getProblemModels() {
  const cache = chromeStorageCache.problem_models_cache;
  if (
    cache?.models &&
    Number.isFinite(cache.timestamp) &&
    Date.now() - cache.timestamp < CONFIG.PROBLEM_MODELS_TTL_MS
  ) {
    return cache.models;
  }
  return null;
}

function insertDifficultyCircle(link, difficulty) {
  const color = getDifficultyColor(difficulty);
  const fillRatio = Math.min(1, Math.max(0, (difficulty % 400) / 400));
  const fillPercent = fillRatio * 100;

  let circle = link.previousElementSibling;
  if (!circle?.classList?.contains("apcb-difficulty-circle")) {
    circle = document.createElement("span");
    circle.className = "apcb-difficulty-circle";
  }

  circle.title = `Difficulty: ${difficulty}`;
  circle.setAttribute("aria-label", `Difficulty: ${difficulty}`);
  circle.style.setProperty("display", "inline-block", "important");
  circle.style.setProperty("width", "12px", "important");
  circle.style.setProperty("height", "12px", "important");
  circle.style.setProperty("border", `1px solid ${color}`, "important");
  circle.style.setProperty("border-radius", "50%", "important");
  circle.style.setProperty("margin-right", "4px", "important");
  circle.style.setProperty("vertical-align", "middle", "important");
  circle.style.setProperty("box-shadow", `0 0 2px ${color}`, "important");

  if (difficulty >= 3200) {
    const silverOrGold = difficulty >= 3600
      ? "linear-gradient(to bottom, #fff4a3 0%, #ffd700 50%, #c8a800 100%)"
      : "linear-gradient(to bottom, #ffffff 0%, #c0c0c0 50%, #808080 100%)";
    circle.style.setProperty("background", silverOrGold, "important");
  } else {
    circle.style.setProperty(
      "background",
      `linear-gradient(to top, ${color} ${fillPercent}%, transparent ${fillPercent}%)`,
      "important"
    );
  }

  if (circle !== link.previousElementSibling) {
    link.insertAdjacentElement("beforebegin", circle);
  }
  link.style.setProperty("color", color, "important");
}

function applyDifficultyToLink(link) {
  const models = getProblemModels();
  if (!models) return false;
  const taskId = extractTaskId(link.href);
  if (!taskId) return false;
  const rawDifficulty = models[taskId]?.difficulty;
  const difficulty = normalizeDifficulty(rawDifficulty);
  if (difficulty === null) return false;
  insertDifficultyCircle(link, difficulty);
  return true;
}

function applyDifficultyDisplays() {
  if (!isLectureContestUrl(location.href)) return;
  const pathname = new URL(location.href).pathname;

  if (/\/standings\/?$/.test(pathname)) {
    document.querySelectorAll("a[href*='/tasks/']").forEach(link => {
      applyDifficultyToLink(link);
    });
  } else if (/\/tasks\/?$/.test(pathname)) {
    document.querySelectorAll("tbody tr").forEach(row => {
      const links = Array.from(row.querySelectorAll("a[href*='/tasks/']"));
      if (links.length === 0) return;

      let problemNameLink = links.length >= 2 ? links[1] : links[0];
      const hrefGroups = new Map();
      links.forEach(link => {
        const href = normalizeAtCoderUrl(link.href);
        const matches = hrefGroups.get(href) || [];
        matches.push(link);
        hrefGroups.set(href, matches);
      });
      for (const matches of hrefGroups.values()) {
        if (matches.length >= 2) {
          problemNameLink = matches[1];
          break;
        }
      }
      applyDifficultyToLink(problemNameLink);
    });
  } else if (/\/submissions/.test(pathname)) {
    document.querySelectorAll("a[href*='/tasks/']").forEach(link => {
      applyDifficultyToLink(link);
    });
  } else if (/\/tasks\/[^/]+/.test(pathname)) {
    const taskId = extractTaskId(location.href);
    const models = getProblemModels();
    const difficulty = normalizeDifficulty(models?.[taskId]?.difficulty);
    if (difficulty !== null) {
      document.querySelectorAll("span.h2").forEach(title => {
        title.style.setProperty("color", getDifficultyColor(difficulty), "important");
        let circle = title.previousElementSibling;
        if (!circle?.classList?.contains("apcb-difficulty-circle")) {
          circle = document.createElement("span");
          circle.className = "apcb-difficulty-circle";
        }
        circle.title = `Difficulty: ${difficulty}`;
        circle.setAttribute("aria-label", `Difficulty: ${difficulty}`);
        const color = getDifficultyColor(difficulty);
        const fillRatio = Math.min(1, Math.max(0, (difficulty % 400) / 400));
        circle.style.setProperty("display", "inline-block", "important");
        circle.style.setProperty("width", "24px", "important");
        circle.style.setProperty("height", "24px", "important");
        circle.style.setProperty("border", `2px solid ${color}`, "important");
        circle.style.setProperty("border-radius", "50%", "important");
        circle.style.setProperty("margin-right", "8px", "important");
        circle.style.setProperty("vertical-align", "middle", "important");
        circle.style.setProperty("box-shadow", `0 0 2px ${color}`, "important");
        circle.style.setProperty(
          "background",
          difficulty >= 3200
            ? (difficulty >= 3600
              ? "linear-gradient(to bottom, #fff4a3 0%, #ffd700 50%, #c8a800 100%)"
              : "linear-gradient(to bottom, #ffffff 0%, #c0c0c0 50%, #808080 100%)")
            : `linear-gradient(to top, ${color} ${fillRatio * 100}%, transparent ${fillRatio * 100}%)`,
          "important"
        );
        if (circle !== title.previousElementSibling) {
          title.insertAdjacentElement("beforebegin", circle);
        }
        if (title.dataset.apcbOriginalLink !== "true") {
          const targetUrl = resolveOriginalTaskUrl(location.href);
          if (targetUrl) {
            const originalLink = document.createElement("a");
            originalLink.textContent = "本家を開く";
            originalLink.href = targetUrl;
            originalLink.target = "_blank";
            originalLink.rel = "noopener";
            originalLink.style.setProperty("display", "inline-block", "important");
            originalLink.style.setProperty("margin-left", "8px", "important");
            originalLink.style.setProperty("font-size", "14px", "important");
            originalLink.style.setProperty("font-weight", "normal", "important");
            title.insertAdjacentElement("afterend", originalLink);
            title.dataset.apcbOriginalLink = "true";
          }
        }
      });
    }
  }
}

function gmGetValue(key, fallback) {
  if (isExtensionContextValid() && chrome.storage?.local) {
    const stored = chromeStorageCache[key];
    return stored === undefined ? fallback : stored;
  }
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function gmSetValue(key, value) {
  if (isExtensionContextValid() && chrome.storage?.local) {
    chromeStorageCache[key] = value;
    chrome.storage.local.set({ [key]: value }).catch?.(() => {});
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function getSubmittedTasks() {
  const value = gmGetValue(CONFIG.SUBMITTED_TASKS_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function setSubmittedTasks(value) {
  gmSetValue(CONFIG.SUBMITTED_TASKS_KEY, value);
}

function getTransferQueue() {
  const value = gmGetValue(CONFIG.TRANSFER_QUEUE_KEY, []);
  return Array.isArray(value) ? value : [];
}

function setTransferQueue(queue) {
  gmSetValue(CONFIG.TRANSFER_QUEUE_KEY, queue);
}

async function persistTransferQueue(queue) {
  if (isExtensionContextValid() && chrome.storage?.local) {
    await chrome.storage.local.set({ [CONFIG.TRANSFER_QUEUE_KEY]: queue });
    chromeStorageCache[CONFIG.TRANSFER_QUEUE_KEY] = queue;
    return;
  }
  setTransferQueue(queue);
}

function findTransferQueueItemForPending(pending) {
  const queue = getTransferQueue();
  if (pending.queueId) {
    const queueItem = queue.find(item => item.id === pending.queueId);
    if (queueItem) return queueItem;
  }

  const targetUrl = normalizeAtCoderUrl(pending.targetUrl);
  return queue.find(item =>
    normalizeAtCoderUrl(item.targetUrl) === targetUrl &&
    Number.isFinite(item.createdAt) &&
    Number.isFinite(pending.createdAt) &&
    item.createdAt >= pending.createdAt - 5000 &&
    item.createdAt <= pending.createdAt + 10000
  ) || null;
}

function getPendingTransfer() {
  const value = gmGetValue(CONFIG.PENDING_TRANSFER_KEY, null);
  if (!value || typeof value !== "object") return null;
  if (!Number.isFinite(value.createdAt) || Date.now() - value.createdAt > CONFIG.PENDING_TRANSFER_TTL_MS) {
    gmSetValue(CONFIG.PENDING_TRANSFER_KEY, null);
    return null;
  }
  return value;
}

function isLectureContestUrl(url) {
  try {
    const match = new URL(url, "https://atcoder.jp").pathname.match(/^\/contests\/([^/]+)/);
    return !!match && CONFIG.LECTURE_CONTEST_REGEX.test(match[1]);
  } catch (_) {
    return false;
  }
}

function isSubmissionDetailUrl(url) {
  if (!isLectureContestUrl(url)) return false;
  const pathname = new URL(url, "https://atcoder.jp").pathname;
  return /^\/contests\/[^/]+\/submissions\/[^/?#]+\/?$/.test(pathname)
    && !/\/submissions\/me\/?$/.test(pathname);
}

function isLectureTaskListUrl(url) {
  if (!isLectureContestUrl(url)) return false;
  const pathname = new URL(url, "https://atcoder.jp").pathname;
  return /\/tasks\/?$/.test(pathname) || /\/submissions\/me\/?$/.test(pathname);
}

function isLectureSubmissionListUrl(url) {
  if (!isLectureContestUrl(url)) return false;
  const pathname = new URL(url, "https://atcoder.jp").pathname;
  return /^\/contests\/[^/]+\/submissions\/?$/.test(pathname);
}

function extractLoggedInUsername() {
  const candidates = [
    ".navbar-right a[href*='/users/']",
    ".navbar-nav a[href*='/users/']",
    "#navbar-collapse a[href*='/users/']",
    ".navbar a[href*='/users/']",
    "header a[href*='/users/']",
    "a.dropdown-toggle[href*='/users/']"
  ];
  for (const selector of candidates) {
    const link = document.querySelector(selector);
    const match = link?.getAttribute("href")?.match(/^\/users\/([^/?#]+)\/?$/);
    if (match) return decodeURIComponent(match[1]).trim();
  }

  const meta = document.querySelector("meta[name='current-user'], meta[name='username']");
  const metaName = meta?.getAttribute("content")?.trim();
  if (metaName) return metaName;
  return "";
}

function extractSubmissionUsername() {
  const labeledElements = Array.from(document.querySelectorAll("th, dt"));
  for (const heading of labeledElements) {
    const label = (heading.textContent || "").trim().replace(/[:：]\s*$/, "");
    if (!/^(提出者|ユーザ|ユーザー|User|Username)$/i.test(label)) continue;
    const row = heading.closest("tr");
    if (row) {
      const index = Array.from(row.children).indexOf(heading);
      const cell = row.children[index + 1];
      const link = cell?.querySelector("a[href*='/users/']");
      const match = link?.getAttribute("href")?.match(/^\/users\/([^/?#]+)\/?$/);
      if (match) return decodeURIComponent(match[1]).trim();
      const text = cell?.textContent?.trim();
      if (text) return text;
    }
    const list = heading.closest("dl");
    const sibling = heading.nextElementSibling;
    const link = sibling?.querySelector("a[href*='/users/']");
    const match = link?.getAttribute("href")?.match(/^\/users\/([^/?#]+)\/?$/);
    if (match) return decodeURIComponent(match[1]).trim();
    const text = sibling?.textContent?.trim();
    if (text) return text;
  }

  const links = Array.from(document.querySelectorAll("table a[href*='/users/']"));
  for (const link of links) {
    const match = link.getAttribute("href")?.match(/^\/users\/([^/?#]+)\/?$/);
    if (match) return decodeURIComponent(match[1]).trim();
  }
  return "";
}

function isOwnSubmissionDetail() {
  const loggedIn = extractLoggedInUsername();
  const submitter = extractSubmissionUsername();
  if (!loggedIn || !submitter) return false;
  return loggedIn.toLowerCase() === submitter.toLowerCase();
}

function createBadge(label, color) {
  const badge = document.createElement("span");
  badge.textContent = label;
  badge.style.cssText =
    `display:inline-block;margin-left:6px;padding:1px 5px;border-radius:3px;` +
    `background:${color};color:white;font-size:12px;line-height:1.5;vertical-align:middle;`;
  return badge;
}

function removeSubmittedTask(targetUrl) {
  const normalized = normalizeAtCoderUrl(targetUrl);
  const submitted = getSubmittedTasks();
  delete submitted[normalized];
  setSubmittedTasks(submitted);
}

function sanitizeSubmissionSource(source) {
  if (typeof source !== "string") return "";
  let code = source.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  if (!code) return "";

  code = code.replace(/^123456789101112131415161718192021/, "");

  const garbagePatterns = [
    /X{20,}/,
    /[\u0590-\u05FF]{20,}/
  ];
  let cutoff = code.length;
  garbagePatterns.forEach(pattern => {
    const match = pattern.exec(code);
    if (match && match.index < cutoff) cutoff = match.index;
  });
  code = code.slice(0, cutoff).trimEnd();

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(code)) return "";
  return code;
}

async function extractSubmissionCode() {
  const analyzeSourcePayload = (source, origin) => {
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const control = source.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length || 0;
    const hebrew = source.match(/[\u0590-\u05FF]/g)?.length || 0;
    const xCount = (source.match(/X/g)?.length || 0);
    const snapshot = {
      origin,
      length: source.length,
      fnvHash32: (hash >>> 0).toString(16).padStart(8, "0"),
      newlineCount: (source.match(/\n/g)?.length || 0),
      controlCharCount: control,
      hebrewCharCount: hebrew,
      xCharCount: xCount,
      prefix: source.slice(0, 120),
      suffix: source.slice(-120),
      sourceCode: source
    };
    console.groupCollapsed("[APCB] source extracted from lecture page");
    console.log(snapshot);
    console.log("[APCB] exact source payload:", source);
    console.groupEnd();
    return snapshot;
  };

  const copyTargets = Array.from(document.querySelectorAll(".btn-copy"));
  for (const copyButton of copyTargets) {
    const targetId = copyButton.getAttribute("data-target");
    if (!targetId) continue;
    const target = document.getElementById(targetId);
    if (!target) continue;
    const targetCode = sanitizeSubmissionSource(target.textContent || "");
    if (!targetCode) continue;
    analyzeSourcePayload(targetCode, `copy-button data-target#${targetId}`);
    return targetCode;
  }

  const codeElement = document.querySelector("pre#submission-code");
  if (codeElement) {
    const copyButton = codeElement.parentElement?.querySelector(".btn-copy")
      || codeElement.closest(".part")?.querySelector(".btn-copy")
      || document.querySelector(".btn-copy");
    if (copyButton) {
      copyButton.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        if (navigator.clipboard?.readText) {
          const clipboardCode = (await navigator.clipboard.readText())
            .replace(/\r\n?/g, "\n")
            .replace(/^\uFEFF/, "");
          if (clipboardCode.trim()
            && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(clipboardCode)) {
            const sanitized = sanitizeSubmissionSource(clipboardCode);
            if (sanitized) {
              analyzeSourcePayload(sanitized, "clipboard/.btn-copy sanitized");
              return sanitized;
            }
          }
        }
      } catch (_) {}
    }
  }

  const element = document.querySelector("pre#submission-code");
  if (!element) return "";

  const clone = element.cloneNode(true);
  clone.querySelectorAll(
    ".linenums, .lineno, [class*='line-number'], [data-line-number]"
  ).forEach(node => node.remove());

  const code = (clone.textContent || "").replace(/\r\n?/g, "\n");
  if (!code.trim()) return "";
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(code)) return "";
  const normalizedCode = sanitizeSubmissionSource(code);
  if (!normalizedCode) return "";
  analyzeSourcePayload(normalizedCode, "fallback/pre#submission-code clone");
  return normalizedCode;
}

function extractLanguageName() {
  const labels = Array.from(document.querySelectorAll("th, dt"));
  for (const heading of labels) {
    const label = (heading.textContent || "").trim();
    if (!/^言語|language/i.test(label)) continue;
    const row = heading.closest("tr");
    if (row) {
      const index = Array.from(row.children).indexOf(heading);
      const cell = row.children[index + 1];
      if (cell) {
        const text = (cell.textContent || "").trim();
        if (text) return text;
      }
    }
    const list = heading.closest("dl");
    if (list) {
      const sibling = heading.nextElementSibling;
      const text = (sibling?.textContent || "").trim();
      if (text) return text;
    }
  }
  const candidates = [
    "#submission-language",
    "[class*='language']",
    "select[name='data.LanguageId']"
  ];
  for (const selector of candidates) {
    const element = document.querySelector(selector);
    if (element) {
      const text = (element.value || element.textContent || "").trim();
      if (text) return text;
    }
  }
  return "";
}

function extractLectureProblemUrl() {
  const links = Array.from(document.querySelectorAll("a[href*='/tasks/']"));
  const currentContestLink = links.find(link => {
    try {
      const url = new URL(link.href, location.origin);
      return url.pathname.includes(`/contests/${location.pathname.split("/")[2]}/tasks/`);
    } catch (_) {
      return false;
    }
  });
  if (currentContestLink) return normalizeAtCoderUrl(currentContestLink.href);

  const canonical = document.querySelector("link[rel='canonical']");
  if (canonical && /\/tasks\/[^/]+/.test(canonical.href)) return canonical.href;
  return location.href;
}

function findStatusElement() {
  const candidates = Array.from(document.querySelectorAll(
    "span.label, span.badge, td.status, th.status, " +
    "table tbody tr td, table tbody tr th, #main-container, main"
  ));
  const directStatus = candidates.find(element => {
    const text = (element.textContent || "").trim();
    return /^(AC|WJ|Judging|WA|TLE|MLE|RE|CE|OLE|IE)$/i.test(text);
  });
  if (directStatus) return directStatus;

  const statusLabels = Array.from(document.querySelectorAll(
    "span.label, span.badge, .status, [class*='status']"
  ));
  return statusLabels.find(element =>
    /^(AC|WJ|Judging|WA|TLE|MLE|RE|CE|OLE|IE)$/i.test(
      (element.textContent || "").trim()
    )
  ) || null;
}

function getSubmissionStatus() {
  const statusElement = findStatusElement();
  if (!statusElement) return null;
  return (statusElement.textContent || "").trim().toUpperCase();
}

function showSubmissionDuplicate(targetUrl) {
  const container = document.createElement("div");
  container.style.cssText = "margin:12px 0;";
  const badge = createBadge("[本家AC記録済]", "#28a745");
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "[記録解除]";
  removeButton.style.marginLeft = "6px";
  removeButton.addEventListener("click", () => {
    if (!confirm("本家AC記録を解除しますか？")) return;
    removeSubmittedTask(targetUrl);
    container.remove();
  });
  container.append(badge, removeButton);
  const main = document.querySelector("#main-container, main, body");
  (main || document.body).prepend(container);
}

let submissionTransferStarted = false;
function monitorSubmissionDetail() {
  if (submissionTransferStarted) return;
  if (!isOwnSubmissionDetail()) return;

  const status = findStatusElement();
  const text = getSubmissionStatus();
  if (text !== "AC") return;

  submissionTransferStarted = true;
  const lectureUrl = extractLectureProblemUrl();
  const targetUrl = resolveOriginalTaskUrl(lectureUrl);
  if (!targetUrl) {
    submissionTransferStarted = false;
    return;
  }

  const normalizedTarget = normalizeAtCoderUrl(targetUrl);
  if (getSubmittedTasks()[normalizedTarget]) {
    showSubmissionDuplicate(normalizedTarget);
    return;
  }

  const lectureSubmissionUrl = normalizeAtCoderUrl(location.href);
  const normalizedLectureUrl = normalizeAtCoderUrl(lectureUrl);
  const existingQueueItem = getTransferQueue().find(item => {
    if (normalizeAtCoderUrl(item.targetUrl) !== normalizedTarget) return false;
    if (!Number.isFinite(item.createdAt) ||
        Date.now() - item.createdAt > CONFIG.PENDING_TRANSFER_TTL_MS) return false;
    if (item.lectureSubmissionUrl) {
      return normalizeAtCoderUrl(item.lectureSubmissionUrl) === lectureSubmissionUrl;
    }
    return ["submitted", "ac", "finished"].includes(item.state) &&
      normalizeAtCoderUrl(item.lectureUrl) === normalizedLectureUrl;
  });
  if (existingQueueItem) {
    if (existingQueueItem.state === "ready") {
      showTransferPopup({
        ...existingQueueItem,
        queueId: existingQueueItem.id
      });
    } else if (existingQueueItem.state === "submitted") {
      showTransferPopupStatus("提出しました。採点中...", 5000);
    } else if (existingQueueItem.state === "finished") {
      showTransferPopupStatus(
        `本家判定: ${existingQueueItem.status || "終了"}`,
        5000
      );
    }
    return;
  }

  const waitUntil = Date.now() + 8000;
  const prepareTransfer = async () => {
    const languageName = extractLanguageName();
    const sourceCode = await extractSubmissionCode();
    if (sourceCode.trim() && languageName) {
      console.group("[APCB] pending transfer payload");
      console.log({
        length: sourceCode.length,
        fnvHash32: (() => {
          let hash = 2166136261;
          for (let i = 0; i < sourceCode.length; i++) {
            hash ^= sourceCode.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          return (hash >>> 0).toString(16).padStart(8, "0");
        })(),
        prefix: sourceCode.slice(0, 120),
        suffix: sourceCode.slice(-120),
        sourceCode
      });
      console.log("[APCB] exact pending source payload:", sourceCode);
      console.groupEnd();
      const createdAt = Date.now();
      const queueItem = {
        id: `${normalizedTarget}#${createdAt}`,
        state: "ready",
        targetUrl: normalizedTarget,
        lectureUrl: normalizeAtCoderUrl(lectureUrl),
        lectureSubmissionUrl: normalizeAtCoderUrl(location.href),
        languageName,
        sourceCode,
        createdAt,
        notificationClaimed: false
      };
      const queue = getTransferQueue();
      queue.unshift(queueItem);
      setTransferQueue(queue.slice(0, 20));
      gmSetValue(CONFIG.PENDING_TRANSFER_KEY, {
        targetUrl: normalizedTarget,
        lectureUrl: normalizeAtCoderUrl(lectureUrl),
        lectureSubmissionUrl: normalizeAtCoderUrl(location.href),
        languageName,
        sourceCode,
        createdAt,
        queueId: queueItem.id
      });
      showTransferPopup({
        targetUrl: normalizedTarget,
        languageName,
        sourceCode,
        queueId: queueItem.id,
        createdAt,
        lectureUrl: normalizeAtCoderUrl(lectureUrl)
      });
      return;
    }

    if (Date.now() < waitUntil) {
      setTimeout(prepareTransfer, 100);
      return;
    }

    submissionTransferStarted = false;
  };
  prepareTransfer();
}

function waitForStatus() {
  const initial = getSubmissionStatus();
  if (initial === "AC") {
    monitorSubmissionDetail();
  }

  const observer = new MutationObserver(() => {
    const status = getSubmissionStatus();
    if (status === "AC") {
      monitorSubmissionDetail();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(monitorSubmissionDetail, 1000);
}

function waitForElement(selector, timeoutMs, callback) {
  const deadline = Date.now() + timeoutMs;
  const timer = setInterval(() => {
    const element = document.querySelector(selector);
    if (element) {
      clearInterval(timer);
      callback(element);
    } else if (Date.now() >= deadline) {
      clearInterval(timer);
    }
  }, 100);
}

function selectLanguage(languageName) {
  if (!languageName) return;
  const select = document.querySelector("select[name='data.LanguageId']");
  if (!select) return;

  const options = Array.from(select.options);
  const normalizeLanguage = name => (name || "").trim().replace(/\s+/g, " ").toLowerCase();
  const wanted = normalizeLanguage(languageName);
  const exact = options.find(
    option => normalizeLanguage(option.textContent) === wanted
  );
  const prefix = options.find(option => {
    const name = normalizeLanguage(option.textContent);
    return name.startsWith(wanted) || wanted.startsWith(name);
  });
  const selected = exact || prefix;
  if (!selected) return;

  select.value = selected.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setWorkspaceStoredCode(sourceCode, languageName) {
  const pathMatch = new URL(location.href, "https://atcoder.jp").pathname.match(
    /^\/contests\/([^/]+)\/tasks\/([^/?#]+)/
  );
  if (!pathMatch) return false;

  const select = document.querySelector("select[name='data.LanguageId']");
  if (!select) return false;

  if (languageName) selectLanguage(languageName);
  const languageId = select.value;
  if (!languageId) return false;

  const contestId = pathMatch[1];
  const problemId = decodeURIComponent(pathMatch[2]);
  const storageKey = `code:${contestId}:${problemId}:${languageId}`;
  const backupKey = `backup_code:${contestId}:${problemId}:${languageId}`;

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ [storageKey]: sourceCode }).catch?.(() => {});
  }
  try {
    localStorage.setItem(backupKey, JSON.stringify({
      code: sourceCode,
      timestamp: Date.now()
    }));
  } catch (_) {}

  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function hasAtCoderWorkspaceEditor() {
  if (document.querySelector("#atcoder-workspace-editor, [data-atcoder-workspace], .atcoder-workspace")) {
    return true;
  }
  return Array.from(document.querySelectorAll("iframe")).some(iframe => {
    const src = iframe.getAttribute("src") || "";
    return /workspace|atcoder-workspace|editor/i.test(src)
      || iframe.title?.toLower?.().includes("workspace");
  });
}

function setLegacySourceCode(sourceCode) {
  const setEditorValue = () => {
    const textareas = Array.from(document.querySelectorAll(
      "textarea[name='sourceCode'], textarea[name='source'], textarea#sourceCode, " +
      "textarea#plain-textarea, textarea.CodeMirror-code, .CodeMirror textarea"
    ));
    let changed = false;

    textareas.forEach(textarea => {
      const prototype = Object.getPrototypeOf(textarea);
      const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(textarea, sourceCode);
      } else if (textarea.value !== sourceCode) {
        textarea.value = sourceCode;
      }
      ["input", "change", "keyup"].forEach(type => {
        textarea.dispatchEvent(new Event(type, { bubbles: true }));
      });
      changed = changed || textarea.value === sourceCode;

      const linkedEditor = textarea.CodeMirror
        || textarea.nextElementSibling?.CodeMirror
        || textarea.closest(".CodeMirror")?.CodeMirror;
      if (linkedEditor && typeof linkedEditor.setValue === "function") {
        linkedEditor.setValue(sourceCode);
        changed = true;
      }
    });

    document.querySelectorAll(".CodeMirror").forEach(element => {
      if (element.CodeMirror && typeof element.CodeMirror.setValue === "function") {
        element.CodeMirror.setValue(sourceCode);
        changed = true;
      }
    });
    if (typeof window.CodeMirror?.setValue === "function") {
      window.CodeMirror.setValue(sourceCode);
      changed = true;
    }
    if (Array.isArray(window.CodeMirror?.editors)) {
      window.CodeMirror.editors.forEach(editor => {
        if (typeof editor?.setValue === "function") {
          editor.setValue(sourceCode);
          changed = true;
        }
      });
    }
    [window.editor, window.CodeMirrorEditor, window.sourceEditor].forEach(editor => {
      if (typeof editor?.setValue === "function") {
        editor.setValue(sourceCode);
        changed = true;
      }
    });
    if (typeof window.ace?.edit === "function") {
      document.querySelectorAll(".ace_editor").forEach(element => {
        const editor = window.ace.edit(element);
        if (typeof editor?.setValue === "function") {
          editor.setValue(sourceCode, -1);
          changed = true;
        }
      });
    }
    return changed;
  };

  setEditorValue();
  setTimeout(setEditorValue, 500);
  setTimeout(setEditorValue, 2000);
}

function setSourceCode(sourceCode, languageName) {
  const logSourcePayload = (phase) => {
    let hash = 2166136261;
    for (let i = 0; i < sourceCode.length; i++) {
      hash ^= sourceCode.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    console.group(`[APCB] original page payload: ${phase}`);
    console.log({
      length: sourceCode.length,
      fnvHash32: (hash >>> 0).toString(16).padStart(8, "0"),
      newlineCount: (sourceCode.match(/\n/g)?.length || 0),
      controlCharCount: (sourceCode.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length || 0),
      hebrewCharCount: (sourceCode.match(/[\u0590-\u05FF]/g)?.length || 0),
      xCharCount: (sourceCode.match(/X/g)?.length || 0),
      prefix: sourceCode.slice(0, 120),
      suffix: sourceCode.slice(-120),
      sourceCode
    });
    console.log("[APCB] exact original-page payload:", sourceCode);
    console.groupEnd();
  };
  logSourcePayload("before insertion");
  const sendAtCoderSource = () => {
    if (isExtensionContextValid()) {
      safeRuntimeSendMessage({
        type: "setAtCoderSource",
        sourceCode
      }, response => {
        console.log("[APCB] original page insertion response:", response);
        logSourcePayload("after insertion request");
      });
    }
  };
  sendAtCoderSource();
  setTimeout(sendAtCoderSource, 500);
  setTimeout(sendAtCoderSource, 2000);

  if (hasAtCoderWorkspaceEditor()) {
    setWorkspaceStoredCode(sourceCode, languageName);
    const sendWorkspaceCode = () => {
      if (isExtensionContextValid()) {
        safeRuntimeSendMessage({
          type: "setWorkspaceCode",
          sourceCode
        });
      }
    };
    sendWorkspaceCode();
    setTimeout(sendWorkspaceCode, 500);
    setTimeout(sendWorkspaceCode, 2000);
  }
  setLegacySourceCode(sourceCode);
}

function showTransferBanner() {
  if (document.querySelector("#apcb-auto-transfer-banner")) return;
  const banner = document.createElement("div");
  banner.id = "apcb-auto-transfer-banner";
  banner.textContent = "【自動転記済】このページの『提出』ボタンを押すと本家ACとして記録されます";
  banner.style.cssText =
    "margin:12px 0;padding:10px;border:1px solid #28a745;border-radius:4px;" +
    "background:#d4edda;color:#155724;font-weight:bold;";
  const form = document.querySelector("form[action*='/submit']");
  (form ? form.parentElement : document.querySelector("#main-container, main, body"))?.prepend(banner);
}

function hookOriginalSubmit() {
  const form = document.querySelector("form[action*='/submit']");
  if (!form) return;

  form.addEventListener("submit", () => {
    const pending = getPendingTransfer();
    if (!pending) return;
    if (normalizeAtCoderUrl(location.href) !== normalizeAtCoderUrl(pending.targetUrl)) return;

    const submitted = getSubmittedTasks();
    submitted[normalizeAtCoderUrl(location.href)] = {
      timestamp: Date.now(),
      lectureUrl: pending.lectureUrl || document.referrer || ""
    };
    setSubmittedTasks(submitted);
    gmSetValue(CONFIG.PENDING_TRANSFER_KEY, null);
  });

  showTransferBanner();
}

function processOriginalTaskPage() {
  const pending = getPendingTransfer();
  if (!pending) return;
  if (normalizeAtCoderUrl(location.href) !== normalizeAtCoderUrl(pending.targetUrl)) return;

  waitForElement("select[name='data.LanguageId']", 5000, () => selectLanguage(pending.languageName));
  setSourceCode(pending.sourceCode, pending.languageName);
  setTimeout(hookOriginalSubmit, 100);
  waitForElement("form[action*='/submit']", 5000, hookOriginalSubmit);
}

function renderTaskListBadges() {
  const submitted = getSubmittedTasks();
  document.querySelectorAll("tbody tr").forEach(row => {
    const links = Array.from(row.querySelectorAll("a[href*='/tasks/']"));
    if (links.length === 0) return;

    let targetLink = links[links.length - 1];
    const linksByHref = new Map();
    links.forEach(link => {
      const href = normalizeAtCoderUrl(link.href);
      const matches = linksByHref.get(href) || [];
      matches.push(link);
      linksByHref.set(href, matches);
    });
    for (const matches of linksByHref.values()) {
      if (matches.length >= 2) {
        targetLink = matches[1];
        break;
      }
    }

    const targetUrl = resolveOriginalTaskUrl(targetLink.href);
    if (!targetUrl) return;
    const normalized = normalizeAtCoderUrl(targetUrl);

    if (!submitted[normalized]) {
      targetLink.dataset.lectureSyncBadged = "false";
      targetLink.nextElementSibling?.classList?.contains("lecture-sync-ac-badge") &&
        targetLink.nextElementSibling.remove();
      targetLink.nextElementSibling?.classList?.contains("lecture-sync-ac-remove") &&
        targetLink.nextElementSibling.remove();
      return;
    }

    const existingBadge = targetLink.nextElementSibling;
    const existingRemove = existingBadge?.nextElementSibling;
    if (
      targetLink.dataset.lectureSyncBadged === "true" &&
      existingBadge?.classList?.contains("lecture-sync-ac-badge") &&
      existingRemove?.classList?.contains("lecture-sync-ac-remove")
    ) {
      return;
    }

    targetLink.dataset.lectureSyncBadged = "false";
    if (existingBadge?.classList?.contains("lecture-sync-ac-badge")) existingBadge.remove();
    if (existingRemove?.className?.includes("lecture-sync-ac-remove")) existingRemove.remove();

    const badge = document.createElement("span");
    badge.className = "lecture-sync-ac-badge";
    badge.textContent = "[本家AC記録済]";
    badge.style.setProperty("background", "#28a745", "important");
    badge.style.setProperty("color", "#ffffff", "important");
    badge.style.setProperty("border-radius", "3px", "important");
    badge.style.setProperty("display", "inline-block", "important");
    badge.style.setProperty("margin", "0 4px", "important");
    badge.style.setProperty("padding", "1px 5px", "important");
    badge.style.setProperty("font-size", "12px", "important");
    badge.style.setProperty("line-height", "1.5", "important");
    badge.style.setProperty("vertical-align", "middle", "important");

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "lecture-sync-ac-remove";
    removeButton.textContent = "[解除]";
    removeButton.style.setProperty("margin-left", "0", "important");
    removeButton.style.setProperty("font-size", "11px", "important");
    removeButton.style.setProperty("display", "inline-block", "important");
    removeButton.addEventListener("click", event => {
      event.preventDefault();
      if (!confirm("本家AC記録を解除しますか？")) return;
      removeSubmittedTask(normalized);
      badge.remove();
      removeButton.remove();
      targetLink.dataset.lectureSyncBadged = "false";
    });

    targetLink.insertAdjacentElement("afterend", badge);
    badge.insertAdjacentElement("afterend", removeButton);
    targetLink.dataset.lectureSyncBadged = "true";
  });
}

function observeTaskLists() {
  renderTaskListBadges();
  applyDifficultyDisplays();
  document.querySelectorAll("tbody").forEach(tbody => {
    const observer = new MutationObserver(() => {
      renderTaskListBadges();
      applyDifficultyDisplays();
    });
    observer.observe(tbody, { childList: true, subtree: true });
  });
  setInterval(() => {
    renderTaskListBadges();
    applyDifficultyDisplays();
  }, 1000);
}

function observeSubmissionListColors() {
  applyDifficultyDisplays();
  document.querySelectorAll("tbody").forEach(tbody => {
    const observer = new MutationObserver(() => {
      applyDifficultyDisplays();
    });
    observer.observe(tbody, { childList: true, subtree: true });
  });
  setInterval(applyDifficultyDisplays, 1000);
}

let transferPopupHost = null;
let transferPopupStatus = null;
let transferPopupDismissTimer = null;
let transferPopupSubmitted = false;
let transferPopupSubmissionId = null;

function showTransferPopupStatus(message, dismissAfterMs = 0) {
  if (!transferPopupStatus) {
    transferPopupStatus = document.createElement("div");
    transferPopupStatus.id = "apcb-transfer-status";
    transferPopupStatus.setAttribute("role", "status");
    transferPopupStatus.setAttribute("aria-live", "polite");
    transferPopupStatus.style.cssText =
      "position:fixed;top:12px;right:12px;z-index:2147483647;" +
      "max-width:280px;padding:8px 12px;background:#fff;color:#333;" +
      "border:1px solid #ccc;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.2);" +
      "font:13px sans-serif;";
    document.documentElement.append(transferPopupStatus);
  }
  if (transferPopupDismissTimer) {
    clearTimeout(transferPopupDismissTimer);
    transferPopupDismissTimer = null;
  }
  if (transferPopupStatus.textContent !== message) {
    transferPopupStatus.textContent = message;
  }
  if (dismissAfterMs > 0) {
    transferPopupDismissTimer = setTimeout(() => {
      transferPopupStatus?.remove();
      transferPopupStatus = null;
      transferPopupHost?.remove();
      transferPopupHost = null;
      transferPopupDismissTimer = null;
    }, dismissAfterMs);
  }
}

function isolateTurnstileInIframe(iframeDocument) {
  if (!iframeDocument) return null;
  const container = iframeDocument.querySelector(
    ".cf-challenge[data-sitekey], .cf-turnstile[data-sitekey], " +
    "[data-sitekey] input[name='cf-turnstile-response']"
  );
  if (!container) {
    const input = iframeDocument.querySelector("input[name='cf-turnstile-response']");
    return input?.closest("form")?.querySelector(
      ".cf-challenge, .cf-turnstile, [data-sitekey]"
    ) || null;
  }
  return container;
}

function showOnlyTurnstileContainer(iframeDocument) {
  return isolateTurnstileInIframe(iframeDocument);
}

function findNativeSubmitForm(iframeDocument) {
  return iframeDocument?.querySelector("form[action*='/submit']")
    || iframeDocument?.querySelector("form");
}

function setNativeSubmitForm(iframeDocument, pending) {
  const form = findNativeSubmitForm(iframeDocument);
  if (!form) return null;

  const taskMatch = new URL(pending.targetUrl).pathname.match(/\/tasks\/([^/?#]+)/);
  if (taskMatch) {
    const taskSelect = form.querySelector("select[name='data.TaskScreenName']");
    if (taskSelect) {
      taskSelect.value = decodeURIComponent(taskMatch[1]);
      taskSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  const taskId = taskMatch ? decodeURIComponent(taskMatch[1]) : "";
  const languageSelect = taskId
    ? form.querySelector(`select[name='data.LanguageId'].current`) ||
      form.querySelector(`#select-lang-${taskId} select`) ||
      form.querySelector("#select-lang select.current") ||
      form.querySelector("select[name='data.LanguageId']")
    : form.querySelector("select[name='data.LanguageId'].current") ||
      form.querySelector("select[name='data.LanguageId']");
  if (languageSelect && pending.languageName) {
    selectLanguageOnDocument(iframeDocument, languageSelect, pending.languageName);
  }

  return form;
}

function setNativeSourceCodeInPage(sourceCode, contestId, taskId) {
  return new Promise(resolve => {
    let finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const attempt = () => {
      if (finished) return;
      safeRuntimeSendMessage({
        type: "setNativeSubmitSource",
        sourceCode,
        contestId,
        taskId
      }, response => {
        if (response?.retry && !finished) {
          setTimeout(attempt, 200);
          return;
        }
        finish(response?.ok ? response : { success: false });
      });
    };
    const timeout = setTimeout(() => finish({ success: false }), 22000);
    attempt();
  });
}

function selectLanguageOnDocument(doc, select, languageName) {
  const wanted = (languageName || "").trim().replace(/\s+/g, " ").toLowerCase();
  const options = Array.from(select.options);
  const exact = options.find(option =>
    (option.textContent || "").trim().replace(/\s+/g, " ").toLowerCase() === wanted
  );
  const prefix = options.find(option => {
    const text = (option.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
    return text.startsWith(wanted) || wanted.startsWith(text);
  });
  const selected = exact || prefix;
  if (!selected) return;
  select.value = selected.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function findSubmissionId(targetUrl) {
  const target = new URL(targetUrl);
  const contestId = target.pathname.match(/^\/contests\/([^/]+)\//)?.[1];
  const taskId = decodeURIComponent(target.pathname.match(/\/tasks\/([^/?#]+)/)?.[1] || "");
  if (!contestId) return null;
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

async function pollSubmissionStatus(targetUrl, submissionId) {
  const target = new URL(targetUrl);
  const contestId = target.pathname.match(/^\/contests\/([^/]+)\//)?.[1];
  if (!contestId || !submissionId) return null;
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

function showTransferPopup(pending) {
  const queueItem = findTransferQueueItemForPending(pending);
  if (queueItem?.state === "submitted") {
    showTransferPopupStatus("提出しました。採点中...", 5000);
    return;
  }
  if (queueItem?.state === "ac") return;
  if (queueItem?.state === "finished") {
    showTransferPopupStatus(`本家判定: ${queueItem.status || "終了"}`, 5000);
    return;
  }

  if (transferPopupDismissTimer) clearTimeout(transferPopupDismissTimer);
  transferPopupStatus?.remove();
  transferPopupHost?.remove();
  transferPopupStatus = null;
  transferPopupDismissTimer = null;
  transferPopupHost = document.createElement("div");
  transferPopupHost.id = "apcb-transfer-popup";
  transferPopupHost.style.cssText =
    "position:fixed;top:0;right:0;width:1px;height:1px;overflow:hidden;" +
    "z-index:2147483646;opacity:.01;pointer-events:none;";
  document.documentElement.append(transferPopupHost);
  transferPopupHost.replaceChildren();
  transferPopupSubmitted = false;

  const target = new URL(pending.targetUrl);
  const contestId = target.pathname.match(/^\/contests\/([^/]+)\//)?.[1];
  const taskId = decodeURIComponent(target.pathname.match(/\/tasks\/([^/?#]+)/)?.[1] || "");
  if (!contestId || !taskId) return;

  const iframe = document.createElement("iframe");
  iframe.src = `https://atcoder.jp/contests/${contestId}/submit?taskScreenName=${encodeURIComponent(taskId)}`;
  iframe.style.cssText =
    "width:620px;height:650px;border:0;display:block;";
  transferPopupHost.append(iframe);
  showTransferPopupStatus("個人認証中...");

  let submittedAt = 0;
  let challengeRevealed = false;
  let challengeRevealTimer = null;
  iframe.addEventListener("load", () => {
    if (submittedAt) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const deadline = Date.now() + 60000;
      if (challengeRevealTimer) clearTimeout(challengeRevealTimer);
      challengeRevealTimer = setTimeout(() => {
        challengeRevealTimer = null;
        const token = doc.querySelector("input[name='cf-turnstile-response']");
        if (!transferPopupHost || submittedAt ||
            (token?.value && token.value.length > 20)) return;
        transferPopupHost.style.cssText =
          "position:fixed;top:12px;right:12px;width:640px;height:720px;overflow:visible;" +
          "z-index:2147483646;opacity:1;pointer-events:auto;background:#fff;" +
          "border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);";
        challengeRevealed = true;
      }, 10000);
      let sourceInjectionStarted = false;
      let sourceInjectionResult = null;
      const waitForm = setInterval(async () => {
        const form = setNativeSubmitForm(doc, pending);
        if (!form) {
          if (Date.now() >= deadline) {
            clearInterval(waitForm);
            showTransferPopupStatus("提出画面を読み込めませんでした", 5000);
          }
          return;
        }
        if (!sourceInjectionStarted) {
          sourceInjectionStarted = true;
          setNativeSourceCodeInPage(pending.sourceCode, contestId, taskId).then(result => {
            sourceInjectionResult = result;
            if (!result.success) {
              clearInterval(waitForm);
              showTransferPopupStatus("ソースコードを設定できませんでした", 5000);
            }
          }, error => {
            console.error("[APCB] source injection failed", error);
            sourceInjectionResult = { success: false };
            clearInterval(waitForm);
            showTransferPopupStatus("ソースコードを設定できませんでした", 5000);
          });
        }
        if (sourceInjectionResult && !sourceInjectionResult.success) return;
        const turnstileInput = form.querySelector("input[name='cf-turnstile-response']");
        if (!turnstileInput || !turnstileInput.value || turnstileInput.value.length <= 20) {
          showTransferPopupStatus("個人認証中...");
          if (Date.now() >= deadline) {
            clearInterval(waitForm);
            showTransferPopupStatus("個人認証を完了できませんでした");
          }
          return;
        }
        if (challengeRevealTimer) {
          clearTimeout(challengeRevealTimer);
          challengeRevealTimer = null;
        }
        if (challengeRevealed) {
          transferPopupHost.style.cssText =
            "position:fixed;top:0;right:0;width:1px;height:1px;overflow:hidden;" +
            "z-index:2147483646;opacity:.01;pointer-events:none;";
          challengeRevealed = false;
        }
        if (transferPopupSubmitted) return;
        if (!sourceInjectionResult?.success) {
          showTransferPopupStatus("提出準備中...");
          return;
        }
        console.log("[APCB] source injection verified", sourceInjectionResult);
        transferPopupSubmitted = true;
        clearInterval(waitForm);
        const submissionTimestamp = Date.now();
        const queue = getTransferQueue();
        const currentQueueItem = queue.find(item => item.id === queueItem?.id);
        if (currentQueueItem) {
          currentQueueItem.state = "submitted";
          currentQueueItem.submittedAt = submissionTimestamp;
          try {
            await persistTransferQueue(queue);
          } catch (error) {
            transferPopupSubmitted = false;
            currentQueueItem.state = "ready";
            delete currentQueueItem.submittedAt;
            setTransferQueue(queue);
            clearInterval(pollStatus);
            showTransferPopupStatus("提出状態を保存できませんでした", 5000);
            console.error("[APCB] failed to persist submission state", error);
            return;
          }
        }
        submittedAt = Date.now();
        showTransferPopupStatus("提出しました。採点中...");
        const submitButton = form.querySelector("button[type='submit'], input[type='submit']");
        try {
          if (typeof form.requestSubmit === "function") {
            submitButton ? form.requestSubmit(submitButton) : form.requestSubmit();
          } else {
            form.submit();
          }
        } catch (error) {
          submittedAt = 0;
          transferPopupSubmitted = false;
          if (currentQueueItem) {
            currentQueueItem.state = "ready";
            delete currentQueueItem.submittedAt;
            setTransferQueue(queue);
          }
          clearInterval(pollStatus);
          showTransferPopupStatus("提出を開始できませんでした", 5000);
          console.error("[APCB] native submission failed", error);
        }
      }, 250);

      const pollStatus = setInterval(async () => {
        if (!submittedAt) return;
        if (Date.now() - submittedAt < 3000) return;
        if (!transferPopupSubmissionId) {
          transferPopupSubmissionId = await findSubmissionId(pending.targetUrl);
          if (!transferPopupSubmissionId) return;
          const queue = getTransferQueue();
          const currentQueueItem = queue.find(item => item.id === queueItem?.id);
          if (currentQueueItem) {
            currentQueueItem.submissionId = transferPopupSubmissionId;
            setTransferQueue(queue);
          }
        }
        const submitStatus = await pollSubmissionStatus(pending.targetUrl, transferPopupSubmissionId);
        if (submitStatus === "AC") {
          clearInterval(pollStatus);
          showTransferPopupStatus("本家ACを確認しました", 5000);
          const submitted = getSubmittedTasks();
          submitted[normalizeAtCoderUrl(pending.targetUrl)] = {
            status: "AC",
            timestamp: Date.now(),
            lectureUrl: pending.lectureUrl || ""
          };
          setSubmittedTasks(submitted);
          const queue = getTransferQueue();
          const currentQueueItem = queue.find(item => item.id === queueItem?.id);
          if (currentQueueItem) {
            currentQueueItem.state = "ac";
            currentQueueItem.notificationClaimed = false;
            setTransferQueue(queue);
          }
        } else if (submitStatus && /^(WJ|JUDGING)$/i.test(submitStatus)) {
          showTransferPopupStatus("提出しました。採点中...");
        } else if (submitStatus) {
          clearInterval(pollStatus);
          showTransferPopupStatus(`本家判定: ${submitStatus}`, 5000);
        }
      }, 3000);
    } catch (error) {
      showTransferPopupStatus("提出ページの読み込みに失敗しました", 5000);
    }
  });
}

let globalQueueHost = null;
let globalQueueDismissTimer = null;
function renderGlobalQueueStatus() {
  if (!isLectureContestUrl(location.href)) return;
  const queue = getTransferQueue();
  const acItems = queue.filter(item =>
    item.state === "ac" && !item.notificationClaimed
  );
  if (acItems.length === 0) return;

  acItems.forEach(item => {
    item.notificationClaimed = true;
  });
  setTransferQueue(queue);

  if (!globalQueueHost) {
    globalQueueHost = document.createElement("div");
    globalQueueHost.id = "apcb-transfer-global-status";
    globalQueueHost.style.cssText =
      "position:fixed;bottom:12px;right:12px;width:320px;z-index:2147483646;" +
      "background:#fff;border:1px solid #28a745;border-radius:8px;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.25);padding:10px;font:13px sans-serif;";
    document.documentElement.append(globalQueueHost);
  }
  globalQueueHost.textContent =
    acItems.map(item =>
      `${item.targetUrl?.split("/").pop() || "問題"}: 本家ACを確認しました`
    ).join("\n");
  if (globalQueueDismissTimer) clearTimeout(globalQueueDismissTimer);
  globalQueueDismissTimer = setTimeout(() => {
    globalQueueHost?.remove();
    globalQueueHost = null;
    globalQueueDismissTimer = null;
  }, 5000);
}

function main() {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  const pathname = new URL(location.href).pathname;
  document.addEventListener("click", event => {
    if (!event.altKey) return;
    const link = event.target?.closest?.("a[href*='/tasks/']");
    if (!link) return;
    if (!isLectureContestUrl(location.href)) return;
    const targetUrl = resolveOriginalTaskUrl(link.href);
    if (!targetUrl) return;
    event.preventDefault();
    event.stopPropagation();
    if (isExtensionContextValid()) {
      safeRuntimeSendMessage({ type: "openInTab", url: targetUrl });
    } else {
      window.open(targetUrl, "_blank");
    }
  }, true);

  if (isLectureContestUrl(location.href)) {
    const pending = getPendingTransfer();
    if (pending) showTransferPopup(pending);
    renderGlobalQueueStatus();
    if (isExtensionContextValid()) {
      safeRuntimeSendMessage({ type: "pollTransferQueue" });
      setInterval(() => {
        safeRuntimeSendMessage({ type: "pollTransferQueue" });
      }, 10000);
    }
  }
  if (/\/standings\/?$/.test(pathname)) {
    applyDifficultyDisplays();
    const observer = new MutationObserver(applyDifficultyDisplays);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(applyDifficultyDisplays, 1000);
  } else if (/\/submissions\/me\/?$/.test(pathname)) {
    observeTaskLists();
  } else if (isLectureSubmissionListUrl(location.href)) {
    observeSubmissionListColors();
  } else if (isSubmissionDetailUrl(location.href)) {
    waitForStatus();
  } else if (isLectureTaskListUrl(location.href)) {
    observeTaskLists();
  } else if (
    isLectureContestUrl(location.href) &&
    /\/tasks\/[^/]+/.test(new URL(location.href).pathname)
  ) {
    applyDifficultyDisplays();
    const observer = new MutationObserver(applyDifficultyDisplays);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(applyDifficultyDisplays, 1000);
  }

}

if (typeof window !== "undefined") {
  window.resolveOriginalTaskUrl = resolveOriginalTaskUrl;
  window.normalizeDifficulty = normalizeDifficulty;
  window.getDifficultyColor = getDifficultyColor;
  window.extractTaskId = extractTaskId;
  window.findStatusElement = findStatusElement;
  window.getSubmissionStatus = getSubmissionStatus;
  window.extractSubmissionCode = extractSubmissionCode;
  window.sanitizeSubmissionSource = sanitizeSubmissionSource;
  window.extractLanguageName = extractLanguageName;
  window.setSourceCode = setSourceCode;
  window.hasAtCoderWorkspaceEditor = hasAtCoderWorkspaceEditor;
  window.isSubmissionDetailUrl = isSubmissionDetailUrl;
  window.isLectureTaskListUrl = isLectureTaskListUrl;
  window.isLectureSubmissionListUrl = isLectureSubmissionListUrl;
  window.extractLoggedInUsername = extractLoggedInUsername;
  window.extractSubmissionUsername = extractSubmissionUsername;
  window.isOwnSubmissionDetail = isOwnSubmissionDetail;
  window.CONFIG = CONFIG;
  const start = () => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(
        [
          CONFIG.SUBMITTED_TASKS_KEY,
          CONFIG.PENDING_TRANSFER_KEY,
          CONFIG.TRANSFER_QUEUE_KEY,
          CONFIG.PROBLEM_MODELS_CACHE_KEY
        ],
        values => {
          chromeStorageCache = {
            submitted_tasks:
              values[CONFIG.SUBMITTED_TASKS_KEY] || {},
            pending_transfer:
              values[CONFIG.PENDING_TRANSFER_KEY] || null,
            apcb_transfer_queue:
              values[CONFIG.TRANSFER_QUEUE_KEY] || [],
            problem_models_cache:
              values[CONFIG.PROBLEM_MODELS_CACHE_KEY] || null
          };
          if (chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
              if (areaName !== "local") return;
              if (changes.submitted_tasks) {
                chromeStorageCache.submitted_tasks =
                  changes.submitted_tasks.newValue || {};
              }
              if (changes.pending_transfer) {
                chromeStorageCache.pending_transfer =
                  changes.pending_transfer.newValue || null;
              }
              if (changes.apcb_transfer_queue) {
                chromeStorageCache.apcb_transfer_queue =
                  changes.apcb_transfer_queue.newValue || [];
                renderGlobalQueueStatus();
              }
              if (changes.problem_models_cache) {
                chromeStorageCache.problem_models_cache =
                  changes.problem_models_cache.newValue || null;
              }
              renderTaskListBadges();
              applyDifficultyDisplays();
            });
          }
          main();
          if (!getProblemModels() && isExtensionContextValid()) {
            safeRuntimeSendMessage(
              { type: "getProblemModels" },
              response => {
                if (response?.ok && response.models) {
                  chromeStorageCache.problem_models_cache = {
                    timestamp: Date.now(),
                    models: response.models
                  };
                  applyDifficultyDisplays();
                }
              }
            );
          }
        }
      );
    } else if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", main);
    } else {
      main();
    }
  };
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    start();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
}
