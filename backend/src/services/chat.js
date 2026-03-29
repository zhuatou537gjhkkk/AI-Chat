import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { saveMessage, getHistoryMessages } from "../db/index.js";

function toLangChainMessage(message) {
    if (message.role === "user") {
        return new HumanMessage(message.content);
    }

    if (message.role === "assistant") {
        return new AIMessage(message.content);
    }

    return new SystemMessage(message.content);
}

function normalizeChunkContent(content) {
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") {
                    return part;
                }

                if (part && typeof part.text === "string") {
                    return part.text;
                }

                return "";
            })
            .join("");
    }

    if (content == null) {
        return "";
    }

    return String(content);
}

export async function chatWithStream(userMessage, res) {
    saveMessage("user", userMessage);

    const history = getHistoryMessages(10);
    const messages = history.map(toLangChainMessage);
    messages.push(new HumanMessage(userMessage));

    const llm = new ChatOpenAI({
        modelName: "qwen-turbo",
        temperature: 0.7,
        streaming: true
    });

    let fullText = "";

    try {
        const stream = await llm.stream(messages);

        for await (const chunk of stream) {
            const text = normalizeChunkContent(chunk.content);

            if (!text) {
                continue;
            }

            fullText += text;
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }

        saveMessage("assistant", fullText);
        res.write("data: [DONE]\n\n");
        res.end();
    } catch (error) {
        res.write(
            `data: ${JSON.stringify({ error: error.message || "stream failed" })}\n\n`
        );
        res.end();
    }
}
