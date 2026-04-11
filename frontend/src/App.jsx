import { useEffect, useState } from 'react';
import ChatInput from './components/ChatInput';
import ChatList from './components/ChatList';
import Sidebar from './components/Sidebar';
import { useChatStore } from './store/chatStore';

export default function App() {
    const initSessions = useChatStore((state) => state.initSessions);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    useEffect(() => {
        initSessions();
    }, [initSessions]);

    return (
        <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900">
            <Sidebar className="hidden md:flex" />

            {sidebarOpen && (
                <div className="fixed inset-0 z-40 md:hidden">
                    <div
                        className="absolute inset-0 bg-black/45"
                        onClick={() => setSidebarOpen(false)}
                    />
                    <Sidebar
                        className="relative z-50 h-full"
                        onAfterSelect={() => setSidebarOpen(false)}
                    />
                </div>
            )}

            <section className="relative flex min-w-0 flex-1 flex-col">
                <header className="border-b border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
                    <div className="flex items-center gap-3 text-sm font-semibold tracking-wide text-slate-700">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(true)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 md:hidden"
                        >
                            会话
                        </button>
                        <span>AI Agent 极速版</span>
                    </div>
                </header>

                <main className="flex-1 overflow-hidden px-2 pb-2 pt-3 sm:px-4">
                    <ChatList />
                </main>

                <ChatInput />
            </section>
        </div>
    );
}
