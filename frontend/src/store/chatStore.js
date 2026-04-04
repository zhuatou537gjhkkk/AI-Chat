import { create } from 'zustand';
import { fetchChatStream } from '../api/chat';

const initialMessage = {
    id: 'init',
    role: 'assistant',
    content: '你好，我是你的 AI 助手，有什么可以帮你的吗？',
};

export const useChatStore = create((set) => ({
    messages: [initialMessage],
    isTyping: false,
    sendMessage: async (content) => {
        const userMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
        };

        const assistantMessageId = `assistant-${Date.now()}`;
        const assistantMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
        };

        set((state) => ({
            messages: [...state.messages, userMessage, assistantMessage],
            isTyping: true,
        }));

        await fetchChatStream(
            content,
            (chunk) => {
                set((state) => ({
                    messages: state.messages.map((message, index, allMessages) => {
                        if (index !== allMessages.length - 1 || message.role !== 'assistant') {
                            return message;
                        }

                        return {
                            ...message,
                            content: message.content + chunk,
                        };
                    }),
                }));
            },
            () => {
                set({ isTyping: false });
            },
            () => {
                set((state) => ({
                    messages: state.messages.map((message, index, allMessages) => {
                        if (index !== allMessages.length - 1 || message.role !== 'assistant') {
                            return message;
                        }

                        return {
                            ...message,
                            content: '抱歉，当前服务暂时不可用，请稍后重试。',
                        };
                    }),
                    isTyping: false,
                }));
            }
        );
    },
}));
