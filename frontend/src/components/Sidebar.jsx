import { useMemo, useState } from 'react';
import { useChatStore } from '../store/chatStore';

export default function Sidebar({ className = '', onAfterSelect }) {
    const [keyword, setKeyword] = useState('');
    const sessions = useChatStore((state) => state.sessions);
    const currentSessionId = useChatStore((state) => state.currentSessionId);
    const isSessionLoading = useChatStore((state) => state.isSessionLoading);
    const isCreatingSession = useChatStore((state) => state.isCreatingSession);
    const sessionError = useChatStore((state) => state.sessionError);
    const initSessions = useChatStore((state) => state.initSessions);
    const switchSession = useChatStore((state) => state.switchSession);
    const addNewSession = useChatStore((state) => state.addNewSession);
    const renameSession = useChatStore((state) => state.renameSession);
    const deleteSession = useChatStore((state) => state.deleteSession);

    const filteredSessions = useMemo(() => {
        const q = keyword.trim().toLowerCase();
        if (!q) {
            return sessions;
        }

        return sessions.filter((session) => {
            const title = String(session.title || '').toLowerCase();
            const timestamp = new Date(session.updated_at || session.created_at).toLocaleString().toLowerCase();
            return title.includes(q) || timestamp.includes(q);
        });
    }, [sessions, keyword]);

    const handleSwitch = async (id) => {
        await switchSession(id);
        onAfterSelect?.();
    };

    const handleCreate = async () => {
        await addNewSession();
        onAfterSelect?.();
    };

    const handleRename = async (event, session) => {
        event.stopPropagation();

        const nextTitle = window.prompt('请输入新会话标题', session.title || '');
        if (!nextTitle) {
            return;
        }

        await renameSession(session.id, nextTitle);
    };

    const handleDelete = async (event, sessionId) => {
        event.stopPropagation();

        const confirmed = window.confirm('确认删除该会话及其全部消息吗？此操作不可恢复。');
        if (!confirmed) {
            return;
        }

        await deleteSession(sessionId);
    };

    return (
        <aside className={`flex h-full w-72 flex-col bg-gray-900 text-white ${className}`}>
            <div className="border-b border-gray-800 p-4">
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={isCreatingSession}
                    className="w-full rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-400"
                >
                    {isCreatingSession ? '创建中...' : '+ 新建对话'}
                </button>

                <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索会话"
                    className="mt-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-100 outline-none placeholder:text-gray-400 focus:border-blue-400"
                />
            </div>

            {sessionError && (
                <div className="mx-3 mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    <p>{sessionError}</p>
                    <button
                        type="button"
                        onClick={initSessions}
                        className="mt-2 rounded bg-red-500/20 px-2 py-1 text-[11px] text-red-100 transition hover:bg-red-500/30"
                    >
                        重试初始化
                    </button>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-3">
                <ul className="space-y-2">
                    {filteredSessions.map((session) => {
                        const active = session.id === currentSessionId;

                        return (
                            <li key={session.id}>
                                <button
                                    type="button"
                                    onClick={() => handleSwitch(session.id)}
                                    className={[
                                        'w-full rounded-lg px-3 py-2 text-left text-sm transition',
                                        active
                                            ? 'bg-gray-700 text-white'
                                            : 'bg-gray-800/60 text-gray-200 hover:bg-gray-800',
                                    ].join(' ')}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="truncate font-medium">{session.title || '未命名会话'}</p>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={(event) => handleRename(event, session)}
                                                aria-label="重命名会话"
                                                className="rounded px-1 text-[10px] text-gray-300 hover:bg-gray-600/60"
                                            >
                                                改
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(event) => handleDelete(event, session.id)}
                                                aria-label="删除会话"
                                                className="rounded px-1 text-[10px] text-red-300 hover:bg-red-500/20"
                                            >
                                                删
                                            </button>
                                        </div>
                                    </div>
                                    <p className="mt-1 truncate text-xs text-gray-400">
                                        {new Date(session.updated_at || session.created_at).toLocaleString()}
                                    </p>
                                </button>
                            </li>
                        );
                    })}

                    {filteredSessions.length === 0 && (
                        <li className="rounded-lg bg-gray-800/40 px-3 py-2 text-xs text-gray-400">
                            未找到匹配会话
                        </li>
                    )}
                </ul>
            </div>
        </aside>
    );
}
