const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  new URL("../apcb-original-synchronizer.user.js", `file://${__dirname}/`).pathname,
  "utf8"
);

function loadScript() {
  const context = {
    window: {},
    document: {
      readyState: "complete",
      addEventListener() {},
      documentElement: {}
    },
    location: { href: "https://atcoder.jp/" },
    localStorage: {
      getItem() { return null; },
      setItem() {}
    },
    URL,
    MutationObserver: class {},
    setInterval() {},
    setTimeout() {}
  };
  context.window.window = context.window;
  vm.runInNewContext(source, context);
  return context.window;
}

test("resolves APCB task URLs to original contests", () => {
  const scriptWindow = loadScript();
  assert.equal(
    scriptWindow.resolveOriginalTaskUrl("https://atcoder.jp/contests/apcb_exercise_2026_18/tasks/abc469_e"),
    "https://atcoder.jp/contests/abc469/tasks/abc469_e"
  );
  assert.equal(
    scriptWindow.resolveOriginalTaskUrl("https://atcoder.jp/contests/apcb_exercise_2026_18/tasks/arc180_a"),
    "https://atcoder.jp/contests/arc180/tasks/arc180_a"
  );
  assert.equal(
    scriptWindow.resolveOriginalTaskUrl("https://atcoder.jp/contests/apcb_exercise_2026_18/tasks/agc065_b"),
    "https://atcoder.jp/contests/agc065/tasks/agc065_b"
  );
  assert.equal(
    scriptWindow.resolveOriginalTaskUrl("https://atcoder.jp/contests/apcb_exercise_2026_18/tasks/typical90_a"),
    "https://atcoder.jp/contests/typical90/tasks/typical90_a"
  );
});

test("sanitizes known pasted garbage at source boundaries", () => {
  const scriptWindow = loadScript();
  const result = scriptWindow.sanitizeSubmissionSource(
    "123456789101112131415161718192021#include <bits/stdc++.h>\nint main() {}" +
    "ה".repeat(25) + "X".repeat(25)
  );
  assert.equal(result, "#include <bits/stdc++.h>\nint main() {}");
});

test("rejects non-lecture contests and malformed task IDs", () => {
  const scriptWindow = loadScript();
  assert.equal(
    scriptWindow.resolveOriginalTaskUrl("https://atcoder.jp/contests/abc469/tasks/abc469_e"),
    null
  );
  assert.equal(
    scriptWindow.resolveOriginalTaskUrl("https://atcoder.jp/contests/apcb_exercise_2026_18/tasks/abc469"),
    null
  );
});

test("task-list badges use isolated row DOM APIs and tbody observation", () => {
  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /document\.createElement\("span"\)/);
  assert.match(source, /insertAdjacentElement\("afterend", badge\)/);
  assert.match(source, /dataset\.lectureSyncBadged/);
  assert.match(source, /\[本家AC記録済\]/);
  assert.match(source, /lecture-sync-ac-badge/);
  assert.match(source, /document\.querySelectorAll\("tbody tr"\)/);
  assert.match(source, /observer\.observe\(tbody,/);
  assert.match(source, /#28a745", "important"\)/);
  assert.match(source, /#ffffff", "important"\)/);
  assert.match(source, /lecture-sync-ac-remove/);
  assert.match(source, /\[解除\]/);
  assert.doesNotMatch(source, /td:nth-child/);
});

test("standings and individual problem difficulty displays are configured", () => {
  assert.match(source, /standings/);
  assert.match(source, /a\[href\*='\/tasks\/'\]/);
  assert.match(source, /circle\.style\.setProperty\("width", "24px", "important"\)/);
  assert.match(source, /circle\.style\.setProperty\("height", "24px", "important"\)/);
  assert.match(source, /本家を開く/);
  assert.match(source, /insertAdjacentElement\("afterend", originalLink\)/);
});

test("live Turnstile popup submits through a native form", () => {
  assert.match(source, /function showTransferPopup/);
  assert.match(source, /iframe\.src = `https:\/\/atcoder\.jp\/contests\/\$\{contestId\}\/submit\?taskScreenName=/);
  assert.match(source, /cf-turnstile-response/);
  assert.match(source, /form\.requestSubmit/);
  assert.match(source, /submit\(\);/);
  assert.match(source, /function setNativeSourceCode/);
  assert.match(source, /win\?\.ace\?\.edit/);
  assert.match(source, /turnstileInput\.value\.length <= 20/);
  assert.match(source, /本家にも送信/);
  assert.match(source, /document\.addEventListener\("click", event =>/);
  assert.match(source, /event\.altKey/);
  assert.match(source, /chrome\.runtime\.sendMessage\(\{ type: "openInTab", url: targetUrl \}\)/);
  assert.match(source, /apcb_transfer_queue/);
  assert.match(source, /renderGlobalQueueStatus/);
});

test("submission detection is limited to the user's submissions list", () => {
  assert.match(source, /extractLoggedInUsername/);
  assert.match(source, /extractSubmissionUsername/);
  assert.match(source, /isOwnSubmissionDetail/);
  assert.match(source, /observeSubmissionListColors/);
});

test("recognizes submission detail and list routes generically", () => {
  const scriptWindow = loadScript();
  assert.equal(
    scriptWindow.isSubmissionDetailUrl(
      "https://atcoder.jp/contests/apcb_exercise_2026_18/submissions/me"
    ),
    false
  );
  assert.equal(
    scriptWindow.isSubmissionDetailUrl(
      "https://atcoder.jp/contests/apcb_exercise_2026_18/submissions/123456"
    ),
    true
  );
  assert.equal(
    scriptWindow.isLectureTaskListUrl(
      "https://atcoder.jp/contests/apcb_exercise_2026_18/submissions/me"
    ),
    true
  );
  assert.equal(
    scriptWindow.isLectureSubmissionListUrl(
      "https://atcoder.jp/contests/apcb_exercise_2026_18/submissions"
    ),
    true
  );
});

test("Chrome MV3 manifest enables storage and AtCoder content scripts", () => {
  const manifest = JSON.parse(fs.readFileSync(
    new URL("../manifest.json", `file://${__dirname}/`).pathname,
    "utf8"
  ));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("clipboardRead"));
  assert.ok(manifest.host_permissions.includes("https://atcoder.jp/contests/*"));
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(
    manifest.content_scripts[0].js[0],
    "apcb-original-synchronizer.user.js"
  );
});

test("background keeps and polls the global submission queue", () => {
  const background = fs.readFileSync(
    new URL("../background.js", `file://${__dirname}/`).pathname,
    "utf8"
  );
  assert.match(background, /apcb_transfer_queue/);
  assert.match(background, /pollTransferQueue/);
  assert.match(background, /submissions\/me/);
  assert.match(background, /notificationClaimed/);
  assert.match(background, /setInterval\(pollTransferQueue, 10000\)/);
});

test("Chrome extension uses storage and validated tab creation", () => {
  assert.match(source, /chrome\.storage\.local/);
  assert.match(source, /chrome\.runtime\.sendMessage/);
  assert.doesNotMatch(source, /GM_(getValue|setValue|openInTab)/);
  const background = fs.readFileSync(
    new URL("../background.js", `file://${__dirname}/`).pathname,
    "utf8"
  );
  assert.match(background, /chrome\.tabs\.create/);
  assert.match(background, /url\.origin !== "https:\/\/atcoder\.jp"/);
  assert.match(background, /setWorkspaceCode/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /allFrames: true/);
  assert.match(background, /world: "MAIN"/);
  assert.match(background, /setAtCoderSource/);
  assert.match(background, /ace\.edit\(editorElement\)/);
  assert.match(background, /plainTextarea/);
  assert.match(background, /jQuery\(element\)/);
  assert.match(background, /\[APCB\] MAIN world insertion/);
  assert.match(background, /exact actual Ace/);
  assert.match(background, /exact actual Workspace Monaco model/);
});

test("AC transfer waits for submission code and language extraction", () => {
  assert.match(source, /function getSubmissionStatus/);
  assert.match(source, /if \(text !== "AC"\) return/);
  assert.match(source, /const waitUntil = Date\.now\(\) \+ 8000/);
  assert.match(source, /sourceCode\.trim\(\) && languageName/);
  assert.match(source, /lectureUrl: normalizeAtCoderUrl\(lectureUrl\)/);
  assert.match(source, /querySelector\("pre#submission-code"\)/);
  assert.match(source, /cloneNode\(true\)/);
  assert.match(source, /navigator\.clipboard\?\.readText/);
  assert.match(source, /copyButton\.click\(\)/);
  assert.match(source, /getAttribute\("data-target"\)/);
  assert.match(source, /document\.getElementById\(targetId\)/);
  assert.match(source, /copy-button data-target/);
  assert.match(source, /\[APCB\] source extracted from lecture page/);
  assert.match(source, /\[APCB\] pending transfer payload/);
  assert.match(source, /\[APCB\] original page payload/);
  assert.match(source, /exact source payload/);
  assert.match(source, /normalizeLanguage\(option\.textContent\)/);
  assert.doesNotMatch(source, /"code"|"pre"/);
  assert.match(source, /textarea\[name='sourceCode'\]/);
  assert.match(source, /textarea#plain-textarea/);
  assert.match(source, /\["input", "change", "keyup"\]/);
  assert.match(source, /setTimeout\(sendAtCoderSource, 2000\)/);
  assert.match(source, /\.CodeMirror/);
  assert.match(source, /window\.ace/);
  assert.match(source, /code:\$\{contestId\}:\$\{problemId\}:\$\{languageId\}/);
  assert.match(source, /backup_code:\$\{contestId\}:\$\{problemId\}:\$\{languageId\}/);
  assert.match(source, /chrome\.storage\.local\.set/);
  assert.match(source, /function hasAtCoderWorkspaceEditor/);
  assert.match(source, /setWorkspaceStoredCode\(sourceCode, languageName\)/);
  assert.match(source, /setLegacySourceCode\(sourceCode\)/);
});

test("difficulty correction and official color palette", () => {
  const scriptWindow = loadScript();
  assert.equal(scriptWindow.normalizeDifficulty(-100), 311);
  assert.equal(scriptWindow.normalizeDifficulty(400), 400);
  assert.equal(scriptWindow.normalizeDifficulty(undefined), null);
  assert.equal(scriptWindow.getDifficultyColor(399), "#808080");
  assert.equal(scriptWindow.getDifficultyColor(400), "#804000");
  assert.equal(scriptWindow.getDifficultyColor(1200), "#00C0C0");
  assert.equal(scriptWindow.getDifficultyColor(2200), "#C0C000");
  assert.equal(scriptWindow.getDifficultyColor(2400), "#FF8000");
  assert.equal(scriptWindow.getDifficultyColor(2800), "#FF0000");
});

test("difficulty cache and Chrome MV3 background fetch are configured", () => {
  assert.match(source, /PROBLEM_MODELS_TTL_MS: 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /apcb-difficulty-circle/);
  assert.match(source, /beforebegin/);
  assert.match(source, /Difficulty: \$\{difficulty\}/);
  assert.match(source, /fillRatio/);
  assert.match(source, /linear-gradient\(to top/);
  assert.match(source, /difficulty >= 3200/);

  const manifest = JSON.parse(fs.readFileSync(
    new URL("../manifest.json", `file://${__dirname}/`).pathname,
    "utf8"
  ));
  assert.ok(manifest.host_permissions.includes("https://kenkoooo.com/*"));

  const background = fs.readFileSync(
    new URL("../background.js", `file://${__dirname}/`).pathname,
    "utf8"
  );
  assert.match(background, /problem_models_cache/);
  assert.match(background, /24 \* 60 \* 60 \* 1000/);
  assert.match(background, /kenkoooo\.com\/atcoder\/resources\/problem-models\.json/);
});
