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
let insertSessionStmt = null;
let selectSessionsStmt = null;
let updateSessionTitleStmt = null;
let deleteSessionStmt = null;
let deleteSessionMessagesStmt = null;
let touchSessionStmt = null;

function hasTable(tableName) {
    const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(tableName);
    return Boolean(row);
}

function getTableColumns(tableName) {
    if (!hasTable(tableName)) {
        return [];
    }

    return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function ensureSessionColumns() {
    const columns = getTableColumns("sessions");
    const hasUpdatedAt = columns.some((column) => column.name === "updated_at");

    if (!hasUpdatedAt) {
        db.prepare("ALTER TABLE sessions ADD COLUMN updated_at DATETIME").run();
    }

    db.prepare(
        "UPDATE sessions SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)"
    ).run();
}

function ensureMessageColumns() {
    const columns = getTableColumns("messages");
    const hasSessionId = columns.some((column) => column.name === "session_id");

    if (hasSessionId) {
        return;
    }

    const defaultSession = db
        .prepare("SELECT id FROM sessions ORDER BY id ASC LIMIT 1")
        .get();

    let fallbackSessionId = defaultSession?.id;
    if (!fallbackSessionId) {
        const insertResult = db
            .prepare("INSERT INTO sessions (title, updated_at) VALUES (?, CURRENT_TIMESTAMP)")
            .run("历史会话");
        fallbackSessionId = Number(insertResult.lastInsertRowid);
    }

    db.prepare("ALTER TABLE messages ADD COLUMN session_id INTEGER").run();
    db.prepare("UPDATE messages SET session_id = ? WHERE session_id IS NULL").run(fallbackSessionId);
}

export function initDB() {
    db.prepare(
        `
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    ensureSessionColumns();

    db.prepare(
        `
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `
    ).run();

    ensureMessageColumns();

    db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`
    ).run();

    if (!insertMessageStmt) {
        insertMessageStmt = db.prepare(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"
        );
    }

    if (!touchSessionStmt) {
        touchSessionStmt = db.prepare(
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
    }

    if (!selectHistoryStmt) {
        selectHistoryStmt = db.prepare(
            "SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
        );
    }

    if (!insertSessionStmt) {
        insertSessionStmt = db.prepare(
            "INSERT INTO sessions (title) VALUES (?)"
        );
    }

    if (!selectSessionsStmt) {
        selectSessionsStmt = db.prepare(
            "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC, id DESC"
        );
    }

    if (!updateSessionTitleStmt) {
        updateSessionTitleStmt = db.prepare(
            "UPDATE sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
    }

    if (!deleteSessionMessagesStmt) {
        deleteSessionMessagesStmt = db.prepare(
            "DELETE FROM messages WHERE session_id = ?"
        );
    }

    if (!deleteSessionStmt) {
        deleteSessionStmt = db.prepare(
            "DELETE FROM sessions WHERE id = ?"
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

export function createSession(title) {
    if (!insertSessionStmt) {
        initDB();
    }

    const safeTitle = String(title || "新对话").trim() || "新对话";
    const result = insertSessionStmt.run(safeTitle);
    return Number(result.lastInsertRowid);
}

export function getSessions() {
    if (!selectSessionsStmt) {
        initDB();
    }

    return selectSessionsStmt.all();
}

export function saveMessage(session_id, role, content) {
    if (!insertMessageStmt) {
        initDB();
    }

    const result = insertMessageStmt.run(session_id, role, content);
    touchSessionStmt.run(session_id);
    return result;
}

export function renameSession(session_id, title) {
    if (!updateSessionTitleStmt) {
        initDB();
    }

    const safeTitle = String(title || "").trim();
    if (!safeTitle) {
        return { changes: 0 };
    }

    return updateSessionTitleStmt.run(safeTitle, session_id);
}

export function removeSession(session_id) {
    if (!deleteSessionStmt || !deleteSessionMessagesStmt) {
        initDB();
    }

    const tx = db.transaction((id) => {
        deleteSessionMessagesStmt.run(id);
        return deleteSessionStmt.run(id);
    });

    return tx(session_id);
}

export function getHistoryMessages(session_id, limit = 20) {
    if (!selectHistoryStmt) {
        initDB();
    }

    const rows = selectHistoryStmt.all(session_id, limit);
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
