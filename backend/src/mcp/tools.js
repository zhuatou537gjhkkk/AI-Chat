import { DynamicTool } from "@langchain/core/tools";
import { getMessageStats } from "../db/index.js";
import { queryKnowledgeBase } from "../rag/index.js";

const getSystemTimeTool = new DynamicTool({
    name: "get_system_time",
    description: "获取服务器当前的系统时间",
    func: async () => {
        return new Date().toLocaleString();
    }
});

const getDbMessageCountTool = new DynamicTool({
    name: "get_db_message_count",
    description: "获取本地 SQLite 数据库中的历史对话总条数",
    func: async () => {
        const stats = getMessageStats();
        return JSON.stringify(stats);
    }
});

const searchKnowledgeBaseTool = new DynamicTool({
    name: "search_knowledge_base",
    description: "当用户询问上传文档中的事实、参数、负责人、定义、规则等内容时，必须先调用此工具检索，再基于检索结果回答；若无结果，明确说明未检索到证据",
    func: async (input) => {
        return queryKnowledgeBase(input);
    }
});

export const agentTools = [
    getSystemTimeTool,
    getDbMessageCountTool,
    searchKnowledgeBaseTool
];
