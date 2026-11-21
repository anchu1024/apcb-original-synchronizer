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
  assert.match(source, /document\.querySelectorAll\("tbody tr"\)/);
  assert.match(source, /observer\.observe\(tbody,/);
  assert.match(source, /#28a745", "important"\)/);
  assert.match(source, /#ffffff", "important"\)/);
  assert.doesNotMatch(source, /td:nth-child/);
});

test("Chrome MV3 manifest enables storage and AtCoder content scripts", () => {
  const manifest = JSON.parse(fs.readFileSync(
    new URL("../manifest.json", `file://${__dirname}/`).pathname,
    "utf8"
  ));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.host_permissions.includes("https://atcoder.jp/contests/*"));
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(
    manifest.content_scripts[0].js[0],
    "apcb-original-synchronizer.user.js"
  );
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
});
