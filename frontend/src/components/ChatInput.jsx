import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chatStore';
import { uploadFile } from '../api/chat';

export default function ChatInput() {
    const [value, setValue] = useState('');
    const [uploadStatus, setUploadStatus] = useState('');
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);
    const sendMessage = useChatStore((state) => state.sendMessage);
    const isTyping = useChatStore((state) => state.isTyping);

    useEffect(() => {
        const element = textareaRef.current;

        if (!element) {
            return;
        }

        element.style.height = 'auto';
        element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
    }, [value]);

    useEffect(() => {
        if (!uploadStatus) {
            return undefined;
        }

        const timer = setTimeout(() => {
            setUploadStatus('');
        }, 2400);

        return () => {
            clearTimeout(timer);
        };
    }, [uploadStatus]);

    const handleSend = async () => {
        const text = value.trim();

        if (!text || isTyping) {
            return;
        }

        setValue('');
        await sendMessage(text);
    };

    const handleKeyDown = async (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            await handleSend();
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event) => {
        const [file] = event.target.files || [];

        if (!file) {
            return;
        }

        try {
            setUploadStatus('上传中...');
            await uploadFile(file);
            setUploadStatus(`上传成功: ${file.name}`);
        } catch (error) {
            setUploadStatus(`上传失败: ${error.message || '请重试'}`);
        } finally {
            event.target.value = '';
        }
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 px-4 pb-4 pt-3 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="mx-auto max-w-4xl">
                {isTyping && (
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                        <span>AI 正在思考</span>
                        <span className="inline-flex items-center gap-1">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:0ms]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:120ms]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:240ms]" />
                        </span>
                    </div>
                )}

                {uploadStatus && (
                    <div className="mb-2 inline-flex max-w-full rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                        <span className="truncate">{uploadStatus}</span>
                    </div>
                )}

                <div className="flex items-end gap-3">
                    <button
                        type="button"
                        onClick={handleUploadClick}
                        className="h-11 w-11 shrink-0 rounded-xl border border-gray-300 bg-white text-base text-slate-700 transition hover:bg-slate-50"
                        title="上传 txt 或 md 文档"
                    >
                        📁
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.md"
                        className="hidden"
                        onChange={handleFileChange}
                    />

                    <textarea
                        ref={textareaRef}
                        className="min-h-12 max-h-40 flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        placeholder="请输入你的问题，Enter 发送，Shift+Enter 换行"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <button
                        type="button"
                        disabled={isTyping}
                        onClick={handleSend}
                        className="h-11 rounded-xl bg-blue-500 px-4 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                        {isTyping ? '思考中...' : '发送'}
                    </button>
                </div>
            </div>
        </div>
    );
}
