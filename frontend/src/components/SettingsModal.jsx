import { useEffect, useState } from 'react';
import { useChatStore } from '../store/chatStore';

export default function SettingsModal() {
    const isSettingsOpen = useChatStore((state) => state.isSettingsOpen);
    const systemPrompt = useChatStore((state) => state.systemPrompt);
    const temperature = useChatStore((state) => state.temperature);
    const setSystemPrompt = useChatStore((state) => state.setSystemPrompt);
    const setTemperature = useChatStore((state) => state.setTemperature);
    const isVoiceEnabled = useChatStore((state) => state.isVoiceEnabled);
    const toggleVoice = useChatStore((state) => state.toggleVoice);
    const voiceRate = useChatStore((state) => state.voiceRate);
    const setVoiceRate = useChatStore((state) => state.setVoiceRate);
    const voiceVolume = useChatStore((state) => state.voiceVolume);
    const setVoiceVolume = useChatStore((state) => state.setVoiceVolume);
    const voiceName = useChatStore((state) => state.voiceName);
    const setVoiceName = useChatStore((state) => state.setVoiceName);
    const themeMode = useChatStore((state) => state.themeMode);
    const setThemeMode = useChatStore((state) => state.setThemeMode);
    const resetCurrentSessionSettings = useChatStore((state) => state.resetCurrentSessionSettings);
    const toggleSettings = useChatStore((state) => state.toggleSettings);
    const [voices, setVoices] = useState([]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            return undefined;
        }

        const updateVoices = () => {
            const list = window.speechSynthesis.getVoices() || [];
            setVoices(list);
        };

        updateVoices();
        window.speechSynthesis.addEventListener('voiceschanged', updateVoices);

        return () => {
            window.speechSynthesis.removeEventListener('voiceschanged', updateVoices);
        };
    }, []);

    if (!isSettingsOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-2xl sm:p-6">
                <h2 className="text-xl font-semibold text-[var(--text-main)]">Agent 设定</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">当前会话独立保存此处配置，切换会话不会互相影响。</p>

                <div className="mt-5 space-y-4">
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[var(--text-main)]">System Prompt</span>
                        <textarea
                            value={systemPrompt}
                            onChange={(event) => setSystemPrompt(event.target.value)}
                            rows={6}
                            className="w-full rounded-xl border border-[var(--panel-border)] bg-[var(--panel-soft)] px-3 py-2 text-sm text-[var(--text-main)] outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                            placeholder="请输入系统提示词"
                        />
                    </label>

                    <label className="block">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-[var(--text-main)]">Temperature</span>
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

                    <label className="flex items-center justify-between rounded-xl border border-[var(--panel-border)] bg-[var(--panel-soft)] px-3 py-2">
                        <span className="text-sm font-medium text-[var(--text-main)]">自动语音播报</span>
                        <input
                            type="checkbox"
                            checked={isVoiceEnabled}
                            onChange={toggleVoice}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                    </label>

                    <label className="block rounded-xl border border-[var(--panel-border)] bg-[var(--panel-soft)] px-3 py-2">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-[var(--text-main)]">语速</span>
                            <span className="text-sm font-semibold text-blue-600">{Number(voiceRate).toFixed(1)}</span>
                        </div>
                        <input
                            type="range"
                            min="0.5"
                            max="2"
                            step="0.1"
                            value={voiceRate}
                            onChange={(event) => setVoiceRate(Number(event.target.value))}
                            className="w-full accent-blue-600"
                        />
                    </label>

                    <label className="block rounded-xl border border-[var(--panel-border)] bg-[var(--panel-soft)] px-3 py-2">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-[var(--text-main)]">音量</span>
                            <span className="text-sm font-semibold text-blue-600">{Math.round(Number(voiceVolume) * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={voiceVolume}
                            onChange={(event) => setVoiceVolume(Number(event.target.value))}
                            className="w-full accent-blue-600"
                        />
                    </label>

                    <label className="block rounded-xl border border-[var(--panel-border)] bg-[var(--panel-soft)] px-3 py-2">
                        <span className="mb-2 block text-sm font-medium text-[var(--text-main)]">音色</span>
                        <select
                            value={voiceName}
                            onChange={(event) => setVoiceName(event.target.value)}
                            className="w-full rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1.5 text-sm text-[var(--text-main)] outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                        >
                            <option value="">系统默认（自动优先中文）</option>
                            {voices.map((voice) => (
                                <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                                    {`${voice.name} (${voice.lang || 'unknown'})`}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block rounded-xl border border-[var(--panel-border)] bg-[var(--panel-soft)] px-3 py-2">
                        <span className="mb-2 block text-sm font-medium text-[var(--text-main)]">主题模式</span>
                        <select
                            value={themeMode}
                            onChange={(event) => setThemeMode(event.target.value)}
                            className="w-full rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1.5 text-sm text-[var(--text-main)] outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                        >
                            <option value="system">跟随系统</option>
                            <option value="light">浅色</option>
                            <option value="dark">深色</option>
                        </select>
                    </label>
                </div>

                <div className="mt-6 flex justify-between">
                    <button
                        type="button"
                        onClick={resetCurrentSessionSettings}
                        className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-medium text-[var(--text-main)] transition hover:opacity-95"
                    >
                        恢复默认
                    </button>
                    <button
                        type="button"
                        onClick={toggleSettings}
                        className="rounded-xl bg-[#111827] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0b1220]"
                    >
                        保存并关闭
                    </button>
                </div>
            </div>
        </div>
    );
}
