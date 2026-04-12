import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function parseStructuredWebSearchContent(content) {
    const text = String(content || '').trim();
    if (!text.includes('标题:') || !text.includes('链接:')) {
        return null;
    }

    const lines = text.split('\n');
    const headerLine = lines[0].startsWith('已按时间窗口') || lines[0].startsWith('未找到')
        ? lines[0]
        : '';
    const dataText = headerLine ? lines.slice(1).join('\n').trim() : text;

    const blocks = dataText
        .split(/\n(?=时间: )/g)
        .map((block) => block.trim())
        .filter(Boolean);

    const items = blocks.map((block) => {
        const pick = (label) => {
            const line = block
                .split('\n')
                .find((itemLine) => itemLine.startsWith(`${label}: `));
            return line ? line.slice(label.length + 2).trim() : '';
        };

        return {
            time: pick('时间'),
            verification: pick('时间校验'),
            site: pick('来源'),
            title: pick('标题'),
            summary: pick('摘要'),
            link: pick('链接'),
            query: pick('检索词'),
        };
    }).filter((item) => item.title || item.link);

    if (items.length === 0) {
        return null;
    }

    return {
        header: headerLine,
        items,
    };
}

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
    const toolLogs = Array.isArray(message.toolLogs) ? message.toolLogs : [];
    const structuredSearchResult =
        message.role === 'assistant' ? parseStructuredWebSearchContent(message.content) : null;

    const renderToolLogs = () => {
        if (toolLogs.length === 0) {
            return null;
        }

        return (
            <div className="mb-2 rounded-md bg-gray-800 p-2 font-mono text-xs text-green-400">
                {toolLogs.map((log, index) => (
                    <div key={`${log.name}-${index}`} className="whitespace-pre-wrap break-words">
                        {`> 执行工具: ${log.name} ... ${log.status === 'running' ? '⏳' : '✅'}`}
                    </div>
                ))}
            </div>
        );
    };

    const renderStructuredSearchCards = () => {
        if (!structuredSearchResult) {
            return null;
        }

        return (
            <div className="space-y-3">
                {structuredSearchResult.header && (
                    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                        {structuredSearchResult.header}
                    </div>
                )}

                {structuredSearchResult.items.map((item, index) => {
                    const isVerified = item.verification === '已核验';
                    return (
                        <article
                            key={`${item.link || item.title}-${index}`}
                            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                        >
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">{item.time || '未知时间'}</span>
                                <span
                                    className={[
                                        'rounded px-2 py-0.5',
                                        isVerified
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-amber-100 text-amber-700',
                                    ].join(' ')}
                                >
                                    {item.verification || '待核验'}
                                </span>
                                <span className="rounded bg-violet-100 px-2 py-0.5 text-violet-700">{item.site || '未知来源'}</span>
                            </div>

                            <h4 className="mb-1 text-sm font-semibold text-slate-900">{item.title || '无标题'}</h4>
                            <p className="mb-2 whitespace-pre-wrap text-xs text-slate-700">{item.summary || '无摘要'}</p>

                            {item.link && item.link !== '无链接' ? (
                                <a
                                    href={item.link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                                >
                                    打开来源链接
                                </a>
                            ) : (
                                <span className="text-xs text-slate-500">无可用链接</span>
                            )}

                            {item.query && (
                                <p className="mt-2 text-[11px] text-slate-500">检索词: {item.query}</p>
                            )}
                        </article>
                    );
                })}
            </div>
        );
    };

    const renderAssistantContent = () => {
        if (structuredSearchResult) {
            return renderStructuredSearchCards();
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
                        {renderToolLogs()}
                        {renderAssistantContent()}
                    </div>
                )}
            </div>
        </div>
    );
}

export default memo(
    MessageItem,
    (prevProps, nextProps) => {
        const prevLogs = prevProps.message?.toolLogs || [];
        const nextLogs = nextProps.message?.toolLogs || [];

        return (
            prevProps.message?.id === nextProps.message?.id &&
            prevProps.message?.role === nextProps.message?.role &&
            prevProps.message?.content === nextProps.message?.content &&
            JSON.stringify(prevLogs) === JSON.stringify(nextLogs)
        );
    }
);
