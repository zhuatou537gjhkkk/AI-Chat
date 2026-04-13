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

                    <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="text-sm font-medium text-slate-700">🔊 自动语音播报</span>
                        <input
                            type="checkbox"
                            checked={isVoiceEnabled}
                            onChange={toggleVoice}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                    </label>

                    <label className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-700">语速</span>
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

                    <label className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-700">音量</span>
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

                    <label className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="mb-2 block text-sm font-medium text-slate-700">音色</span>
                        <select
                            value={voiceName}
                            onChange={(event) => setVoiceName(event.target.value)}
                            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        >
                            <option value="">系统默认（自动优先中文）</option>
                            {voices.map((voice) => (
                                <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                                    {`${voice.name} (${voice.lang || 'unknown'})`}
                                </option>
                            ))}
                        </select>
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
