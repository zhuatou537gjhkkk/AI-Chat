import { DynamicTool } from "@langchain/core/tools";
import { getMessageStats } from "../db/index.js";

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

export const agentTools = [getSystemTimeTool, getDbMessageCountTool];
