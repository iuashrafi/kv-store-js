const fs = require("fs");
const BloomFilter = require("./BloomFilter");
const WAL_FILE = "./store.log";
const SSTABLE_DIR = "./sstables";

const MAX_MEMTABLE_SIZE = 3;
const INDEX_INTERVAL = 2;
const COMPACTION_THRESHOLD = 3;

const NOT_FOUND = Symbol("not_found");
const TOMBSTONE = Symbol("tombstone");

class KVStore {
  constructor() {
    this.memtable = new Map();

    // Create SSTable directory
    if (!fs.existsSync(SSTABLE_DIR)) {
      fs.mkdirSync(SSTABLE_DIR);
    }

    this.recover();
  }

  // -------------------------
  // SET
  // -------------------------

  set(key, value) {
    // 1. Write to WAL
    this.appendToWAL({
      operation: "SET",
      key,
      value,
    });

    // 2. Write to Memtable
    this.memtable.set(key, value);

    // 3. Flush if Memtable is full
    if (this.memtable.size >= MAX_MEMTABLE_SIZE) {
      this.flushMemtable();
    }
  }

  // -------------------------
  // GET
  // -------------------------

  get(key) {
    // First check latest data
    if (this.memtable.has(key)) {
      const value = this.memtable.get(key);

      return value === null ? undefined : value;
    }

    // Fall back to SSTables, newest first
    const files = fs
      .readdirSync(SSTABLE_DIR)
      .filter((file) => file.endsWith(".data"))
      .sort()
      .reverse();

    for (const file of files) {
      const base = file.slice(0, -".data".length);

      const dataFile = `${SSTABLE_DIR}/${base}.data`;
      const indexFile = `${SSTABLE_DIR}/${base}.index`;
      const bloomFile = `${SSTABLE_DIR}/${base}.bloom`;

      const result = this.getFromSSTable(key, dataFile, indexFile, bloomFile);

      if (result === NOT_FOUND) {
        continue;
      }

      return result === TOMBSTONE ? undefined : result;
    }

    return undefined;
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
    const fd = fs.openSync(WAL_FILE, "a");

    try {
      const data = JSON.stringify(operation) + "\n";

      fs.writeSync(fd, data);

      // Make sure WAL reaches disk
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  // -------------------------
  // Flush Memtable → SSTable
  // -------------------------

  flushMemtable() {
    const entries = [...this.memtable.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const timestamp = Date.now();

    const dataFile = `${SSTABLE_DIR}/sstable-${timestamp}.data`;

    const indexFile = `${SSTABLE_DIR}/sstable-${timestamp}.index`;

    const bloomFile = `${SSTABLE_DIR}/sstable-${timestamp}.bloom`;

    const bloomFilter = new BloomFilter(Math.max(1000, entries.length * 10), 3);

    const index = [];

    let offset = 0;

    const fd = fs.openSync(dataFile, "w");

    try {
      for (let i = 0; i < entries.length; i++) {
        const [key, value] = entries[i];

        bloomFilter.add(key);

        // Add every 2nd key to sparse index
        if (i % INDEX_INTERVAL === 0) {
          index.push({
            key,
            offset,
          });
        }

        const line = `${key}\t${value}\n`;

        const buffer = Buffer.from(line);

        fs.writeSync(fd, buffer);

        // Move offset forward
        offset += buffer.length;
      }

      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    fs.writeFileSync(indexFile, JSON.stringify(index));

    fs.writeFileSync(
      bloomFile,
      JSON.stringify({
        size: bloomFilter.size,
        hashCount: bloomFilter.hashCount,
        bits: bloomFilter.bits,
      }),
    );

    this.memtable.clear();

    this.rotateWAL();

    const sstableCount = fs
      .readdirSync(SSTABLE_DIR)
      .filter((file) => file.endsWith(".data")).length;

    if (sstableCount > COMPACTION_THRESHOLD) {
      this.compact();
    }
  }

  // -------------------------
  // Compaction
  // -------------------------

  compact() {
    const files = fs
      .readdirSync(SSTABLE_DIR)
      .filter((file) => file.endsWith(".data"))
      .sort();

    if (files.length <= 1) {
      return;
    }

    console.log(`Compacting ${files.length} SSTables...`);

    // Oldest → newest, so newer values overwrite older ones
    const merged = new Map();

    for (const file of files) {
      const content = fs.readFileSync(`${SSTABLE_DIR}/${file}`, "utf8");

      const lines = content.split("\n").filter(Boolean);

      for (const line of lines) {
        const [key, value] = line.split("\t");

        merged.set(key, value);
      }
    }

    // Drop tombstones — no later SSTable can resurrect them
    for (const [key, value] of merged) {
      if (value === "null") {
        merged.delete(key);
      }
    }

    const entries = [...merged.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const timestamp = Date.now();

    const dataFile = `${SSTABLE_DIR}/sstable-${timestamp}-compacted.data`;
    const indexFile = `${SSTABLE_DIR}/sstable-${timestamp}-compacted.index`;
    const bloomFile = `${SSTABLE_DIR}/sstable-${timestamp}-compacted.bloom`;

    const bloomFilter = new BloomFilter(Math.max(1000, entries.length * 10), 3);

    const index = [];

    let offset = 0;

    const fd = fs.openSync(dataFile, "w");

    try {
      for (let i = 0; i < entries.length; i++) {
        const [key, value] = entries[i];

        bloomFilter.add(key);

        if (i % INDEX_INTERVAL === 0) {
          index.push({ key, offset });
        }

        const buffer = Buffer.from(`${key}\t${value}\n`);

        fs.writeSync(fd, buffer);

        offset += buffer.length;
      }

      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    fs.writeFileSync(indexFile, JSON.stringify(index));

    fs.writeFileSync(
      bloomFile,
      JSON.stringify({
        size: bloomFilter.size,
        hashCount: bloomFilter.hashCount,
        bits: bloomFilter.bits,
      }),
    );

    // Remove the superseded SSTables (data + index + bloom)
    for (const file of files) {
      const base = file.slice(0, -".data".length);

      for (const ext of [".data", ".index", ".bloom"]) {
        const filepath = `${SSTABLE_DIR}/${base}${ext}`;

        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      }
    }

    console.log(`Compaction complete → ${dataFile}`);
  }

  getFromSSTable(key, dataFile, indexFile, bloomFile) {
    // -------------------------
    // Bloom Filter
    // -------------------------

    const bloomData = JSON.parse(fs.readFileSync(bloomFile, "utf8"));

    const bloomFilter = new BloomFilter(bloomData.size, bloomData.hashCount);

    bloomFilter.bits = bloomData.bits;

    if (!bloomFilter.mightContain(key)) {
      return NOT_FOUND;
    }

    // -------------------------
    // Index
    // -------------------------

    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));

    let offset = 0;

    for (const entry of index) {
      if (entry.key <= key) {
        offset = entry.offset;
      } else {
        break;
      }
    }

    // -------------------------
    // Read SSTable
    // -------------------------

    const fd = fs.openSync(dataFile, "r");

    try {
      const stats = fs.fstatSync(fd);

      const fileSize = stats.size;

      // Read from our indexed position
      const bytesToRead = fileSize - offset;

      const buffer = Buffer.alloc(bytesToRead);

      fs.readSync(fd, buffer, 0, bytesToRead, offset);

      const data = buffer.toString("utf8");

      const lines = data.split("\n").filter(Boolean);

      for (const line of lines) {
        const [storedKey, value] = line.split("\t");

        if (storedKey === key) {
          return value === "null" ? TOMBSTONE : value;
        }

        // Since SSTable is sorted,
        // we can stop once we've passed key.
        if (storedKey > key) {
          return NOT_FOUND;
        }
      }

      return NOT_FOUND;
    } finally {
      fs.closeSync(fd);
    }
  }
  // -------------------------
  // WAL Rotation
  // -------------------------

  rotateWAL() {
    if (!fs.existsSync(WAL_FILE)) {
      return;
    }

    const oldWAL = `${WAL_FILE}.old`;

    // Remove previous backup
    if (fs.existsSync(oldWAL)) {
      fs.unlinkSync(oldWAL);
    }

    // Rename current WAL
    fs.renameSync(WAL_FILE, oldWAL);

    console.log("WAL rotated");
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

module.exports = KVStore;
