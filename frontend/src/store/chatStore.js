import { create } from 'zustand';
import {
    fetchChatStream,
    fetchSessions,
    createSession,
    fetchMessagesBySession,
    updateSessionTitle,
    deleteSession as deleteSessionApi,
} from '../api/chat';

const initialMessage = {
    id: 'init',
    role: 'assistant',
    content: '你好，我是你的 AI 助手，有什么可以帮你的吗？',
};

const DEFAULT_SESSION_TITLE = '新对话';

function toSessionPreviewTitle(content) {
    const normalized = String(content || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return DEFAULT_SESSION_TITLE;
    }

    return normalized.slice(0, 18);
}

function isDefaultSessionTitle(title) {
    return !title || title === DEFAULT_SESSION_TITLE;
}

function sortSessionsByUpdatedAt(sessions) {
    return [...sessions].sort((a, b) => {
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
    });
}

export const useChatStore = create((set, get) => ({
    sessions: [],
    currentSessionId: null,
    hasInitializedSessions: false,
    activeSessionRequestId: null,
    isSessionLoading: false,
    isCreatingSession: false,
    sessionError: '',
    activeAbortController: null,
    activeStreamToken: null,
    lastFailedUserMessage: '',
    messages: [initialMessage],
    isTyping: false,
    initSessions: async () => {
        const state = get();

        if (state.isSessionLoading) {
            return;
        }

        if (state.hasInitializedSessions && state.sessions.length > 0) {
            return;
        }

        set({
            isSessionLoading: true,
            sessionError: '',
        });

        try {
            const list = await fetchSessions();

            if (list.length === 0) {
                const id = await createSession('新对话');
                const session = {
                    id,
                    title: DEFAULT_SESSION_TITLE,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                };

                set({
                    hasInitializedSessions: true,
                    sessions: [session],
                    currentSessionId: id,
                    messages: [initialMessage],
                    sessionError: '',
                });
                return;
            }

            const currentId = list[0].id;
            const history = await fetchMessagesBySession(currentId);

            set({
                hasInitializedSessions: true,
                sessions: list,
                currentSessionId: currentId,
                messages: history.length > 0 ? history : [initialMessage],
                sessionError: '',
            });
        } catch (error) {
            set({
                hasInitializedSessions: false,
                sessions: [],
                currentSessionId: null,
                messages: [initialMessage],
                sessionError: '初始化会话失败，请点击重试。',
            });
        } finally {
            set({ isSessionLoading: false });
        }
    },
    switchSession: async (id) => {
        const requestId = `${id}-${Date.now()}`;

        set({
            currentSessionId: id,
            activeSessionRequestId: requestId,
            isSessionLoading: true,
            isTyping: false,
            sessionError: '',
        });

        try {
            const history = await fetchMessagesBySession(id);

            const state = get();
            if (state.activeSessionRequestId !== requestId || state.currentSessionId !== id) {
                return;
            }

            set({
                messages: history.length > 0 ? history : [initialMessage],
            });
        } catch (error) {
            const state = get();
            if (state.activeSessionRequestId !== requestId || state.currentSessionId !== id) {
                return;
            }

            set({
                messages: [
                    {
                        id: `error-${Date.now()}`,
                        role: 'assistant',
                        content: '加载会话失败，请稍后重试。',
                    },
                ],
                sessionError: '加载会话失败，请重试。',
            });
        } finally {
            const state = get();
            if (state.activeSessionRequestId === requestId) {
                set({
                    isSessionLoading: false,
                    activeSessionRequestId: null,
                });
            }
        }
    },
    addNewSession: async () => {
        if (get().isCreatingSession) {
            return;
        }

        set({
            isCreatingSession: true,
            sessionError: '',
        });

        try {
            const id = await createSession('新对话');
            const newSession = {
                id,
                title: DEFAULT_SESSION_TITLE,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            set((state) => ({
                hasInitializedSessions: true,
                sessions: [newSession, ...state.sessions],
                currentSessionId: id,
                messages: [initialMessage],
                isTyping: false,
                sessionError: '',
            }));
        } catch (error) {
            set({
                sessionError: '新建会话失败，请稍后重试。',
            });
        } finally {
            set({ isCreatingSession: false });
        }
    },
    renameSession: async (id, title) => {
        const safeTitle = String(title || '').trim();
        if (!safeTitle) {
            return;
        }

        try {
            await updateSessionTitle(id, safeTitle);
            set((state) => ({
                sessions: sortSessionsByUpdatedAt(state.sessions.map((session) => {
                    if (session.id !== id) {
                        return session;
                    }

                    return {
                        ...session,
                        title: safeTitle,
                        updated_at: new Date().toISOString(),
                    };
                })),
                sessionError: '',
            }));
        } catch (error) {
            set({ sessionError: '重命名失败，请稍后重试。' });
        }
    },
    deleteSession: async (id) => {
        try {
            const stateBeforeDelete = get();

            if (stateBeforeDelete.currentSessionId === id && stateBeforeDelete.isTyping) {
                get().stopMessageStream();
            }

            await deleteSessionApi(id);

            const state = get();
            const remainingSessions = state.sessions.filter((session) => session.id !== id);

            if (remainingSessions.length === 0) {
                const newId = await createSession(DEFAULT_SESSION_TITLE);
                const fallbackSession = {
                    id: newId,
                    title: DEFAULT_SESSION_TITLE,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                };

                set({
                    sessions: [fallbackSession],
                    currentSessionId: newId,
                    messages: [initialMessage],
                    sessionError: '',
                });
                return;
            }

            const nextSessionId =
                state.currentSessionId === id ? remainingSessions[0].id : state.currentSessionId;

            set({
                sessions: sortSessionsByUpdatedAt(remainingSessions),
                currentSessionId: nextSessionId,
                sessionError: '',
            });

            if (state.currentSessionId === id && nextSessionId) {
                await get().switchSession(nextSessionId);
            }
        } catch (error) {
            set({ sessionError: '删除会话失败，请稍后重试。' });
        }
    },
    stopMessageStream: () => {
        const controller = get().activeAbortController;
        if (controller) {
            controller.abort();
            set({
                isTyping: false,
                activeAbortController: null,
                activeStreamToken: null,
            });
        }
    },
    retryLastFailedMessage: async () => {
        const message = get().lastFailedUserMessage;
        if (!message || get().isTyping) {
            return;
        }

        await get().sendMessage(message);
    },
    sendMessage: async (content) => {
        const state = useChatStore.getState();
        const sessionId = state.currentSessionId;

        if (!sessionId) {
            return;
        }

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

        const streamToken = `${sessionId}-${Date.now()}`;

        set((state) => ({
            messages: [...state.messages, userMessage, assistantMessage],
            isTyping: true,
            lastFailedUserMessage: '',
            sessions: sortSessionsByUpdatedAt(
                state.sessions.map((session) => {
                    if (session.id !== sessionId) {
                        return session;
                    }

                    return {
                        ...session,
                        updated_at: new Date().toISOString(),
                    };
                })
            ),
        }));

        const currentSession = state.sessions.find((session) => session.id === sessionId);
        const hasUserMessage = state.messages.some((message) => message.role === 'user');

        if (!hasUserMessage && isDefaultSessionTitle(currentSession?.title)) {
            const generatedTitle = toSessionPreviewTitle(content);

            set((state) => ({
                sessions: state.sessions.map((session) => {
                    if (session.id !== sessionId) {
                        return session;
                    }

                    return {
                        ...session,
                        title: generatedTitle,
                    };
                }),
            }));

            updateSessionTitle(sessionId, generatedTitle).catch(() => {
                // Ignore title sync failures and keep chat flow responsive.
            });
        }

        const controller = new AbortController();
        set({
            activeAbortController: controller,
            activeStreamToken: streamToken,
        });

        await fetchChatStream(
            sessionId,
            content,
            (chunk) => {
                if (!chunk) {
                    return;
                }

                const latest = get();
                if (latest.currentSessionId !== sessionId || latest.activeStreamToken !== streamToken) {
                    return;
                }

                set((state) => ({
                    messages: (() => {
                        const nextMessages = [...state.messages];
                        const tailIndex = nextMessages.length - 1;
                        const tail = nextMessages[tailIndex];

                        if (!tail || tail.role !== 'assistant') {
                            return state.messages;
                        }

                        nextMessages[tailIndex] = {
                            ...tail,
                            content: tail.content + chunk,
                        };

                        return nextMessages;
                    })(),
                }));
            },
            () => {
                const latest = get();
                if (latest.currentSessionId !== sessionId || latest.activeStreamToken !== streamToken) {
                    return;
                }

                set({
                    isTyping: false,
                    activeAbortController: null,
                    activeStreamToken: null,
                    lastFailedUserMessage: '',
                });
            },
            (error) => {
                const isAbort = error?.name === 'AbortError';

                const latest = get();
                if (latest.currentSessionId !== sessionId || latest.activeStreamToken !== streamToken) {
                    return;
                }

                set((state) => ({
                    messages: (() => {
                        const nextMessages = [...state.messages];
                        const tailIndex = nextMessages.length - 1;
                        const tail = nextMessages[tailIndex];

                        if (!tail || tail.role !== 'assistant') {
                            return state.messages;
                        }

                        nextMessages[tailIndex] = {
                            ...tail,
                            content: isAbort
                                ? tail.content || '已停止生成。'
                                : '抱歉，当前服务暂时不可用，请稍后重试。',
                        };

                        return nextMessages;
                    })(),
                    isTyping: false,
                    activeAbortController: null,
                    activeStreamToken: null,
                    lastFailedUserMessage: isAbort ? '' : content,
                }));
            },
            { signal: controller.signal }
        );
    },
}));
