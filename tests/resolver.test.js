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
