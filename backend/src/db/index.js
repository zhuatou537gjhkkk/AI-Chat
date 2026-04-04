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
let selectMessageStatsStmt = null;

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

    if (!selectMessageStatsStmt) {
        selectMessageStatsStmt = db.prepare(
            `
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_count,
                SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant_count
            FROM messages
            `
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

export function getMessageStats() {
    if (!selectMessageStatsStmt) {
        initDB();
    }

    const row = selectMessageStatsStmt.get();
    return {
        total: row?.total ?? 0,
        user_count: row?.user_count ?? 0,
        assistant_count: row?.assistant_count ?? 0,
        at: new Date().toISOString()
    };
}

export default db;
