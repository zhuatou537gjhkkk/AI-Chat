import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
const DEFAULT_SYSTEM_PROMPT = '你是一个有用的 AI 助手。';
const DEFAULT_TEMPERATURE = 0.7;

function normalizeTemperatureValue(temp) {
    const value = Number(temp);
    if (!Number.isFinite(value)) {
        return DEFAULT_TEMPERATURE;
    }

    return Math.max(0, Math.min(1, value));
}

function createDefaultAgentSettings() {
    return {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        temperature: DEFAULT_TEMPERATURE,
    };
}

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

export const useChatStore = create(persist((set, get) => ({
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
    lastFailedRequest: null,
    messages: [initialMessage],
    isTyping: false,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: DEFAULT_TEMPERATURE,
    sessionAgentSettings: {},
    isSettingsOpen: false,
    setSystemPrompt: (prompt) => {
        const nextPrompt = String(prompt ?? '');

        set((state) => {
            const sessionId = state.currentSessionId;
            if (!sessionId) {
                return { systemPrompt: nextPrompt };
            }

            const sessionSettings = state.sessionAgentSettings[sessionId] || createDefaultAgentSettings();

            return {
                systemPrompt: nextPrompt,
                sessionAgentSettings: {
                    ...state.sessionAgentSettings,
                    [sessionId]: {
                        ...sessionSettings,
                        systemPrompt: nextPrompt,
                    },
                },
            };
        });
    },
    setTemperature: (temp) => {
        const normalized = normalizeTemperatureValue(temp);

        set((state) => {
            const sessionId = state.currentSessionId;
            if (!sessionId) {
                return { temperature: normalized };
            }

            const sessionSettings = state.sessionAgentSettings[sessionId] || createDefaultAgentSettings();

            return {
                temperature: normalized,
                sessionAgentSettings: {
                    ...state.sessionAgentSettings,
                    [sessionId]: {
                        ...sessionSettings,
                        temperature: normalized,
                    },
                },
            };
        });
    },
    resetCurrentSessionSettings: () => {
        set((state) => {
            const nextDefault = createDefaultAgentSettings();
            const sessionId = state.currentSessionId;

            if (!sessionId) {
                return {
                    systemPrompt: nextDefault.systemPrompt,
                    temperature: nextDefault.temperature,
                };
            }

            return {
                systemPrompt: nextDefault.systemPrompt,
                temperature: nextDefault.temperature,
                sessionAgentSettings: {
                    ...state.sessionAgentSettings,
                    [sessionId]: nextDefault,
                },
            };
        });
    },
    toggleSettings: () => {
        set((state) => ({ isSettingsOpen: !state.isSettingsOpen }));
    },
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

                const initialSettings = createDefaultAgentSettings();

                set({
                    hasInitializedSessions: true,
                    sessions: [session],
                    currentSessionId: id,
                    messages: [initialMessage],
                    systemPrompt: initialSettings.systemPrompt,
                    temperature: initialSettings.temperature,
                    sessionAgentSettings: {
                        ...get().sessionAgentSettings,
                        [id]: initialSettings,
                    },
                    sessionError: '',
                });
                return;
            }

            const currentId = list[0].id;
            const history = await fetchMessagesBySession(currentId);
            const nextAgentSettings = { ...get().sessionAgentSettings };

            for (const session of list) {
                if (!nextAgentSettings[session.id]) {
                    nextAgentSettings[session.id] = createDefaultAgentSettings();
                }
            }

            const currentAgentSettings = nextAgentSettings[currentId] || createDefaultAgentSettings();

            set({
                hasInitializedSessions: true,
                sessions: list,
                currentSessionId: currentId,
                messages: history.length > 0 ? history : [initialMessage],
                systemPrompt: currentAgentSettings.systemPrompt,
                temperature: currentAgentSettings.temperature,
                sessionAgentSettings: nextAgentSettings,
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
                systemPrompt: (() => {
                    const saved = state.sessionAgentSettings[id];
                    return saved ? saved.systemPrompt : DEFAULT_SYSTEM_PROMPT;
                })(),
                temperature: (() => {
                    const saved = state.sessionAgentSettings[id];
                    return saved ? normalizeTemperatureValue(saved.temperature) : DEFAULT_TEMPERATURE;
                })(),
                sessionAgentSettings: (() => {
                    if (state.sessionAgentSettings[id]) {
                        return state.sessionAgentSettings;
                    }

                    return {
                        ...state.sessionAgentSettings,
                        [id]: createDefaultAgentSettings(),
                    };
                })(),
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
            const defaultSettings = createDefaultAgentSettings();

            set((state) => ({
                systemPrompt: defaultSettings.systemPrompt,
                temperature: defaultSettings.temperature,
                hasInitializedSessions: true,
                sessions: [newSession, ...state.sessions],
                currentSessionId: id,
                messages: [initialMessage],
                isTyping: false,
                sessionAgentSettings: {
                    ...state.sessionAgentSettings,
                    [id]: defaultSettings,
                },
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

                const defaultSettings = createDefaultAgentSettings();
                const nextSettingsMap = { ...state.sessionAgentSettings };
                delete nextSettingsMap[id];
                nextSettingsMap[newId] = defaultSettings;

                set({
                    sessions: [fallbackSession],
                    currentSessionId: newId,
                    messages: [initialMessage],
                    systemPrompt: defaultSettings.systemPrompt,
                    temperature: defaultSettings.temperature,
                    sessionAgentSettings: nextSettingsMap,
                    sessionError: '',
                });
                return;
            }

            const nextSessionId =
                state.currentSessionId === id ? remainingSessions[0].id : state.currentSessionId;

            set((state) => {
                const nextSettingsMap = { ...state.sessionAgentSettings };
                delete nextSettingsMap[id];

                if (state.currentSessionId !== id) {
                    return {
                        sessions: sortSessionsByUpdatedAt(remainingSessions),
                        currentSessionId: nextSessionId,
                        sessionAgentSettings: nextSettingsMap,
                        sessionError: '',
                    };
                }

                const activeSettings =
                    nextSettingsMap[nextSessionId] ||
                    createDefaultAgentSettings();

                if (!nextSettingsMap[nextSessionId]) {
                    nextSettingsMap[nextSessionId] = activeSettings;
                }

                return {
                    sessions: sortSessionsByUpdatedAt(remainingSessions),
                    currentSessionId: nextSessionId,
                    systemPrompt: activeSettings.systemPrompt,
                    temperature: normalizeTemperatureValue(activeSettings.temperature),
                    sessionAgentSettings: nextSettingsMap,
                    sessionError: '',
                };
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
        const failedRequest = get().lastFailedRequest;
        if (!failedRequest?.content || get().isTyping) {
            return;
        }

        await get().sendMessage(failedRequest.content, {
            enableWebSearch: failedRequest.enableWebSearch,
        });
    },
    sendMessage: async (content, options = {}) => {
        const { enableWebSearch = true } = options;
        const state = useChatStore.getState();
        const sessionId = state.currentSessionId;

        const sessionSpecificSettings = sessionId
            ? state.sessionAgentSettings[sessionId]
            : null;
        const systemPrompt = sessionSpecificSettings?.systemPrompt ?? state.systemPrompt;
        const temperature = normalizeTemperatureValue(
            sessionSpecificSettings?.temperature ?? state.temperature
        );

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
            toolLogs: [],
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
            (toolData) => {
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

                        const currentToolLogs = Array.isArray(tail.toolLogs) ? [...tail.toolLogs] : [];

                        if (toolData?.type === 'tool_start') {
                            currentToolLogs.push({
                                name: toolData.toolName,
                                input: toolData.input,
                                status: 'running',
                            });
                        }

                        if (toolData?.type === 'tool_end') {
                            for (let i = currentToolLogs.length - 1; i >= 0; i -= 1) {
                                const log = currentToolLogs[i];
                                if (log.name === toolData.toolName && log.status === 'running') {
                                    currentToolLogs[i] = {
                                        ...log,
                                        status: 'success',
                                    };
                                    break;
                                }
                            }
                        }

                        nextMessages[tailIndex] = {
                            ...tail,
                            toolLogs: currentToolLogs,
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
                    lastFailedRequest: null,
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
                    lastFailedRequest: isAbort
                        ? null
                        : {
                            content,
                            enableWebSearch,
                        },
                }));
            },
            {
                signal: controller.signal,
                enableWebSearch,
                systemPrompt,
                temperature,
            }
        );
    },
}), {
    name: 'chat-agent-settings',
    partialize: (state) => ({
        sessionAgentSettings: state.sessionAgentSettings,
    }),
}));
