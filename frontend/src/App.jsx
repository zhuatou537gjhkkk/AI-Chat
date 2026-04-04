import ChatInput from './components/ChatInput';
import ChatList from './components/ChatList';

export default function App() {
    return (
        <div className="h-screen flex flex-col bg-slate-50 text-slate-900">
            <header className="border-b border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
                <div className="mx-auto max-w-4xl text-sm font-semibold tracking-wide text-slate-700">
                    AI Agent 极速版
                </div>
            </header>

            <main className="mx-auto flex w-full max-w-4xl flex-1 overflow-hidden px-2 pb-28 pt-3 sm:px-4">
                <ChatList />
            </main>

            <ChatInput />
        </div>
    );
}
