import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import {
    initDB,
    saveMessage,
    getHistoryMessages,
    getMessageStats,
    createSession,
    getSessions,
    renameSession,
    removeSession,
    toggleSessionPin,
    createUser,
    getUserByUsername,
    getUserById,
    saveMessageMetric,
    createBranchSession,
    getSessionById,
    getRecentObservability,
    removeMessagePair,
} from "./db/index.js";
import { chatWithStream } from "./services/chat.js";
import {
    uploadMiddleware,
    processAndStoreDocument,
    retrieveKnowledgeEvidence,
    getLatestUploadedSource
} from "./rag/index.js";
import { saveUploadedImage, getUploadedImageDataUrl } from "./images/store.js";
import {
    hashPassword,
    verifyPassword,
    issueAuthToken,
    verifyAuthToken,
    parseBearerToken,
} from "./auth.js";

const app = express();
const PORT = process.env.PORT || 3000;
const imageUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 8 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        if (!String(file.mimetype || "").startsWith("image/")) {
            cb(new Error("仅支持图片上传"));
            return;
        }

        cb(null, true);
    },
}).single("image");

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

initDB();

function requireAuth(req, res, next) {
    const token = parseBearerToken(req);
    const payload = verifyAuthToken(token);

    if (!payload?.sub) {
        return res.status(401).json({
            ok: false,
            message: "unauthorized",
        });
    }

    const user = getUserById(payload.sub);
    if (!user) {
        return res.status(401).json({
            ok: false,
            message: "invalid user",
        });
    }

    req.user = {
        id: Number(user.id),
        username: user.username,
    };
    return next();
}

function isDbCountIntent(input) {
    const text = String(input || "");
    return /数据库|sqlite|历史消息|对话记录/.test(text) && /多少|几条|总数|条数|统计|count/.test(text);
}

function isKnowledgeIntent(input) {
    const text = String(input || "");
    const hasDocCue = /文档|资料|文件|手册|说明书|知识库|上传|上文|文中|这份|该文|来源|证据|摘录/.test(text);
    const hasFileRef = /\b[\w.-]+\.(txt|md)\b/i.test(text);
    return hasDocCue || hasFileRef;
}

function refersToLatestUpload(input) {
    const text = String(input || "");
    return /我上传的这个|刚上传|这个文件|这份文件|当前上传/.test(text);
}

function sendSseText(res, text) {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
}

function sendSseMetrics(res, metrics) {
    res.write(`data: ${JSON.stringify({ type: "metrics", metrics })}\n\n`);
}

app.get("/ping", (req, res) => {
    res.json({
        ok: true,
        message: "pong",
        time: new Date().toISOString()
    });
});

app.post("/auth/register", (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (username.length < 3 || password.length < 6) {
        return res.status(400).json({
            ok: false,
            message: "用户名至少 3 位，密码至少 6 位",
        });
    }

    if (getUserByUsername(username)) {
        return res.status(409).json({
            ok: false,
            message: "用户名已存在",
        });
    }

    const userId = createUser(username, hashPassword(password));
    const user = getUserById(userId);
    const token = issueAuthToken(user);

    return res.json({
        ok: true,
        token,
        user,
    });
});

app.post("/auth/login", (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
        return res.status(400).json({
            ok: false,
            message: "username and password are required",
        });
    }

    const user = getUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({
            ok: false,
            message: "用户名或密码错误",
        });
    }

    const token = issueAuthToken(user);
    return res.json({
        ok: true,
        token,
        user: {
            id: user.id,
            username: user.username,
            created_at: user.created_at,
        },
    });
});

app.get("/auth/me", requireAuth, (req, res) => {
    return res.json({
        ok: true,
        user: req.user,
    });
});

app.get("/sessions", requireAuth, (req, res) => {
    const sessions = getSessions(req.user.id);

    return res.json({
        ok: true,
        sessions
    });
});

app.post("/sessions", requireAuth, (req, res) => {
    const { title } = req.body || {};
    const id = createSession(req.user.id, title || "新对话");

    return res.json({
        ok: true,
        id
    });
});

app.patch("/sessions/:id", requireAuth, (req, res) => {
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

    const result = renameSession(req.user.id, sessionId, title);
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

app.delete("/sessions/:id", requireAuth, (req, res) => {
    const sessionId = Number(req.params.id);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid session id"
        });
    }

    const result = removeSession(req.user.id, sessionId);
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

app.patch("/sessions/:id/pin", requireAuth, (req, res) => {
    const sessionId = Number(req.params.id);
    const pinned = Boolean(req.body?.pinned);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid session id"
        });
    }

    const result = toggleSessionPin(req.user.id, sessionId, pinned);
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

app.get("/sessions/:id/messages", requireAuth, (req, res) => {
    const sessionId = Number(req.params.id);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid session id"
        });
    }

    const history = getHistoryMessages(req.user.id, sessionId, 100);
    return res.json({
        ok: true,
        messages: history
    });
});

app.delete("/sessions/:id/messages/:messageId/pair", requireAuth, (req, res) => {
    const sessionId = Number(req.params.id);
    const messageId = Number(req.params.messageId);

    if (!Number.isInteger(sessionId) || sessionId <= 0 || !Number.isInteger(messageId) || messageId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid session id or message id",
        });
    }

    try {
        const result = removeMessagePair(req.user.id, sessionId, messageId);
        return res.json({
            ok: true,
            ...result,
        });
    } catch (error) {
        return res.status(400).json({
            ok: false,
            message: error.message || "remove message pair failed",
        });
    }
});

app.post("/sessions/:id/branch", requireAuth, (req, res) => {
    const sourceSessionId = Number(req.params.id);
    const fromMessageIdRaw = req.body?.from_message_id;
    const fromMessageId = fromMessageIdRaw == null ? null : Number(fromMessageIdRaw);
    const title = String(req.body?.title || "").trim();
    const editedContent = String(req.body?.edited_content || "");

    if (!Number.isInteger(sourceSessionId) || sourceSessionId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid source session id"
        });
    }

    if (fromMessageId != null && (!Number.isInteger(fromMessageId) || fromMessageId <= 0)) {
        return res.status(400).json({
            ok: false,
            message: "invalid from message id"
        });
    }

    try {
        const branchTitle = title || `分支-${new Date().toLocaleString()}`;
        const branchId = createBranchSession(
            req.user.id,
            sourceSessionId,
            fromMessageId,
            branchTitle,
            editedContent
        );
        const session = getSessionById(req.user.id, branchId);

        return res.json({
            ok: true,
            id: branchId,
            session,
        });
    } catch (error) {
        return res.status(400).json({
            ok: false,
            message: error.message || "branch failed",
        });
    }
});

app.get("/observability/recent", requireAuth, (req, res) => {
    const limit = Number(req.query?.limit || 30);
    const records = getRecentObservability(req.user.id, limit);

    return res.json({
        ok: true,
        records,
    });
});

app.post("/test-db", requireAuth, (req, res) => {
    const { session_id, role, content } = req.body || {};
    const sessionId = Number(session_id);

    if (!Number.isInteger(sessionId) || sessionId <= 0 || !role || !content) {
        return res.status(400).json({
            ok: false,
            message: "session_id, role and content are required"
        });
    }

    saveMessage(req.user.id, sessionId, role, content);
    const history = getHistoryMessages(req.user.id, sessionId, 20);

    return res.json({
        ok: true,
        history
    });
});

app.post("/upload", requireAuth, uploadMiddleware, async (req, res) => {
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
        const message = error.message || "upload failed";
        const statusCode = /仅支持上传|file type|invalid file/i.test(message)
            ? 400
            : 500;

        return res.status(statusCode).json({
            ok: false,
            message
        });
    }
});

app.post("/upload-image", requireAuth, (req, res) => {
    imageUploadMiddleware(req, res, (error) => {
        if (error) {
            const message = error.message || "image upload failed";
            const statusCode = /仅支持图片上传|file type|invalid file/i.test(message)
                ? 400
                : /File too large/i.test(message)
                    ? 413
                    : 500;

            res.status(statusCode).json({
                ok: false,
                message,
            });
            return;
        }

        if (!req.file?.buffer) {
            res.status(400).json({
                ok: false,
                message: "image is required",
            });
            return;
        }

        const id = saveUploadedImage(req.file.buffer, req.file.mimetype || "image/jpeg");

        res.json({
            ok: true,
            id,
        });
    });
});

app.post("/chat", requireAuth, async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const {
        session_id,
        message,
        image,
        image_id,
        enable_web_search,
        systemPrompt,
        temperature
    } = req.body || {};
    const sessionId = Number(session_id);
    const enableWebSearch = enable_web_search === true;
    const resolvedImage = image || getUploadedImageDataUrl(image_id);

    if (image_id && !resolvedImage) {
        res.write(
            `data: ${JSON.stringify({ error: "image_id is invalid or expired, please re-upload" })}\n\n`
        );
        res.end();
        return;
    }

    if (!Number.isInteger(sessionId) || sessionId <= 0 || (!message && !resolvedImage)) {
        res.write(
            `data: ${JSON.stringify({ error: "session_id and message or image are required" })}\n\n`
        );
        res.end();
        return;
    }

    if (!getSessionById(req.user.id, sessionId)) {
        res.write(
            `data: ${JSON.stringify({ error: "session not found" })}\n\n`
        );
        res.end();
        return;
    }

    if (isDbCountIntent(message)) {
        saveMessage(req.user.id, sessionId, "user", message);
        const stats = getMessageStats(req.user.id);
        const answer = `截至目前，数据库消息共 ${stats.total} 条（user: ${stats.user_count}，assistant: ${stats.assistant_count}）。`;
        const assistantMessageId = saveMessage(req.user.id, sessionId, "assistant", answer);
        const metrics = {
            latency_ms: 0,
            prompt_tokens: 0,
            completion_tokens: Math.max(1, Math.ceil(String(answer).length / 4)),
            total_tokens: Math.max(1, Math.ceil(String(answer).length / 4)),
            model: "local-stats",
        };
        saveMessageMetric(assistantMessageId, metrics);

        sendSseText(res, answer);
        sendSseMetrics(res, metrics);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
    }

    if (isKnowledgeIntent(message)) {
        const preferredSource = refersToLatestUpload(message)
            ? getLatestUploadedSource()
            : "";
        const evidence = await retrieveKnowledgeEvidence(message, {
            topK: 12,
            returnK: 6,
            preferredSource
        });
        saveMessage(req.user.id, sessionId, "user", message);

        if (evidence.status === "ok") {
            const context = evidence.items
                .map((item) => String(item?.content || "").trim())
                .filter(Boolean)
                .join("\n\n");

            const enhancedPrompt = `你是一个智能助手。请严格根据以下检索到的参考资料，回答用户的问题。如果资料不包含相关答案，请告知用户。\n\n参考资料：\n${context}\n\n用户问题：${message}`;

            await chatWithStream(req.user.id, sessionId, enhancedPrompt, resolvedImage, systemPrompt, temperature, res, {
                enableWebSearch: false,
                skipUserMessageSave: true,
                onComplete: (metrics) => {
                    if (metrics?.messageId) {
                        saveMessageMetric(metrics.messageId, metrics);
                    }
                    sendSseMetrics(res, metrics);
                },
            });
            return;
        }

        const answer = evidence.status === "empty"
            ? "当前知识库为空，请先上传 txt 或 md 文档。"
            : "知识库中未检索到足够相关证据，建议换个问法，或在问题里带上文档名/关键词（如 A.txt、B.md）。";

        const assistantMessageId = saveMessage(req.user.id, sessionId, "assistant", answer);
        const metrics = {
            latency_ms: 0,
            prompt_tokens: 0,
            completion_tokens: Math.max(1, Math.ceil(String(answer).length / 4)),
            total_tokens: Math.max(1, Math.ceil(String(answer).length / 4)),
            model: "local-rag",
        };
        saveMessageMetric(assistantMessageId, metrics);
        sendSseText(res, answer);
        sendSseMetrics(res, metrics);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
    }

    await chatWithStream(req.user.id, sessionId, message, resolvedImage, systemPrompt, temperature, res, {
        enableWebSearch,
        onComplete: (metrics) => {
            if (metrics?.messageId) {
                saveMessageMetric(metrics.messageId, metrics);
            }
            sendSseMetrics(res, metrics);
        },
    });
});

app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
});
