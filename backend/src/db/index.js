import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, "../../agent_data.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

let insertUserStmt = null;
let selectUserByUsernameStmt = null;
let selectUserByIdStmt = null;
let insertMessageStmt = null;
let selectHistoryStmt = null;
let selectMessageStatsStmt = null;
let insertSessionStmt = null;
let selectSessionsStmt = null;
let updateSessionTitleStmt = null;
let updateSessionPinStmt = null;
let deleteSessionStmt = null;
let deleteSessionMessagesStmt = null;
let deleteSessionMetricsStmt = null;
let touchSessionStmt = null;
let selectSessionOwnerStmt = null;
let insertMessageMetricStmt = null;
let selectSessionByIdStmt = null;
let selectMessageInSessionStmt = null;
let insertBranchMessagesStmt = null;
let updateLegacySessionUserStmt = null;
let selectRecentMetricsStmt = null;
let selectMessageByIdStmt = null;
let deleteMessageByIdStmt = null;
let deleteMessageMetricByMessageIdStmt = null;

let defaultUserId = null;

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
    const hasPinned = columns.some((column) => column.name === "pinned");
    const hasPinnedAt = columns.some((column) => column.name === "pinned_at");
    const hasUserId = columns.some((column) => column.name === "user_id");

    if (!hasUpdatedAt) {
        db.prepare("ALTER TABLE sessions ADD COLUMN updated_at DATETIME").run();
    }

    if (!hasPinned) {
        db.prepare("ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0").run();
    }

    if (!hasPinnedAt) {
        db.prepare("ALTER TABLE sessions ADD COLUMN pinned_at DATETIME").run();
    }

    if (!hasUserId) {
        db.prepare("ALTER TABLE sessions ADD COLUMN user_id INTEGER").run();
    }

    db.prepare(
        "UPDATE sessions SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)"
    ).run();

    db.prepare("UPDATE sessions SET pinned = COALESCE(pinned, 0)").run();
}

function ensureMessageColumns(fallbackUserId) {
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

    if (fallbackUserId) {
        db.prepare("UPDATE sessions SET user_id = ? WHERE user_id IS NULL").run(fallbackUserId);
    }
}

function ensureDefaultUser() {
    const defaultUsername = String(process.env.DEMO_USER || "demo").trim() || "demo";
    const defaultPasswordHash = String(process.env.DEMO_PASSWORD_HASH || "demo:change-me");

    const existing = db
        .prepare("SELECT id FROM users WHERE username = ?")
        .get(defaultUsername);

    if (existing?.id) {
        defaultUserId = Number(existing.id);
        return defaultUserId;
    }

    const insertResult = db
        .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
        .run(defaultUsername, defaultPasswordHash);

    defaultUserId = Number(insertResult.lastInsertRowid);
    return defaultUserId;
}

export function initDB() {
    db.prepare(
        `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    db.prepare(
        `
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                pinned INTEGER NOT NULL DEFAULT 0,
                pinned_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `
    ).run();

    ensureSessionColumns();

    const ensuredDefaultUserId = ensureDefaultUser();

    updateLegacySessionUserStmt = db.prepare(
        "UPDATE sessions SET user_id = ? WHERE user_id IS NULL"
    );
    updateLegacySessionUserStmt.run(ensuredDefaultUserId);

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

    ensureMessageColumns(ensuredDefaultUserId);

    db.prepare(
        `
            CREATE TABLE IF NOT EXISTS message_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL UNIQUE,
                latency_ms INTEGER,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                total_tokens INTEGER,
                model TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES messages(id)
            )
        `
    ).run();

    db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`
    ).run();

    if (!insertMessageStmt) {
        insertMessageStmt = db.prepare(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"
        );
    }

    if (!insertUserStmt) {
        insertUserStmt = db.prepare(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)"
        );
    }

    if (!selectUserByUsernameStmt) {
        selectUserByUsernameStmt = db.prepare(
            "SELECT id, username, password_hash, created_at FROM users WHERE username = ?"
        );
    }

    if (!selectUserByIdStmt) {
        selectUserByIdStmt = db.prepare(
            "SELECT id, username, created_at FROM users WHERE id = ?"
        );
    }

    if (!touchSessionStmt) {
        touchSessionStmt = db.prepare(
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
    }

    if (!selectHistoryStmt) {
        selectHistoryStmt = db.prepare(
            `
            SELECT
                m.id,
                m.role,
                m.content,
                m.created_at,
                mm.latency_ms,
                mm.prompt_tokens,
                mm.completion_tokens,
                mm.total_tokens,
                mm.model,
                mm.created_at AS metric_created_at
            FROM messages m
            JOIN sessions s ON s.id = m.session_id
            LEFT JOIN message_metrics mm ON mm.message_id = m.id
            WHERE m.session_id = ? AND s.user_id = ?
            ORDER BY m.id DESC
            LIMIT ?
            `
        );
    }

    if (!insertSessionStmt) {
        insertSessionStmt = db.prepare(
            "INSERT INTO sessions (user_id, title) VALUES (?, ?)"
        );
    }

    if (!selectSessionsStmt) {
        selectSessionsStmt = db.prepare(
            "SELECT id, user_id, title, created_at, updated_at, pinned, pinned_at FROM sessions WHERE user_id = ? ORDER BY pinned DESC, pinned_at DESC, updated_at DESC, id DESC"
        );
    }

    if (!selectSessionByIdStmt) {
        selectSessionByIdStmt = db.prepare(
            "SELECT id, user_id, title, created_at, updated_at, pinned, pinned_at FROM sessions WHERE id = ? AND user_id = ?"
        );
    }

    if (!updateSessionTitleStmt) {
        updateSessionTitleStmt = db.prepare(
            "UPDATE sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
        );
    }

    if (!updateSessionPinStmt) {
        updateSessionPinStmt = db.prepare(
            "UPDATE sessions SET pinned = ?, pinned_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
        );
    }

    if (!deleteSessionMessagesStmt) {
        deleteSessionMessagesStmt = db.prepare(
            "DELETE FROM messages WHERE session_id = ?"
        );
    }

    if (!deleteSessionMetricsStmt) {
        deleteSessionMetricsStmt = db.prepare(
            `
            DELETE FROM message_metrics
            WHERE message_id IN (
                SELECT id FROM messages WHERE session_id = ?
            )
            `
        );
    }

    if (!deleteSessionStmt) {
        deleteSessionStmt = db.prepare(
            "DELETE FROM sessions WHERE id = ? AND user_id = ?"
        );
    }

    if (!selectSessionOwnerStmt) {
        selectSessionOwnerStmt = db.prepare(
            "SELECT id, user_id FROM sessions WHERE id = ?"
        );
    }

    if (!selectMessageInSessionStmt) {
        selectMessageInSessionStmt = db.prepare(
            "SELECT id, session_id, role, content FROM messages WHERE id = ? AND session_id = ?"
        );
    }

    if (!selectMessageByIdStmt) {
        selectMessageByIdStmt = db.prepare(
            "SELECT id, session_id, role, content FROM messages WHERE id = ?"
        );
    }

    if (!deleteMessageByIdStmt) {
        deleteMessageByIdStmt = db.prepare(
            "DELETE FROM messages WHERE id = ?"
        );
    }

    if (!deleteMessageMetricByMessageIdStmt) {
        deleteMessageMetricByMessageIdStmt = db.prepare(
            "DELETE FROM message_metrics WHERE message_id = ?"
        );
    }

    if (!insertBranchMessagesStmt) {
        insertBranchMessagesStmt = db.prepare(
            `
            INSERT INTO messages (session_id, role, content, created_at)
            SELECT
                ?,
                role,
                CASE
                    WHEN id = ? AND role = 'user' AND ? IS NOT NULL AND TRIM(?) <> '' THEN ?
                    ELSE content
                END,
                created_at
            FROM messages
            WHERE session_id = ? AND id <= ?
            ORDER BY id ASC
            `
        );
    }

    if (!insertMessageMetricStmt) {
        insertMessageMetricStmt = db.prepare(
            `
            INSERT INTO message_metrics (message_id, latency_ms, prompt_tokens, completion_tokens, total_tokens, model)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(message_id) DO UPDATE SET
                latency_ms = excluded.latency_ms,
                prompt_tokens = excluded.prompt_tokens,
                completion_tokens = excluded.completion_tokens,
                total_tokens = excluded.total_tokens,
                model = excluded.model
            `
        );
    }

    if (!selectMessageStatsStmt) {
        selectMessageStatsStmt = db.prepare(
            `
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_count,
                SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant_count
            FROM messages m
            JOIN sessions s ON s.id = m.session_id
            WHERE s.user_id = ?
            `
        );
    }

    if (!selectRecentMetricsStmt) {
        selectRecentMetricsStmt = db.prepare(
            `
            SELECT
                mm.message_id,
                mm.latency_ms,
                mm.prompt_tokens,
                mm.completion_tokens,
                mm.total_tokens,
                mm.model,
                mm.created_at,
                m.session_id,
                m.content
            FROM message_metrics mm
            JOIN messages m ON m.id = mm.message_id
            JOIN sessions s ON s.id = m.session_id
            WHERE s.user_id = ?
            ORDER BY mm.id DESC
            LIMIT ?
            `
        );
    }
}

function normalizeHistoryRows(rows) {
    return rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
        metrics: row.total_tokens != null
            ? {
                latency_ms: row.latency_ms,
                prompt_tokens: row.prompt_tokens,
                completion_tokens: row.completion_tokens,
                total_tokens: row.total_tokens,
                model: row.model,
                created_at: row.metric_created_at,
            }
            : null,
    }));
}

export function createUser(username, passwordHash) {
    if (!insertUserStmt) {
        initDB();
    }

    const safeUsername = String(username || "").trim();
    const safePasswordHash = String(passwordHash || "").trim();
    if (!safeUsername || !safePasswordHash) {
        throw new Error("username and password hash are required");
    }

    const result = insertUserStmt.run(safeUsername, safePasswordHash);
    return Number(result.lastInsertRowid);
}

export function getUserByUsername(username) {
    if (!selectUserByUsernameStmt) {
        initDB();
    }

    return selectUserByUsernameStmt.get(String(username || "").trim()) || null;
}

export function getUserById(userId) {
    if (!selectUserByIdStmt) {
        initDB();
    }

    return selectUserByIdStmt.get(Number(userId)) || null;
}

export function createSession(userId, title) {
    if (!insertSessionStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    if (!safeUserId) {
        throw new Error("user id is required");
    }

    const safeTitle = String(title || "新对话").trim() || "新对话";
    const result = insertSessionStmt.run(safeUserId, safeTitle);
    return Number(result.lastInsertRowid);
}

export function getSessions(userId) {
    if (!selectSessionsStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    return selectSessionsStmt.all(safeUserId);
}

export function getSessionById(userId, sessionId) {
    if (!selectSessionByIdStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    return selectSessionByIdStmt.get(Number(sessionId), safeUserId) || null;
}

function assertSessionOwnership(userId, sessionId) {
    if (!selectSessionOwnerStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    const row = selectSessionOwnerStmt.get(Number(sessionId));
    if (!row || Number(row.user_id) !== safeUserId) {
        throw new Error("session not found");
    }
}

export function saveMessage(userId, session_id, role, content) {
    if (!insertMessageStmt) {
        initDB();
    }

    assertSessionOwnership(userId, session_id);

    const result = insertMessageStmt.run(session_id, role, content);
    touchSessionStmt.run(session_id);
    return Number(result.lastInsertRowid);
}

export function renameSession(userId, session_id, title) {
    if (!updateSessionTitleStmt) {
        initDB();
    }

    const safeTitle = String(title || "").trim();
    if (!safeTitle) {
        return { changes: 0 };
    }

    const safeUserId = Number(userId) || defaultUserId;
    return updateSessionTitleStmt.run(safeTitle, session_id, safeUserId);
}

export function removeSession(userId, session_id) {
    if (!deleteSessionStmt || !deleteSessionMessagesStmt || !deleteSessionMetricsStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;

    const tx = db.transaction((id, ownerId) => {
        const session = getSessionById(ownerId, id);
        if (!session) {
            return { changes: 0 };
        }

        deleteSessionMetricsStmt.run(id);
        deleteSessionMessagesStmt.run(id);
        return deleteSessionStmt.run(id, ownerId);
    });

    return tx(session_id, safeUserId);
}

export function toggleSessionPin(userId, session_id, pinned) {
    if (!updateSessionPinStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    const pinnedValue = pinned ? 1 : 0;
    return updateSessionPinStmt.run(pinnedValue, pinnedValue, session_id, safeUserId);
}

export function getHistoryMessages(userId, session_id, limit = 20) {
    if (!selectHistoryStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    const rows = selectHistoryStmt.all(session_id, safeUserId, limit);
    return normalizeHistoryRows(rows.reverse());
}

export function saveMessageMetric(messageId, metrics = {}) {
    if (!insertMessageMetricStmt) {
        initDB();
    }

    insertMessageMetricStmt.run(
        Number(messageId),
        Number(metrics.latency_ms) || 0,
        Number(metrics.prompt_tokens) || 0,
        Number(metrics.completion_tokens) || 0,
        Number(metrics.total_tokens) || 0,
        String(metrics.model || "")
    );
}

export function createBranchSession(userId, sourceSessionId, fromMessageId, title, editedContent = "") {
    if (!insertBranchMessagesStmt || !insertSessionStmt || !selectMessageInSessionStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    const safeSourceSessionId = Number(sourceSessionId);
    const safeFromMessageId = Number(fromMessageId);
    const safeTitle = String(title || "新分支").trim() || "新分支";
    const safeEditedContent = String(editedContent || "");

    const tx = db.transaction(() => {
        const sourceSession = getSessionById(safeUserId, safeSourceSessionId);
        if (!sourceSession) {
            throw new Error("source session not found");
        }

        const branchId = createSession(safeUserId, safeTitle);

        if (Number.isInteger(safeFromMessageId) && safeFromMessageId > 0) {
            const targetMessage = selectMessageInSessionStmt.get(safeFromMessageId, safeSourceSessionId);
            if (!targetMessage) {
                throw new Error("message not found in source session");
            }

            insertBranchMessagesStmt.run(
                branchId,
                safeFromMessageId,
                safeEditedContent,
                safeEditedContent,
                safeEditedContent,
                safeSourceSessionId,
                safeFromMessageId
            );
            touchSessionStmt.run(branchId);
        }

        return branchId;
    });

    return tx();
}

export function removeMessagePair(userId, sessionId, userMessageId) {
    if (!selectMessageByIdStmt || !deleteMessageByIdStmt || !deleteMessageMetricByMessageIdStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    const safeSessionId = Number(sessionId);
    const safeUserMessageId = Number(userMessageId);

    const tx = db.transaction(() => {
        const session = getSessionById(safeUserId, safeSessionId);
        if (!session) {
            throw new Error("session not found");
        }

        const userMessage = selectMessageInSessionStmt.get(safeUserMessageId, safeSessionId);
        if (!userMessage || userMessage.role !== "user") {
            throw new Error("user message not found");
        }

        const maybeAssistant = selectMessageByIdStmt.get(safeUserMessageId + 1);
        const shouldDeleteAssistant =
            maybeAssistant &&
            Number(maybeAssistant.session_id) === safeSessionId &&
            maybeAssistant.role === "assistant";

        deleteMessageMetricByMessageIdStmt.run(safeUserMessageId);
        deleteMessageByIdStmt.run(safeUserMessageId);

        if (shouldDeleteAssistant) {
            deleteMessageMetricByMessageIdStmt.run(Number(maybeAssistant.id));
            deleteMessageByIdStmt.run(Number(maybeAssistant.id));
        }

        touchSessionStmt.run(safeSessionId);

        return {
            deletedUserMessageId: safeUserMessageId,
            deletedAssistantMessageId: shouldDeleteAssistant ? Number(maybeAssistant.id) : null,
        };
    });

    return tx();
}

export function getMessageStats(userId) {
    if (!selectMessageStatsStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    const row = selectMessageStatsStmt.get(safeUserId);
    return {
        total: row?.total ?? 0,
        user_count: row?.user_count ?? 0,
        assistant_count: row?.assistant_count ?? 0,
        at: new Date().toISOString()
    };
}

export function getRecentObservability(userId, limit = 30) {
    if (!selectRecentMetricsStmt) {
        initDB();
    }

    const safeUserId = Number(userId) || defaultUserId;
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30));
    return selectRecentMetricsStmt.all(safeUserId, safeLimit);
}

export default db;
