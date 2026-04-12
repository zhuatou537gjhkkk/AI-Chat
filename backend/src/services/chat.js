import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { createToolCallingAgent, AgentExecutor } from "@langchain/classic/agents";
import { saveMessage, getHistoryMessages } from "../db/index.js";
import { agentTools } from "../mcp/tools.js";

const WEB_SEARCH_TOOL_NAME = "web_search";
const FORCED_WEB_SEARCH_MAX_CHARS = 8000;

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

function buildPrompt(enableWebSearch) {
    const baseInstruction =
        "你是一个资深 AI 助手。当前系统时间是：{current_date}。请优先基于可验证信息回答，保持结论清晰、结构化。";

    const webSearchInstruction =
        "当你无法确定事实或用户询问最新资讯时，请务必主动使用 web_search 工具获取真实信息，并结合搜索结果进行总结回答。凡是公开互联网新闻、时事、公司动态、人物动态等问题，优先使用 web_search，不要误用 search_knowledge_base。同一轮回答默认只调用一次 web_search，除非用户明确要求追加检索。你必须基于 web_search 返回的条目作答，不得编造未检索到的事实。若用户要求时间窗口（如最近24小时、最近一周、最近一个月等），优先满足时间约束并明确说明命中情况；若工具返回“待核验”或“超窗候选”，必须在回答中显式标注其可靠性限制。";

    const noWebSearchInstruction =
        "本轮已关闭联网检索：不要调用 web_search，也不要假设你看到了实时网页结果。若问题依赖最新外部信息，请明确说明当前未启用联网，提示用户开启后再查证。";

    const systemInstruction = enableWebSearch
        ? `${baseInstruction}${webSearchInstruction}`
        : `${baseInstruction}${noWebSearchInstruction}`;

    return ChatPromptTemplate.fromMessages([
        ["system", systemInstruction],
        new MessagesPlaceholder("chat_history"),
        ["user", "{input}"],
        new MessagesPlaceholder("agent_scratchpad")
    ]);
}

const agentExecutorPromiseMap = new Map();

async function getAgentExecutor(enableWebSearch) {
    const cacheKey = enableWebSearch ? "web-on" : "web-off";
    if (!agentExecutorPromiseMap.has(cacheKey)) {
        const tools = enableWebSearch
            ? agentTools
            : agentTools.filter((tool) => tool.name !== WEB_SEARCH_TOOL_NAME);
        const prompt = buildPrompt(enableWebSearch);

        const executorPromise = (async () => {
            const agent = await createToolCallingAgent({
                llm: chatModel,
                tools,
                prompt
            });

            return new AgentExecutor({
                agent,
                tools
            });
        })();

        agentExecutorPromiseMap.set(cacheKey, executorPromise);
    }

    return agentExecutorPromiseMap.get(cacheKey);
}

export async function chatWithStream(session_id, userMessage, res, options = {}) {
    const { enableWebSearch = true } = options;
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
    let inputForAgent = userMessage;

    try {
        if (enableWebSearch) {
            const webSearchTool = agentTools.find((tool) => tool.name === WEB_SEARCH_TOOL_NAME);

            if (webSearchTool) {
                const startedAt = new Date().toISOString();
                console.log(
                    `[agent][tool_start][forced] at=${startedAt} name=${WEB_SEARCH_TOOL_NAME} input=${JSON.stringify(userMessage)}`
                );
                res.write(
                    `data: ${JSON.stringify({
                        type: "tool_start",
                        toolName: WEB_SEARCH_TOOL_NAME,
                        input: userMessage
                    })}\n\n`
                );

                let forcedSearchOutput = "";

                try {
                    const toolResult = await webSearchTool.invoke(userMessage);
                    forcedSearchOutput = normalizeChunkContent(toolResult).slice(0, FORCED_WEB_SEARCH_MAX_CHARS);
                } catch (forcedSearchError) {
                    forcedSearchOutput = `强制联网检索失败: ${forcedSearchError?.message || "unknown error"}`;
                }

                const endedAt = new Date().toISOString();
                console.log(
                    `[agent][tool_end][forced] at=${endedAt} name=${WEB_SEARCH_TOOL_NAME} output=${JSON.stringify(forcedSearchOutput)}`
                );
                res.write(
                    `data: ${JSON.stringify({
                        type: "tool_end",
                        toolName: WEB_SEARCH_TOOL_NAME
                    })}\n\n`
                );

                if (forcedSearchOutput) {
                    inputForAgent = `${userMessage}\n\n[系统提示] 已按“联网:开”强制执行一次 web_search，请优先基于以下检索结果回答；如证据不足可再调用 web_search 补充。\n${forcedSearchOutput}`;
                }
            }
        }

        const agentExecutor = await getAgentExecutor(enableWebSearch);
        const eventStream = await agentExecutor.streamEvents(
            {
                input: inputForAgent,
                chat_history: formattedHistory,
                current_date: new Date().toLocaleString()
            },
            { version: "v2" }
        );

        for await (const event of eventStream) {
            if (event.event === "on_tool_start") {
                const startedAt = new Date().toISOString();
                console.log(
                    `[agent][tool_start] at=${startedAt} name=${event.name || "unknown"} input=${JSON.stringify(event?.data?.input ?? {})}`
                );
                res.write(
                    `data: ${JSON.stringify({
                        type: "tool_start",
                        toolName: event.name || "unknown",
                        input: event?.data?.input ?? {}
                    })}\n\n`
                );
                continue;
            }

            if (event.event === "on_tool_end") {
                const endedAt = new Date().toISOString();
                console.log(
                    `[agent][tool_end] at=${endedAt} name=${event.name || "unknown"} output=${JSON.stringify(event?.data?.output ?? "")}`
                );
                res.write(
                    `data: ${JSON.stringify({
                        type: "tool_end",
                        toolName: event.name || "unknown"
                    })}\n\n`
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
            res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
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
