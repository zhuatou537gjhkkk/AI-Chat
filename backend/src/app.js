import "dotenv/config";
import express from "express";
import cors from "cors";
import {
    initDB,
    saveMessage,
    getHistoryMessages,
    getMessageStats,
    createSession,
    getSessions,
    renameSession,
    removeSession
} from "./db/index.js";
import { chatWithStream } from "./services/chat.js";
import { uploadMiddleware, processAndStoreDocument, retrieveKnowledgeEvidence } from "./rag/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

initDB();

function isDbCountIntent(input) {
    const text = String(input || "");
    return /数据库|sqlite|历史消息|对话记录/.test(text) && /多少|几条|总数|条数|统计|count/.test(text);
}

function isKnowledgeIntent(input) {
    const text = String(input || "");
    const hasDocCue = /文档|资料|文件|手册|说明书|知识库|上传|上文|文中|这份|该文|来源|证据|摘录/.test(text);
    const hasFileRef = /\b[\w.-]+\.(txt|md|pdf|doc|docx)\b/i.test(text);
    return hasDocCue || hasFileRef;
}

function sendSseText(res, text) {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
}

function sanitizeSnippet(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .trim();
}

function buildEvidenceSummary(items) {
    const snippets = items
        .map((item) => sanitizeSnippet(item.content))
        .filter(Boolean);

    if (snippets.length === 0) {
        return "根据当前检索结果，暂时无法提炼出明确结论。";
    }

    const merged = snippets.join("；");
    const sentencePieces = merged
        .split(/[。！？!?；;]+/)
        .map((part) => part.trim())
        .filter(Boolean);

    const keyPoints = sentencePieces.slice(0, 2);

    if (keyPoints.length === 0) {
        return `根据检索到的文档内容，核心信息是：${merged.slice(0, 120)}${merged.length > 120 ? "..." : ""}`;
    }

    return `根据检索到的文档内容，结论如下：${keyPoints.join("；")}。`;
}

function formatEvidenceAnswer(items) {
    const summary = buildEvidenceSummary(items);
    const lines = items.map((item, index) => {
        const score = Number(item.score).toFixed(4);
        return `${index + 1}. 来源：${item.source}（score=${score}）\n摘录：${item.content}`;
    });

    return `${summary}\n\n证据引用：\n${lines.join("\n\n")}`;
}

app.get("/ping", (req, res) => {
    res.json({
        ok: true,
        message: "pong",
        time: new Date().toISOString()
    });
});

app.get("/sessions", (req, res) => {
    const sessions = getSessions();

    return res.json({
        ok: true,
        sessions
    });
});

app.post("/sessions", (req, res) => {
    const { title } = req.body || {};
    const id = createSession(title || "新对话");

    return res.json({
        ok: true,
        id
    });
});

app.patch("/sessions/:id", (req, res) => {
    const sessionId = Number(req.params.id);
    const { title } = req.body || {};

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid session id"
        });
    }

    if (!String(title || "").trim()) {
        return res.status(400).json({
            ok: false,
            message: "title is required"
        });
    }

    const result = renameSession(sessionId, title);
    if (!result?.changes) {
        return res.status(404).json({
            ok: false,
            message: "session not found"
        });
    }

    return res.json({
        ok: true
    });
});

app.delete("/sessions/:id", (req, res) => {
    const sessionId = Number(req.params.id);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid session id"
        });
    }

    const result = removeSession(sessionId);
    if (!result?.changes) {
        return res.status(404).json({
            ok: false,
            message: "session not found"
        });
    }

    return res.json({
        ok: true
    });
});

app.get("/sessions/:id/messages", (req, res) => {
    const sessionId = Number(req.params.id);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid session id"
        });
    }

    const history = getHistoryMessages(sessionId, 100);
    return res.json({
        ok: true,
        messages: history
    });
});

app.post("/test-db", (req, res) => {
    const { session_id, role, content } = req.body || {};
    const sessionId = Number(session_id);

    if (!Number.isInteger(sessionId) || sessionId <= 0 || !role || !content) {
        return res.status(400).json({
            ok: false,
            message: "session_id, role and content are required"
        });
    }

    saveMessage(sessionId, role, content);
    const history = getHistoryMessages(sessionId, 20);

    return res.json({
        ok: true,
        history
    });
});

app.post("/upload", uploadMiddleware, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                ok: false,
                message: "file is required"
            });
        }

        const result = await processAndStoreDocument(
            req.file.buffer,
            req.file.originalname
        );

        return res.json({
            ok: true,
            message: "document indexed",
            data: result
        });
    } catch (error) {
        return res.status(500).json({
            ok: false,
            message: error.message || "upload failed"
        });
    }
});

app.post("/chat", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const { session_id, message } = req.body || {};
    const sessionId = Number(session_id);

    if (!Number.isInteger(sessionId) || sessionId <= 0 || !message) {
        res.write(
            `data: ${JSON.stringify({ error: "session_id and message are required" })}\n\n`
        );
        res.end();
        return;
    }

    if (isDbCountIntent(message)) {
        saveMessage(sessionId, "user", message);
        const stats = getMessageStats();
        const answer = `截至目前，数据库消息共 ${stats.total} 条（user: ${stats.user_count}，assistant: ${stats.assistant_count}）。`;
        saveMessage(sessionId, "assistant", answer);

        sendSseText(res, answer);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
    }

    if (isKnowledgeIntent(message)) {
        const evidence = await retrieveKnowledgeEvidence(message);
        saveMessage(sessionId, "user", message);

        if (evidence.status === "ok") {
            const answer = formatEvidenceAnswer(evidence.items);
            saveMessage(sessionId, "assistant", answer);
            sendSseText(res, answer);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
        }

        const answer = evidence.status === "empty"
            ? "当前知识库为空，请先上传 txt 或 md 文档。"
            : "知识库中未检索到足够相关证据，建议换个问法，或在问题里带上文档名/关键词（如 A.txt、B.md）。";

        saveMessage(sessionId, "assistant", answer);
        sendSseText(res, answer);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
    }

    await chatWithStream(sessionId, message, res);
});

app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
});
