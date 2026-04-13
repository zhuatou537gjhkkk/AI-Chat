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
    toggleSessionPin
} from "./db/index.js";
import { chatWithStream } from "./services/chat.js";
import {
    uploadMiddleware,
    processAndStoreDocument,
    retrieveKnowledgeEvidence,
    getLatestUploadedSource
} from "./rag/index.js";
import { saveUploadedImage, getUploadedImageDataUrl } from "./images/store.js";

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

app.patch("/sessions/:id/pin", (req, res) => {
    const sessionId = Number(req.params.id);
    const pinned = Boolean(req.body?.pinned);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({
            ok: false,
            message: "invalid session id"
        });
    }

    const result = toggleSessionPin(sessionId, pinned);
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

app.post("/upload-image", (req, res) => {
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

app.post("/chat", async (req, res) => {
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
        const preferredSource = refersToLatestUpload(message)
            ? getLatestUploadedSource()
            : "";
        const evidence = await retrieveKnowledgeEvidence(message, {
            topK: 12,
            returnK: 6,
            preferredSource
        });
        saveMessage(sessionId, "user", message);

        if (evidence.status === "ok") {
            const context = evidence.items
                .map((item) => String(item?.content || "").trim())
                .filter(Boolean)
                .join("\n\n");

            const enhancedPrompt = `你是一个智能助手。请严格根据以下检索到的参考资料，回答用户的问题。如果资料不包含相关答案，请告知用户。\n\n参考资料：\n${context}\n\n用户问题：${message}`;

            await chatWithStream(sessionId, enhancedPrompt, resolvedImage, systemPrompt, temperature, res, {
                enableWebSearch: false,
                skipUserMessageSave: true
            });
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

    await chatWithStream(sessionId, message, resolvedImage, systemPrompt, temperature, res, {
        enableWebSearch,
    });
});

app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
});
