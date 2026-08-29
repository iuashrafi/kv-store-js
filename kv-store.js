const fs = require("fs");

const WAL_FILE = "./store.log";
const SSTABLE_DIR = "./sstables";

const MAX_MEMTABLE_SIZE = 3;

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

    let data = "";
    const index = [];

    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];

      // Add sparse index entry
      if (i % INDEX_INTERVAL === 0) {
        index.push({
          key,
          position: i,
        });
      }

      data += `${key}\t${value}\n`;
    }

    fs.writeFileSync(dataFile, data);

    fs.writeFileSync(indexFile, JSON.stringify(index));

    this.memtable.clear();

    this.rotateWAL();
  }

  getFromSSTable(key, dataFile, indexFile) {
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));

    let startPosition = 0;

    // Find closest index entry
    for (const entry of index) {
      if (entry.key <= key) {
        startPosition = entry.position;
      } else {
        break;
      }
    }

    const lines = fs.readFileSync(dataFile, "utf8").split("\n").filter(Boolean);

    // Only search from the indexed position
    for (let i = startPosition; i < lines.length; i++) {
      const [storedKey, value] = lines[i].split("\t");

      if (storedKey === key) {
        return value === "null" ? undefined : value;
      }

      // We've passed the key
      if (storedKey > key) {
        break;
      }
    }

    return undefined;
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
