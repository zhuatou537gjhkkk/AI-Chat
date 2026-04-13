import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chatStore';
import { uploadFile, uploadImage } from '../api/chat';

const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

export default function ChatInput() {
    const [value, setValue] = useState('');
    const [uploadStatus, setUploadStatus] = useState('');
    const [isListening, setIsListening] = useState(false);
    const textareaRef = useRef(null);
    const docFileInputRef = useRef(null);
    const imageFileInputRef = useRef(null);
    const recognitionRef = useRef(null);
    const previewUrlRef = useRef(null);
    const sendMessage = useChatStore((state) => state.sendMessage);
    const enableWebSearch = useChatStore((state) => state.enableWebSearch);
    const setEnableWebSearch = useChatStore((state) => state.setEnableWebSearch);
    const selectedImage = useChatStore((state) => state.selectedImage);
    const setSelectedImage = useChatStore((state) => state.setSelectedImage);
    const clearSelectedImage = useChatStore((state) => state.clearSelectedImage);
    const isTyping = useChatStore((state) => state.isTyping);
    const stopMessageStream = useChatStore((state) => state.stopMessageStream);
    const retryLastFailedMessage = useChatStore((state) => state.retryLastFailedMessage);
    const lastFailedUserMessage = useChatStore((state) => state.lastFailedUserMessage);

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

    useEffect(() => {
        const currentPreviewUrl = selectedImage?.previewUrl || null;

        if (previewUrlRef.current && previewUrlRef.current !== currentPreviewUrl) {
            URL.revokeObjectURL(previewUrlRef.current);
        }

        previewUrlRef.current = currentPreviewUrl;
    }, [selectedImage]);

    useEffect(() => () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }

        const previewUrl = previewUrlRef.current;
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
    }, []);

    const handleSend = async () => {
        const text = value.trim();
        const hasImage = Boolean(selectedImage?.imageId);

        if ((!text && !hasImage) || isTyping) {
            return;
        }

        setValue('');
        await sendMessage(text || '请帮我描述这张图片。', { enableWebSearch });
    };

    const handleKeyDown = async (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            await handleSend();
        }
    };

    const handleUploadClick = () => {
        docFileInputRef.current?.click();
    };

    const handleImageUploadClick = () => {
        imageFileInputRef.current?.click();
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

    const handleClearImage = () => {
        const previewUrl = selectedImage?.previewUrl;
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }

        previewUrlRef.current = null;

        clearSelectedImage();
    };

    const handleImageChange = async (event) => {
        const [file] = event.target.files || [];

        if (!file) {
            return;
        }

        try {
            if (!String(file.type || '').startsWith('image/')) {
                setUploadStatus('请选择图片文件。');
                return;
            }

            if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
                setUploadStatus('图片过大，请选择 8MB 以内的图片。');
                return;
            }

            setUploadStatus('正在上传图片...');
            const previousPreviewUrl = selectedImage?.previewUrl;
            if (previousPreviewUrl) {
                URL.revokeObjectURL(previousPreviewUrl);
            }

            const uploaded = await uploadImage(file);
            const imageId = uploaded?.id;

            if (!imageId) {
                setUploadStatus('图片上传失败，请重试。');
                return;
            }

            const previewUrl = URL.createObjectURL(file);
            previewUrlRef.current = previewUrl;
            setSelectedImage({
                imageId,
                previewUrl,
                fileName: file.name,
            });
            setUploadStatus(`已选择图片: ${file.name}`);
        } catch (error) {
            setUploadStatus(`图片处理失败: ${error.message || '请重试'}`);
        } finally {
            event.target.value = '';
        }
    };

    const handleVoiceInput = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            setUploadStatus('当前浏览器不支持原生语音识别。');
            return;
        }

        if (isListening && recognitionRef.current) {
            recognitionRef.current.stop();
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => {
            setIsListening(true);
        };

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results || [])
                .map((result) => result?.[0]?.transcript || '')
                .join('')
                .trim();

            if (!transcript) {
                return;
            }

            setValue((prev) => (prev ? `${prev}${transcript}` : transcript));
        };

        recognition.onerror = () => {
            setUploadStatus('语音识别失败，请重试。');
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;
        recognition.start();
    };

    return (
        <div className="border-t border-gray-200 bg-white/95 px-4 pb-4 pt-3 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur">
            <div>
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

                {!isTyping && lastFailedUserMessage && (
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">
                        <span>上次发送失败</span>
                        <button
                            type="button"
                            onClick={retryLastFailedMessage}
                            className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-200"
                        >
                            立即重试
                        </button>
                    </div>
                )}

                {uploadStatus && (
                    <div className="mb-2 inline-flex max-w-full rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                        <span className="truncate">{uploadStatus}</span>
                    </div>
                )}

                {selectedImage && (
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <img
                            src={selectedImage.previewUrl}
                            alt="已选择图片"
                            className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                        />
                        <button
                            type="button"
                            onClick={handleClearImage}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-100"
                        >
                            X
                        </button>
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
                        ref={docFileInputRef}
                        type="file"
                        accept=".txt,.md"
                        className="hidden"
                        onChange={handleFileChange}
                    />

                    <button
                        type="button"
                        onClick={handleImageUploadClick}
                        className="h-11 w-11 shrink-0 rounded-xl border border-gray-300 bg-white text-base text-slate-700 transition hover:bg-slate-50"
                        title="上传图片"
                    >
                        🖼️
                    </button>
                    <input
                        ref={imageFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageChange}
                    />

                    <button
                        type="button"
                        onClick={handleVoiceInput}
                        className={`h-11 w-11 shrink-0 rounded-xl border border-gray-300 bg-white text-base text-slate-700 transition hover:bg-slate-50 ${isListening ? 'animate-pulse text-red-500' : ''}`}
                        title="语音输入"
                    >
                        🎤
                    </button>

                    <textarea
                        ref={textareaRef}
                        className="min-h-12 max-h-40 flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        placeholder="请输入你的问题，Enter 发送，Shift+Enter 换行"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <div className="flex items-center">
                        <button
                            type="button"
                            onClick={() => setEnableWebSearch(!enableWebSearch)}
                            className={`h-11 rounded-xl border px-3 text-xs font-medium transition outline-none ${enableWebSearch
                                ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                : 'border-gray-300 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                            title="是否启用联网搜索"
                        >
                            联网: {enableWebSearch ? '开' : '关'}
                        </button>
                    </div>
                    <button
                        type="button"
                        disabled={isTyping}
                        onClick={handleSend}
                        className="h-11 rounded-xl bg-blue-500 px-4 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                        {isTyping ? '思考中...' : '发送'}
                    </button>

                    {isTyping && (
                        <button
                            type="button"
                            onClick={stopMessageStream}
                            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                            停止
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
