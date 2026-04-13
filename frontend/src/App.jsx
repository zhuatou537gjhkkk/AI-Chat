import { useEffect, useState } from 'react';
import ChatInput from './components/ChatInput';
import ChatList from './components/ChatList';
import SettingsModal from './components/SettingsModal';
import Sidebar from './components/Sidebar';
import { useChatStore } from './store/chatStore';

export default function App() {
    const initSessions = useChatStore((state) => state.initSessions);
    const themeMode = useChatStore((state) => state.themeMode);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    useEffect(() => {
        initSessions();
    }, [initSessions]);

    useEffect(() => {
        const root = document.documentElement;
        const media = window.matchMedia('(prefers-color-scheme: dark)');

        const applyTheme = () => {
            const resolved = themeMode === 'system'
                ? (media.matches ? 'dark' : 'light')
                : themeMode;

            root.classList.toggle('dark', resolved === 'dark');
        };

        applyTheme();
        media.addEventListener('change', applyTheme);

        return () => {
            media.removeEventListener('change', applyTheme);
        };
    }, [themeMode]);

    return (
        <div className="flex h-screen overflow-hidden bg-[var(--app-bg)] text-[var(--text-main)] transition-colors">
            <SettingsModal />
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
                <header className="border-b border-[var(--panel-border)] bg-[var(--app-bg)]/90 px-3 py-3 backdrop-blur sm:px-6">
                    <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 text-sm">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(true)}
                            className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] shadow-sm md:hidden"
                        >
                            会话
                        </button>
                        <span className="font-semibold tracking-wide text-[var(--brand)]">AI Agent 极速版</span>
                        <span className="hidden text-xs text-[var(--text-muted)] sm:inline">模型随时在线</span>
                    </div>
                </header>

                <main className="flex-1 overflow-hidden px-2 pb-3 pt-4 sm:px-6">
                    <ChatList />
                </main>

                <ChatInput />
            </section>
        </div>
    );
}
