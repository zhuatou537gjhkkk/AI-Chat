import express from "express";
import cors from "cors";
import { initDB, saveMessage, getHistoryMessages } from "./db/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

initDB();

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

app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
});
