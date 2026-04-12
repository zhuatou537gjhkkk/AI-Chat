import { useChatStore } from '../store/chatStore';

export default function SettingsModal() {
    const isSettingsOpen = useChatStore((state) => state.isSettingsOpen);
    const systemPrompt = useChatStore((state) => state.systemPrompt);
    const temperature = useChatStore((state) => state.temperature);
    const setSystemPrompt = useChatStore((state) => state.setSystemPrompt);
    const setTemperature = useChatStore((state) => state.setTemperature);
    const resetCurrentSessionSettings = useChatStore((state) => state.resetCurrentSessionSettings);
    const toggleSettings = useChatStore((state) => state.toggleSettings);

    if (!isSettingsOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
                <h2 className="text-xl font-semibold text-slate-900">⚙️ Agent 设定</h2>
                <p className="mt-1 text-xs text-slate-500">当前会话独立保存此处配置，切换会话不会互相影响。</p>

                <div className="mt-5 space-y-4">
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-700">System Prompt</span>
                        <textarea
                            value={systemPrompt}
                            onChange={(event) => setSystemPrompt(event.target.value)}
                            rows={6}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                            placeholder="请输入系统提示词"
                        />
                    </label>

                    <label className="block">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-700">Temperature</span>
                            <span className="text-sm font-semibold text-blue-600">{Number(temperature).toFixed(1)}</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={temperature}
                            onChange={(event) => setTemperature(Number(event.target.value))}
                            className="w-full accent-blue-600"
                        />
                    </label>
                </div>

                <div className="mt-6 flex justify-between">
                    <button
                        type="button"
                        onClick={resetCurrentSessionSettings}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                        恢复默认
                    </button>
                    <button
                        type="button"
                        onClick={toggleSettings}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                    >
                        保存并关闭
                    </button>
                </div>
            </div>
        </div>
    );
}
