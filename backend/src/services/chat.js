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
    temperature: 0.2,
    streaming: true
});

const prompt = ChatPromptTemplate.fromMessages([
    [
        "system",
        "你是一个具备联网能力的资深 AI 助手。当你无法确定事实或用户询问最新资讯时，请务必主动使用 web_search 工具获取真实信息，并结合搜索结果进行总结回答。凡是公开互联网新闻、时事、公司动态、人物动态等问题，优先使用 web_search，不要误用 search_knowledge_base。同一轮回答默认只调用一次 web_search，除非用户明确要求追加检索。你必须基于 web_search 返回的条目作答，不得编造未检索到的事实。若用户要求时间窗口（如最近24小时、最近一周、最近一个月等），优先满足时间约束并明确说明命中情况；若工具返回“待核验”或“超窗候选”，必须在回答中显式标注其可靠性限制。"
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

export async function chatWithStream(session_id, userMessage, res) {
    saveMessage(session_id, "user", userMessage);

    const history = getHistoryMessages(session_id, 10);
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

        saveMessage(session_id, "assistant", fullText);
        res.write("data: [DONE]\n\n");
        res.end();
    } catch (error) {
        res.write(
            `data: ${JSON.stringify({ error: error.message || "stream failed" })}\n\n`
        );
        res.end();
    }
}
