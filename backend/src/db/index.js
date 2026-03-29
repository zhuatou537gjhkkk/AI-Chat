import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, "../../agent_data.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

let insertMessageStmt = null;
let selectHistoryStmt = null;

export function initDB() {
    db.prepare(
        `
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    if (!insertMessageStmt) {
        insertMessageStmt = db.prepare(
            "INSERT INTO messages (role, content) VALUES (?, ?)"
        );
    }

    if (!selectHistoryStmt) {
        selectHistoryStmt = db.prepare(
            "SELECT id, role, content, created_at FROM messages ORDER BY id DESC LIMIT ?"
        );
    }
}

export function saveMessage(role, content) {
    if (!insertMessageStmt) {
        initDB();
    }

    return insertMessageStmt.run(role, content);
}

export function getHistoryMessages(limit = 20) {
    if (!selectHistoryStmt) {
        initDB();
    }

    const rows = selectHistoryStmt.all(limit);
    return rows.reverse();
}

export default db;
