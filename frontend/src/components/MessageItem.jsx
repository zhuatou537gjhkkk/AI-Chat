import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

let syntaxHighlighterCache = null;
let syntaxThemeCache = null;
let syntaxLoaderPromise = null;

async function loadSyntaxAssets() {
    if (syntaxHighlighterCache && syntaxThemeCache) {
        return {
            SyntaxHighlighter: syntaxHighlighterCache,
            theme: syntaxThemeCache,
        };
    }

    if (!syntaxLoaderPromise) {
        syntaxLoaderPromise = Promise.all([
            import('react-syntax-highlighter').then((mod) => mod.Prism),
            import('react-syntax-highlighter/dist/esm/styles/prism').then((mod) => mod.oneDark),
        ]).then(([SyntaxHighlighter, theme]) => {
            syntaxHighlighterCache = SyntaxHighlighter;
            syntaxThemeCache = theme;

            return {
                SyntaxHighlighter,
                theme,
            };
        });
    }

    return syntaxLoaderPromise;
}

function CodeRenderer({ inline, className, children, ...props }) {
    const [copied, setCopied] = useState(false);
    const [assets, setAssets] = useState(() => {
        if (syntaxHighlighterCache && syntaxThemeCache) {
            return {
                SyntaxHighlighter: syntaxHighlighterCache,
                theme: syntaxThemeCache,
            };
        }

        return null;
    });
    const match = /language-([a-zA-Z0-9-]+)/.exec(className || '');
    const language = match ? match[1] : 'text';
    const codeText = String(children).replace(/\n$/, '');

    if (inline) {
        return (
            <code
                className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800"
                {...props}
            >
                {children}
            </code>
        );
    }

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(codeText);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            setCopied(false);
        }
    };

    useEffect(() => {
        if (inline || assets) {
            return undefined;
        }

        let active = true;

        loadSyntaxAssets()
            .then((loaded) => {
                if (active) {
                    setAssets(loaded);
                }
            })
            .catch(() => {
                if (active) {
                    setAssets(null);
                }
            });

        return () => {
            active = false;
        };
    }, [inline, assets]);

    const SyntaxHighlighter = assets?.SyntaxHighlighter;
    const theme = assets?.theme;

    return (
        <div className="my-2 overflow-hidden rounded-xl border border-slate-700/70 bg-slate-900/95 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-3 py-2 text-xs text-slate-300">
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono uppercase tracking-wide text-slate-200">
                    {language}
                </span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="rounded border border-slate-600 px-2 py-0.5 text-[11px] font-medium text-slate-200 transition hover:bg-slate-800"
                >
                    {copied ? '已复制' : '复制代码'}
                </button>
            </div>
            <div className="overflow-x-auto">
                {SyntaxHighlighter && theme ? (
                    <SyntaxHighlighter
                        language={language}
                        style={theme}
                        PreTag="div"
                        customStyle={{
                            margin: 0,
                            background: 'transparent',
                            borderRadius: 0,
                            fontSize: '0.85rem',
                            lineHeight: 1.6,
                        }}
                        {...props}
                    >
                        {codeText}
                    </SyntaxHighlighter>
                ) : (
                    <pre className="m-0 overflow-x-auto p-3 font-mono text-[13px] leading-6 text-slate-200">
                        <code>{codeText}</code>
                    </pre>
                )}
            </div>
        </div>
    );
}

function MessageItem({ message }) {
    const isUser = message.role === 'user';
    const isAssistantThinking = message.role === 'assistant' && message.content === '';

    const renderAssistantContent = () => {
        if (isAssistantThinking) {
            return (
                <div className="flex items-center gap-2 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full bg-sky-500 animate-pulse" />
                    <span className="animate-pulse">🧠 Agent 正在思考与检索...</span>
                </div>
            );
        }

        return (
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code: CodeRenderer,
                    table({ children }) {
                        return (
                            <div className="my-3 overflow-x-auto rounded-lg border border-slate-300 bg-white/80">
                                <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
                                    {children}
                                </table>
                            </div>
                        );
                    },
                    thead({ children }) {
                        return <thead className="bg-slate-100/90">{children}</thead>;
                    },
                    tr({ children }) {
                        return <tr className="border-t border-slate-300">{children}</tr>;
                    },
                    th({ children }) {
                        return (
                            <th className="whitespace-nowrap border border-slate-300 px-3 py-2 font-semibold text-slate-700">
                                {children}
                            </th>
                        );
                    },
                    td({ children }) {
                        return (
                            <td className="border border-slate-300 px-3 py-2 align-top text-slate-700">
                                {children}
                            </td>
                        );
                    },
                }}
            >
                {message.content}
            </ReactMarkdown>
        );
    };

    return (
        <div className={`flex w-full px-3 py-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
                className={[
                    'max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-6 shadow-sm',
                    isUser ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800',
                ].join(' ')}
            >
                {isUser ? (
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                ) : (
                    <div className="break-words [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-6">
                        {renderAssistantContent()}
                    </div>
                )}
            </div>
        </div>
    );
}

export default memo(
    MessageItem,
    (prevProps, nextProps) =>
        prevProps.message?.id === nextProps.message?.id &&
        prevProps.message?.role === nextProps.message?.role &&
        prevProps.message?.content === nextProps.message?.content
);
