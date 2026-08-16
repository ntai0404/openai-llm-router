const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBrowserSmokeLifecycle } = require("../electron/browser-smoke-state.cjs");
const { createStateStore } = require("../electron/state.cjs");

test("browser smoke lifecycle persists account-independent invalidation across restart", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-smoke-state-"));
  const file = path.join(root, "launcher-state.json");
  try {
    const store = createStateStore(file);
    const lifecycle = createBrowserSmokeLifecycle(store);
    const accountA = lifecycle.markSmokePassed("2.1.11");
    assert.equal(accountA.browserSmokePassed, true);
    assert.equal(lifecycle.isSmokePassed(accountA, "2.1.11"), true);

    const afterLogout = lifecycle.invalidateBrowserSmoke();
    assert.equal(afterLogout.browserSmokePassed, false);
    assert.equal(afterLogout.browserSmokeVersion, null);
    assert.equal(lifecycle.isSmokePassed(afterLogout, "2.1.11"), false);
    assert.deepEqual(createStateStore(file).read(), afterLogout);

    const accountB = lifecycle.markSmokePassed("2.1.11");
    assert.equal(accountB.browserSmokePassed, true);
    assert.equal(lifecycle.isSmokePassed(accountB, "2.1.11"), true);

    const restarted = createBrowserSmokeLifecycle(createStateStore(file));
    const persisted = createStateStore(file).read();
    assert.equal(persisted.browserSmokePassed, true);
    assert.equal(restarted.isSmokePassed(persisted, "2.1.11"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy persisted smoke without a lifecycle marker is invalidated on startup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-smoke-legacy-"));
  const file = path.join(root, "launcher-state.json");
  try {
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      browserSmokePassed: true,
      browserSmokeVersion: "2.1.11",
    }));
    const store = createStateStore(file);
    const lifecycle = createBrowserSmokeLifecycle(store);
    const migrated = createStateStore(file).read();
    assert.equal(migrated.browserSmokePassed, false);
    assert.equal(migrated.browserSmokeVersion, null);
    assert.equal(typeof migrated.browserSmokeLifecycleId, "string");
    assert.equal(lifecycle.isSmokePassed(migrated, "2.1.11"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
