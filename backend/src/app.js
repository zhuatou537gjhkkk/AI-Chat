import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDB, saveMessage, getHistoryMessages, getMessageStats } from "./db/index.js";
import { chatWithStream } from "./services/chat.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

initDB();

function isDbCountIntent(input) {
    const text = String(input || "");
    return /数据库|sqlite|历史消息|对话记录/.test(text) && /多少|几条|总数|条数|统计|count/.test(text);
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

app.post("/test-db", (req, res) => {
    const { role, content } = req.body || {};

    if (!role || !content) {
        return res.status(400).json({
            ok: false,
            message: "role and content are required"
        });
    }

    saveMessage(role, content);
    const history = getHistoryMessages(20);

    return res.json({
        ok: true,
        history
    });
});

app.post("/chat", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const { message } = req.body || {};

    if (!message) {
        res.write(
            `data: ${JSON.stringify({ error: "message is required" })}\n\n`
        );
        res.end();
        return;
    }

    if (isDbCountIntent(message)) {
        saveMessage("user", message);
        const stats = getMessageStats();
        const answer = `截至目前，数据库消息共 ${stats.total} 条（user: ${stats.user_count}，assistant: ${stats.assistant_count}）。`;
        saveMessage("assistant", answer);

        sendSseText(res, answer);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
    }

    await chatWithStream(message, res);
});

app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
});
