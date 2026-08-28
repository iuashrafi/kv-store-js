**Phase A4 — Compaction**

Before adding anything fancy like leveled compaction, let's implement the **simplest possible compaction** on top of the code we already have.

### What we're adding

Currently:

```text
WAL
 ↓
Memtable
 ↓ (when full)
SSTable 1
SSTable 2
SSTable 3
...
```

We'll add:

```text
SSTable 1 ─┐
SSTable 2 ─┼──→ COMPACTION ──→ SSTable 4
SSTable 3 ─┘
```

The compaction will:

1. Read all SSTables.
2. Merge their entries.
3. Keep the **latest value** for each key.
4. Remove deleted keys.
5. Write one new SSTable.
6. Delete the old SSTables.

---

## Updated code

For now, let's keep the implementation deliberately simple:

```javascript
const fs = require("fs");

const WAL_FILE = "./store.log";
const SSTABLE_DIR = "./sstables";

const MAX_MEMTABLE_SIZE = 3;

class KVStore {
  constructor() {
    this.memtable = new Map();

    if (!fs.existsSync(SSTABLE_DIR)) {
      fs.mkdirSync(SSTABLE_DIR);
    }

    this.recover();
  }

  // -------------------------
  // SET
  // -------------------------

  set(key, value) {
    this.appendToWAL({
      operation: "SET",
      key,
      value,
    });

    this.memtable.set(key, value);

    if (this.memtable.size >= MAX_MEMTABLE_SIZE) {
      this.flushMemtable();
    }
  }

  // -------------------------
  // GET
  // -------------------------

  get(key) {
    // Check newest data first
    if (this.memtable.has(key)) {
      const value = this.memtable.get(key);

      return value === null ? undefined : value;
    }

    // Then SSTables
    return this.getFromSSTables(key);
  }

  // -------------------------
  // DELETE
  // -------------------------

  delete(key) {
    this.appendToWAL({
      operation: "DELETE",
      key,
    });

    // null represents a tombstone
    this.memtable.set(key, null);

    if (this.memtable.size >= MAX_MEMTABLE_SIZE) {
      this.flushMemtable();
    }
  }

  // -------------------------
  // WAL
  // -------------------------

  appendToWAL(operation) {
    fs.appendFileSync(WAL_FILE, JSON.stringify(operation) + "\n");
  }

  // -------------------------
  // Flush Memtable → SSTable
  // -------------------------

  flushMemtable() {
    const entries = [...this.memtable.entries()];

    // SSTables are sorted by key
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    const filename = `${SSTABLE_DIR}/sstable-${Date.now()}.data`;

    let content = "";

    for (const [key, value] of entries) {
      content += `${key}\t${value}\n`;
    }

    fs.writeFileSync(filename, content);

    console.log(`Memtable flushed → ${filename}`);

    this.memtable.clear();

    // After creating enough SSTables,
    // compact them.
    this.compact();
  }

  // -------------------------
  // COMPACTION
  // -------------------------

  compact() {
    const files = fs
      .readdirSync(SSTABLE_DIR)
      .filter((file) => file.endsWith(".data"))
      .sort();

    // Nothing to compact
    if (files.length <= 1) {
      return;
    }

    console.log(`Compacting ${files.length} SSTables...`);

    /*
     * Map stores the latest value.
     *
     * We process SSTables from oldest → newest.
     * Therefore newer values overwrite older ones.
     */
    const merged = new Map();

    for (const file of files) {
      const filepath = `${SSTABLE_DIR}/${file}`;

      const content = fs.readFileSync(filepath, "utf8");

      const lines = content.split("\n").filter(Boolean);

      for (const line of lines) {
        const [key, value] = line.split("\t");

        merged.set(key, value);
      }
    }

    // Remove tombstones
    for (const [key, value] of merged) {
      if (value === "null") {
        merged.delete(key);
      }
    }

    // Sort final data
    const entries = [...merged.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    let content = "";

    for (const [key, value] of entries) {
      content += `${key}\t${value}\n`;
    }

    const compactedFile = `${SSTABLE_DIR}/sstable-${Date.now()}-compacted.data`;

    fs.writeFileSync(compactedFile, content);

    // Delete old SSTables
    for (const file of files) {
      fs.unlinkSync(`${SSTABLE_DIR}/${file}`);
    }

    console.log(`Compaction complete → ${compactedFile}`);
  }

  // -------------------------
  // Read from SSTables
  // -------------------------

  getFromSSTables(key) {
    const files = fs
      .readdirSync(SSTABLE_DIR)
      .filter((file) => file.endsWith(".data"))
      .sort()
      .reverse();

    for (const file of files) {
      const content = fs.readFileSync(`${SSTABLE_DIR}/${file}`, "utf8");

      const lines = content.split("\n").filter(Boolean);

      for (const line of lines) {
        const [storedKey, value] = line.split("\t");

        if (storedKey === key) {
          if (value === "null") {
            return undefined;
          }

          return value;
        }
      }
    }

    return undefined;
  }

  // -------------------------
  // Recovery
  // -------------------------

  recover() {
    if (!fs.existsSync(WAL_FILE)) {
      return;
    }

    const content = fs.readFileSync(WAL_FILE, "utf8");

    const lines = content.split("\n").filter(Boolean);

    for (const line of lines) {
      const operation = JSON.parse(line);

      if (operation.operation === "SET") {
        this.memtable.set(operation.key, operation.value);
      }

      if (operation.operation === "DELETE") {
        this.memtable.set(operation.key, null);
      }
    }
  }
}
```

---

# Let's actually understand what the compaction code does

Suppose we have:

### SSTable 1

```text
age     25
name    Imtiaz
```

Then we update:

```javascript
db.set("age", "26");
```

Eventually we get:

### SSTable 2

```text
age     26
```

Now:

```text
SSTable 1          SSTable 2
---------          ---------
age → 25           age → 26
name → Imtiaz
```

Compaction processes:

```text
SSTable 1
    ↓
age → 25

SSTable 2
    ↓
age → 26
```

Our:

```javascript
const merged = new Map();
```

first gets:

```text
age → 25
```

Then SSTable 2 overwrites it:

```text
age → 26
```

Final result:

```text
SSTable 3

age     26
name    Imtiaz
```

So:

```text
25 ❌
26 ✅
```

---

# What about DELETE?

Suppose:

```text
SSTable 1

name → Imtiaz
```

Then:

```javascript
db.delete("name");
```

The new SSTable contains:

```text
name → null
```

We treat `null` as our **tombstone**.

During compaction:

```text
SSTable 1          SSTable 2
---------          ---------
name → Imtiaz      name → null
```

The newer value wins:

```text
name → null
```

Then:

```javascript
if (value === "null") {
  merged.delete(key);
}
```

So the final SSTable contains:

```text
(empty)
```

The key is completely removed.

---

# One important issue with our current code

There's a subtle problem:

```javascript
this.compact();
```

runs **every time a Memtable is flushed**.

So if we have:

```text
SSTable 1
SSTable 2
```

we compact.

Then:

```text
SSTable 3
```

gets created.

Then:

```text
SSTable 3 + previous compacted SSTable
```

may get compacted again.

That's okay for learning, but **not how a production LSM engine should work**.

Later we'll learn:

```text
Level 0
   ↓
Level 1
   ↓
Level 2
```

and different compaction strategies.

But **don't implement that yet**.

---

# One more important problem

Our WAL currently keeps everything:

```text
store.log

SET age 25
SET name Imtiaz
SET age 26
DELETE name
SET city Delhi
...
```

Even after we've compacted the SSTables, the WAL still contains the entire history.

So our next storage-engine problem is:

> **How do we safely rotate/truncate the WAL after data has been flushed to SSTables?**

That's actually an important durability concept, because we **cannot simply delete the WAL whenever we feel like it**.

So I'd suggest our next phase be:

### **Phase A5 — WAL lifecycle + crash recovery**

We'll understand:

- When is it safe to delete WAL entries?
- What happens if we crash during Memtable → SSTable flush?
- Why `fsync` matters
- WAL rotation
- Recovery from WAL + SSTables
- Avoiding data loss during crashes

**After that**, we'll move to the read-performance side: **SSTable indexes + Bloom filters**.
