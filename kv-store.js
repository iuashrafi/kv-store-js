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

        this.sstableCount = 0;

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
    // Flush Memtable
    // -------------------------

    flushMemtable() {

        const entries = [...this.memtable.entries()];

        // Sort by key
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
    }

    // -------------------------
    // Read SSTables
    // -------------------------

    getFromSSTables(key) {

        const files = fs
            .readdirSync(SSTABLE_DIR)
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

        const file =
            fs.readFileSync(WAL_FILE, "utf8");

        const lines = file
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