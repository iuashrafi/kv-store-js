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
            value
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

            return value === null
                ? undefined
                : value;
        }

        return undefined;
    }

    // -------------------------
    // DELETE
    // -------------------------

    delete(key) {

        this.appendToWAL({
            operation: "DELETE",
            key
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

        const fd = fs.openSync(
            WAL_FILE,
            "a"
        );

        try {

            const data =
                JSON.stringify(operation) + "\n";

            fs.writeSync(
                fd,
                data
            );

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

        const entries = [...this.memtable.entries()];

        // SSTables are sorted by key
        entries.sort((a, b) =>
            a[0].localeCompare(b[0])
        );

        const filename =
            `${SSTABLE_DIR}/sstable-${Date.now()}.data`;

        const fd = fs.openSync(
            filename,
            "w"
        );

        try {

            for (const [key, value] of entries) {

                const line =
                    `${key}\t${value}\n`;

                fs.writeSync(
                    fd,
                    line
                );
            }

            // IMPORTANT:
            // Make SSTable durable
            fs.fsyncSync(fd);

        } finally {

            fs.closeSync(fd);
        }

        console.log(
            `SSTable safely written → ${filename}`
        );

        // Only after SSTable is durable
        // do we clear the Memtable.
        this.memtable.clear();

        // Now WAL entries represented by
        // this SSTable are no longer required.
        this.rotateWAL();
    }

    // -------------------------
    // WAL Rotation
    // -------------------------

    rotateWAL() {

        if (!fs.existsSync(WAL_FILE)) {
            return;
        }

        const oldWAL =
            `${WAL_FILE}.old`;

        // Remove previous backup
        if (fs.existsSync(oldWAL)) {
            fs.unlinkSync(oldWAL);
        }

        // Rename current WAL
        fs.renameSync(
            WAL_FILE,
            oldWAL
        );

        console.log(
            "WAL rotated"
        );
    }

    // -------------------------
    // Recovery
    // -------------------------

    recover() {

        if (!fs.existsSync(WAL_FILE)) {
            return;
        }

        const content =
            fs.readFileSync(
                WAL_FILE,
                "utf8"
            );

        const lines =
            content
                .split("\n")
                .filter(Boolean);

        for (const line of lines) {

            const operation =
                JSON.parse(line);

            if (operation.operation === "SET") {

                this.memtable.set(
                    operation.key,
                    operation.value
                );
            }

            if (operation.operation === "DELETE") {

                this.memtable.set(
                    operation.key,
                    null
                );
            }
        }
    }
}