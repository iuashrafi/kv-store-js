const fs = require("fs");

const WAL_FILE = "./store.log";

class KVStore {
    constructor() {
        this.store = new Map();

        // When the server starts, reconstruct memory from the WAL.
        this.recover();
    }

    // -------------------------
    // SET
    // -------------------------
    set(key, value) {
        // 1. Write to WAL first
        this.appendToWAL({
            operation: "SET",
            key,
            value
        });

        // 2. Then update memory
        this.store.set(key, value);
    }

    // -------------------------
    // GET
    // -------------------------
    get(key) {
        return this.store.get(key);
    }

    // -------------------------
    // DELETE
    // -------------------------
    delete(key) {
        // Write deletion to WAL first
        this.appendToWAL({
            operation: "DELETE",
            key
        });

        // Then delete from memory
        this.store.delete(key);
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
    // RECOVERY
    // -------------------------
    recover() {
        if (!fs.existsSync(WAL_FILE)) {
            return;
        }

        const file = fs.readFileSync(WAL_FILE, "utf8");

        const lines = file
            .split("\n")
            .filter(line => line.trim() !== "");

        for (const line of lines) {
            const operation = JSON.parse(line);

            if (operation.operation === "SET") {
                this.store.set(
                    operation.key,
                    operation.value
                );
            }

            if (operation.operation === "DELETE") {
                this.store.delete(operation.key);
            }
        }
    }
}


// ----------------------------------
// Let's use our KV store
// ----------------------------------

const db = new KVStore();

db.set("name", "Imtiaz");
db.set("age", "26");
db.set("city", "Kolkata");

console.log(db.get("name"));
// Imtiaz

console.log(db.get("age"));
// 26

db.delete("city");

console.log(db.get("city"));
// undefined