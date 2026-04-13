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
    const toggleSessionPin = useChatStore((state) => state.toggleSessionPin);
    const toggleSettings = useChatStore((state) => state.toggleSettings);
    const exportCurrentSessionMarkdown = useChatStore((state) => state.exportCurrentSessionMarkdown);
    const isExporting = useChatStore((state) => state.isExporting);

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

    const handlePin = async (event, sessionId) => {
        event.stopPropagation();
        await toggleSessionPin(sessionId);
    };

    return (
        <aside className={`flex h-full w-[280px] max-w-[88vw] flex-col border-r border-slate-800 bg-[#17191c] text-slate-100 ${className}`}>
            <div className="border-b border-slate-800 p-4">
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={isCreatingSession}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isCreatingSession ? '创建中...' : '+ 新建聊天'}
                </button>

                <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索会话"
                    className="mt-3 w-full rounded-xl border border-slate-700 bg-[#1f2329] px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-slate-500"
                />
            </div>

            {sessionError && (
                <div className="mx-3 mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
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
                                    aria-label={`切换到会话 ${session.title || '未命名会话'}`}
                                    className={[
                                        'group w-full rounded-xl px-3 py-2.5 text-left text-sm transition',
                                        active
                                            ? 'bg-slate-700 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                                            : 'bg-transparent text-slate-300 hover:bg-slate-800/70',
                                    ].join(' ')}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="truncate font-medium">{session.title || '未命名会话'}</p>
                                        <div className="flex shrink-0 items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                                            <button
                                                type="button"
                                                onClick={(event) => handlePin(event, session.id)}
                                                aria-label={session.pinned ? '取消置顶会话' : '置顶会话'}
                                                className="rounded px-1 text-[10px] text-amber-300 hover:bg-amber-500/20"
                                            >
                                                {session.pinned ? '取消顶' : '置顶'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(event) => handleRename(event, session)}
                                                aria-label="重命名会话"
                                                className="rounded px-1 text-[10px] text-slate-300 hover:bg-slate-600/60"
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
                                        {session.pinned ? '📌 置顶 · ' : ''}
                                        {new Date(session.updated_at || session.created_at).toLocaleString()}
                                    </p>
                                </button>
                            </li>
                        );
                    })}

                    {filteredSessions.length === 0 && (
                        <li className="rounded-xl bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
                            未找到匹配会话
                        </li>
                    )}
                </ul>
            </div>

            <div className="border-t border-slate-800 p-3">
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={toggleSettings}
                        className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-700"
                    >
                        设置
                    </button>
                    <button
                        type="button"
                        onClick={exportCurrentSessionMarkdown}
                        disabled={isExporting}
                        className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isExporting ? '导出中...' : '导出 MD'}
                    </button>
                </div>
            </div>
        </aside>
    );
}
