import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { createToolCallingAgent, AgentExecutor } from "@langchain/classic/agents";
import { saveMessage, getHistoryMessages } from "../db/index.js";
import { agentTools } from "../mcp/tools.js";

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

const chatModel = new ChatOpenAI({
    modelName: "qwen-turbo",
    temperature: 0.7,
    streaming: true
});

const prompt = ChatPromptTemplate.fromMessages([
    [
        "system",
        "你是一个强大的 AI 助手，可以使用工具来回答用户的问题。凡是涉及当前时间、数据库条数、统计结果、现在有多少等实时信息时，必须先调用工具，不允许凭记忆回答。若工具返回了结构化数据，先基于工具结果给出结论，再补充解释。"
    ],
    new MessagesPlaceholder("chat_history"),
    ["user", "{input}"],
    new MessagesPlaceholder("agent_scratchpad")
]);

let agentExecutorPromise = null;

async function getAgentExecutor() {
    if (!agentExecutorPromise) {
        agentExecutorPromise = (async () => {
            const agent = await createToolCallingAgent({
                llm: chatModel,
                tools: agentTools,
                prompt
            });

            return new AgentExecutor({
                agent,
                tools: agentTools
            });
        })();
    }

    return agentExecutorPromise;
}

export async function chatWithStream(userMessage, res) {
    saveMessage("user", userMessage);

    const history = getHistoryMessages(10);
    const formattedHistory = history.map(toLangChainMessage);

    // We pass the latest user message as input, so remove duplicated tail user message from chat_history.
    if (history.length > 0) {
        const lastHistoryMessage = history[history.length - 1];
        if (
            lastHistoryMessage.role === "user" &&
            lastHistoryMessage.content === userMessage
        ) {
            formattedHistory.pop();
        }
    }

    let fullText = "";

    try {
        const agentExecutor = await getAgentExecutor();
        const eventStream = await agentExecutor.streamEvents(
            {
                input: userMessage,
                chat_history: formattedHistory
            },
            { version: "v2" }
        );

        for await (const event of eventStream) {
            if (event.event === "on_tool_start") {
                const startedAt = new Date().toISOString();
                console.log(
                    `[agent][tool_start] at=${startedAt} name=${event.name || "unknown"} input=${JSON.stringify(event?.data?.input ?? {})}`
                );
                continue;
            }

            if (event.event === "on_tool_end") {
                const endedAt = new Date().toISOString();
                console.log(
                    `[agent][tool_end] at=${endedAt} name=${event.name || "unknown"} output=${JSON.stringify(event?.data?.output ?? "")}`
                );
                continue;
            }

            if (event.event !== "on_chat_model_stream") {
                continue;
            }

            const text = normalizeChunkContent(event?.data?.chunk?.content);

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
