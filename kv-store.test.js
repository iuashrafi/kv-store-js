const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const KVStore = require("./kv-store.js");

// KVStore hardcodes relative paths ("./store.log", "./sstables"), so each
// test runs inside its own temp directory to stay isolated from the others
// and from the real project directory.
function withTempCwd(fn) {
  return async () => {
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kv-store-test-"));

    process.chdir(tempDir);

    try {
      await fn();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function sstableDataFiles() {
  return fs.readdirSync("./sstables").filter((f) => f.endsWith(".data"));
}

test(
  "set/get returns the value written",
  withTempCwd(() => {
    const store = new KVStore();

    store.set("key1", "value1");

    assert.equal(store.get("key1"), "value1");
  }),
);

test(
  "get returns undefined for a key that was never set",
  withTempCwd(() => {
    const store = new KVStore();

    assert.equal(store.get("does-not-exist"), undefined);
  }),
);

test(
  "overwriting a key returns the latest value",
  withTempCwd(() => {
    const store = new KVStore();

    store.set("key1", "value1");
    store.set("key1", "value1-updated");

    assert.equal(store.get("key1"), "value1-updated");
  }),
);

test(
  "delete makes a key unreadable via the memtable tombstone",
  withTempCwd(() => {
    const store = new KVStore();

    store.set("key1", "value1");
    store.delete("key1");

    assert.equal(store.get("key1"), undefined);
  }),
);

test(
  "flushing the memtable writes a data/index/bloom SSTable triple, and get still resolves the value",
  withTempCwd(() => {
    const store = new KVStore();

    // MAX_MEMTABLE_SIZE is 3 — the third set() triggers a flush.
    store.set("key1", "value1");
    store.set("key2", "value2");
    store.set("key3", "value3");

    assert.equal(
      store.memtable.size,
      0,
      "memtable should be cleared after flush",
    );

    const files = fs.readdirSync("./sstables");

    assert.equal(files.filter((f) => f.endsWith(".data")).length, 1);
    assert.equal(files.filter((f) => f.endsWith(".index")).length, 1);
    assert.equal(files.filter((f) => f.endsWith(".bloom")).length, 1);

    assert.equal(store.get("key1"), "value1");
    assert.equal(store.get("key2"), "value2");
    assert.equal(store.get("key3"), "value3");
  }),
);

test(
  "get on a flushed SSTable returns undefined for an absent key",
  withTempCwd(() => {
    const store = new KVStore();

    store.set("a", "1");
    store.set("b", "2");
    store.set("c", "3");

    assert.equal(store.get("zzz-not-present"), undefined);
  }),
);

test(
  "a newer SSTable's value wins over an older SSTable's value for the same key",
  withTempCwd(() => {
    const store = new KVStore();

    // First SSTable: key "a" = "old"
    store.set("a", "old");
    store.set("b", "1");
    store.set("c", "1");

    // Second SSTable: key "a" = "new"
    store.set("a", "new");
    store.set("d", "1");
    store.set("e", "1");

    assert.equal(sstableDataFiles().length, 2);
    assert.equal(store.get("a"), "new");
  }),
);

test(
  "a tombstone in a newer SSTable hides the value in an older SSTable",
  withTempCwd(() => {
    const store = new KVStore();

    // First SSTable: key "a" = "value"
    store.set("a", "value");
    store.set("b", "1");
    store.set("c", "1");

    // Second SSTable: "a" deleted
    store.delete("a");
    store.set("d", "1");
    store.set("e", "1");

    assert.equal(sstableDataFiles().length, 2);
    assert.equal(store.get("a"), undefined);
  }),
);

test(
  "the sparse index correctly locates keys spread across a larger SSTable",
  withTempCwd(() => {
    const store = new KVStore();

    const keys = Array.from(
      { length: 9 },
      (_, i) => `key${String(i).padStart(2, "0")}`,
    );

    for (const key of keys) {
      store.set(key, `${key}-value`);
    }

    for (const key of keys) {
      assert.equal(store.get(key), `${key}-value`);
    }
  }),
);

test(
  "compaction merges SSTables past the threshold into a single file and preserves latest values",
  withTempCwd(() => {
    const store = new KVStore();

    // MAX_MEMTABLE_SIZE=3 and COMPACTION_THRESHOLD=3: the 4th flush pushes
    // the SSTable count to 4, which triggers compaction down to 1 file.
    for (let i = 1; i <= 12; i++) {
      store.set(`key${i}`, `value${i}`);
    }

    const dataFiles = sstableDataFiles();

    assert.equal(dataFiles.length, 1);
    assert.match(dataFiles[0], /-compacted\.data$/);

    for (let i = 1; i <= 12; i++) {
      assert.equal(store.get(`key${i}`), `value${i}`);
    }
  }),
);

test(
  "compaction drops tombstoned keys instead of carrying them forward",
  withTempCwd(() => {
    const store = new KVStore();

    for (let i = 1; i <= 9; i++) {
      store.set(`key${i}`, `value${i}`);
    }

    store.delete("key1");
    store.set("key10", "value10");
    store.set("key11", "value11"); // 4th flush -> triggers compaction

    assert.equal(sstableDataFiles().length, 1);
    assert.equal(store.get("key1"), undefined);
    assert.equal(store.get("key10"), "value10");
  }),
);

test(
  "WAL replay recovers memtable state after a restart (crash recovery)",
  withTempCwd(() => {
    const store = new KVStore();

    store.set("key1", "value1");
    store.set("key2", "value2");
    // Memtable size is 2, below MAX_MEMTABLE_SIZE — nothing flushed yet,
    // so this state only survives via the WAL.

    const restarted = new KVStore();

    assert.equal(restarted.get("key1"), "value1");
    assert.equal(restarted.get("key2"), "value2");
  }),
);

test(
  "WAL replay also recovers deletes recorded before a restart",
  withTempCwd(() => {
    const store = new KVStore();

    store.set("key1", "value1");
    store.delete("key1");

    const restarted = new KVStore();

    assert.equal(restarted.get("key1"), undefined);
  }),
);

test(
  "data flushed to an SSTable is still readable after a restart",
  withTempCwd(() => {
    const store = new KVStore();

    store.set("key1", "value1");
    store.set("key2", "value2");
    store.set("key3", "value3"); // triggers flush

    const restarted = new KVStore();

    assert.equal(restarted.get("key1"), "value1");
    assert.equal(restarted.get("key3"), "value3");
  }),
);
