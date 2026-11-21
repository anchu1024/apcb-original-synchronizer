// ==UserScript==
// @name         APCB Original Synchronizer
// @namespace    https://github.com/anchu1024/apcb-original-synchronizer
// @version      1.0.0
// @description  Lecture contest AC submissions are transferred to their original AtCoder task.
// @match        https://atcoder.jp/contests/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// ==/UserScript==

const CONFIG = Object.freeze({
  LECTURE_CONTEST_REGEX: /^apcb_exercise_/,
  PENDING_TRANSFER_TTL_MS: 10 * 60 * 1000,
  SUBMITTED_TASKS_KEY: "submitted_tasks",
  PENDING_TRANSFER_KEY: "pending_transfer"
});

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

function gmGetValue(key, fallback) {
  try {
    if (typeof GM_getValue === "function") {
      const value = GM_getValue(key, fallback);
      return typeof value === "string" ? JSON.parse(value) : value;
    }
  } catch (_) {}
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function gmSetValue(key, value) {
  try {
    if (typeof GM_setValue === "function") {
      GM_setValue(key, typeof value === "string" ? value : JSON.stringify(value));
      return;
    }
  } catch (_) {}
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
  return isLectureContestUrl(url) && /\/submissions\/[^/?#]+/.test(new URL(url, "https://atcoder.jp").pathname);
}

function isLectureTaskListUrl(url) {
  if (!isLectureContestUrl(url)) return false;
  const pathname = new URL(url, "https://atcoder.jp").pathname;
  return /\/tasks\/?$/.test(pathname) || /\/submissions\/?$/.test(pathname);
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

function extractSubmissionCode() {
  const code = document.querySelector("#submission-code");
  if (code) return code.textContent || "";
  const pre = document.querySelector("pre#submission-code, pre.prettyprint, pre");
  return pre ? pre.textContent || "" : "";
}

function extractLanguageName() {
  const languageHeading = Array.from(document.querySelectorAll("th")).find(
    heading => /^言語|language/i.test((heading.textContent || "").trim())
  );
  if (languageHeading) {
    const row = languageHeading.closest("tr");
    const index = Array.from(row?.children || []).indexOf(languageHeading);
    const cell = row?.children[index + 1];
    if (cell && cell !== languageHeading) return (cell.textContent || "").trim();
  }
  const candidates = [
    "#submission-language",
    "[class*='language']",
    "table tbody tr td:nth-child(3)",
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
  const statusText = Array.from(document.querySelectorAll("table tbody tr td, table tbody tr th"))
    .find(element => /^(WJ|Judging|AC|WA|TLE|MLE|RE|CE|OLE|IE)$/i.test((element.textContent || "").trim()));
  return statusText || null;
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

  const status = findStatusElement();
  const text = (status?.textContent || "").trim();
  if (text !== "AC" && text !== "ac") return;

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

  gmSetValue(CONFIG.PENDING_TRANSFER_KEY, {
    targetUrl: normalizedTarget,
    languageName: extractLanguageName(),
    sourceCode: extractSubmissionCode(),
    createdAt: Date.now()
  });

  if (typeof GM_openInTab === "function") {
    GM_openInTab(normalizedTarget, { active: true });
  } else {
    window.open(normalizedTarget, "_blank");
  }
}

function waitForStatus() {
  const initial = findStatusElement();
  if (initial && /^(AC|WJ|Judging)$/i.test(initial.textContent.trim())) {
    monitorSubmissionDetail();
  }

  const observer = new MutationObserver(() => {
    const status = findStatusElement();
    if (status && /^(AC|WJ|Judging)$/i.test(status.textContent.trim())) {
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
  const exact = options.find(option => (option.textContent || "").trim() === languageName);
  const prefix = options.find(option => {
    const name = (option.textContent || "").trim();
    return name.startsWith(languageName) || languageName.startsWith(name);
  });
  const selected = exact || prefix;
  if (!selected) return;

  select.value = selected.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSourceCode(sourceCode) {
  const textarea = document.querySelector("textarea[name='sourceCode']");
  if (textarea) {
    textarea.value = sourceCode;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const setCodeMirrorValue = () => {
    if (textarea?.CodeMirror && typeof textarea.CodeMirror.setValue === "function") {
      textarea.CodeMirror.setValue(sourceCode);
    }
    if (window.CodeMirror && typeof window.CodeMirror.setValue === "function") {
      window.CodeMirror.setValue(sourceCode);
    }
    if (Array.isArray(window.CodeMirror?.editors)) {
      window.CodeMirror.editors.forEach(editor => {
        if (typeof editor?.setValue === "function") editor.setValue(sourceCode);
      });
    }
    document.querySelectorAll(".CodeMirror").forEach(element => {
      if (element.CodeMirror && typeof element.CodeMirror.setValue === "function") {
        element.CodeMirror.setValue(sourceCode);
      }
    });
  };

  setCodeMirrorValue();
  waitForElement("textarea[name='sourceCode']", 5000, () => setCodeMirrorValue());
  setTimeout(setCodeMirrorValue, 500);
  setTimeout(setCodeMirrorValue, 1500);
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
  setSourceCode(pending.sourceCode);
  setTimeout(hookOriginalSubmit, 100);
  waitForElement("form[action*='/submit']", 5000, hookOriginalSubmit);
}

function renderTaskListBadges() {
  const submitted = getSubmittedTasks();
  document.querySelectorAll("a[href*='/tasks/']").forEach(link => {
    if (link.dataset.apcbBadged === "true") return;

    const targetUrl = resolveOriginalTaskUrl(link.href);
    if (!targetUrl) return;
    const normalized = normalizeAtCoderUrl(targetUrl);
    if (!submitted[normalized]) return;

    link.dataset.apcbBadged = "true";
    const wrapper = link.nextElementSibling?.classList?.contains("apcb-record-controls");
    if (!wrapper) {
      const controls = document.createElement("span");
      controls.className = "apcb-record-controls";
      const badge = createBadge("[本家AC記録済]", "#28a745");
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "[解除]";
      removeButton.style.cssText = "margin-left:4px;font-size:11px;";
      removeButton.addEventListener("click", event => {
        event.preventDefault();
        if (!confirm("本家AC記録を解除しますか？")) return;
        removeSubmittedTask(normalized);
        controls.remove();
        link.dataset.apcbBadged = "false";
      });
      controls.append(badge, removeButton);
      link.insertAdjacentElement("afterend", controls);
    }
  });
}

function observeTaskLists() {
  renderTaskListBadges();
  const observer = new MutationObserver(renderTaskListBadges);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(renderTaskListBadges, 1000);
}

function main() {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  if (isSubmissionDetailUrl(location.href)) {
    waitForStatus();
  } else if (isLectureTaskListUrl(location.href)) {
    observeTaskLists();
  }

  const contestPath = new URL(location.href).pathname.match(/^\/contests\/([^/]+)/);
  if (contestPath && !CONFIG.LECTURE_CONTEST_REGEX.test(contestPath[1])) {
    processOriginalTaskPage();
  }
}

if (typeof window !== "undefined") {
  window.resolveOriginalTaskUrl = resolveOriginalTaskUrl;
  window.CONFIG = CONFIG;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
}
