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
            return this.memtable.get(key);
        }

        // Then check SSTables
        return this.getFromSSTables(key);
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

        fs.appendFileSync(
            WAL_FILE,
            JSON.stringify(operation) + "\n"
        );
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

        let content = "";

        for (const [key, value] of entries) {
            content += `${key}\t${value}\n`;
        }

        fs.writeFileSync(filename, content);

        console.log(
            `Memtable flushed → ${filename}`
        );

        // Clear memory
        this.memtable.clear();

        // In a real database we'd also
        // rotate/truncate the WAL here.

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
            .filter(file => file.endsWith(".data"))
            .sort();

        // Nothing to compact
        if (files.length <= 1) {
            return;
        }

        console.log(
            `Compacting ${files.length} SSTables...`
        );

        /*
         * Map stores the latest value.
         *
         * We process SSTables from oldest → newest.
         * Therefore newer values overwrite older ones.
         */
        const merged = new Map();

        for (const file of files) {
            const filepath = `${SSTABLE_DIR}/${file}`;

            const content = fs.readFileSync(
                filepath,
                "utf8"
            );

            const lines = content
                .split("\n")
                .filter(Boolean);

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
        const entries = [...merged.entries()].sort(
            (a, b) => a[0].localeCompare(b[0])
        );

        let content = "";

        for (const [key, value] of entries) {
            content += `${key}\t${value}\n`;
        }

        const compactedFile =
            `${SSTABLE_DIR}/sstable-${Date.now()}-compacted.data`;

        fs.writeFileSync(
            compactedFile,
            content
        );

        // Delete old SSTables
        for (const file of files) {
            fs.unlinkSync(
                `${SSTABLE_DIR}/${file}`
            );
        }

        console.log(
            `Compaction complete → ${compactedFile}`
        );
    }

    // -------------------------
    // Read from SSTables
    // -------------------------

    getFromSSTables(key) {

        const files = fs
            .readdirSync(SSTABLE_DIR)
            .filter(file => file.endsWith(".data"))
            .sort()
            .reverse();

        for (const file of files) {

            const content = fs.readFileSync(
                `${SSTABLE_DIR}/${file}`,
                "utf8"
            );

            const lines = content
                .split("\n")
                .filter(Boolean);

            for (const line of lines) {

                const [storedKey, value] =
                    line.split("\t");

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

        const content =
            fs.readFileSync(WAL_FILE, "utf8");

        const lines = content
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