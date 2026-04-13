import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import { useChatStore } from '../store/chatStore';
import MessageItem from './MessageItem';

const MIN_ITEM_HEIGHT = 68;
const ESTIMATED_ITEM_HEIGHT = 88;

function Row({ index, style, data }) {
    const { messages, setSize } = data;
    const message = messages[index];
    const rowRef = useRef(null);

    useLayoutEffect(() => {
        if (!rowRef.current) {
            return undefined;
        }

        const measure = () => {
            if (!rowRef.current) {
                return;
            }

            const measuredHeight = Math.max(
                MIN_ITEM_HEIGHT,
                Math.ceil(rowRef.current.getBoundingClientRect().height)
            );
            setSize(index, measuredHeight);
        };

        measure();

        const observer = new ResizeObserver(measure);
        observer.observe(rowRef.current);

        return () => {
            observer.disconnect();
        };
    }, [index, message?.content, setSize]);

    return (
        <div style={style}>
            <div ref={rowRef} className="mx-auto w-full max-w-4xl px-1 sm:px-3">
                <MessageItem message={message} />
            </div>
        </div>
    );
}

export default function ChatList() {
    const messages = useChatStore((state) => state.messages);
    const isSessionLoading = useChatStore((state) => state.isSessionLoading);
    const currentSessionId = useChatStore((state) => state.currentSessionId);
    const listRef = useRef(null);
    const containerRef = useRef(null);
    const outerRef = useRef(null);
    const sizeMapRef = useRef({});
    const hasInitializedScrollRef = useRef(false);
    const isNearBottomRef = useRef(true);
    const [listHeight, setListHeight] = useState(0);
    const [showBackToBottom, setShowBackToBottom] = useState(false);

    const scrollOuterToBottom = (behavior = 'smooth') => {
        if (!outerRef.current) {
            return;
        }

        outerRef.current.scrollTo({
            top: outerRef.current.scrollHeight,
            behavior,
        });
    };

    const updateNearBottom = () => {
        const outer = outerRef.current;

        if (!outer) {
            return;
        }

        const distanceToBottom = outer.scrollHeight - outer.scrollTop - outer.clientHeight;
        isNearBottomRef.current = distanceToBottom < 120;
        setShowBackToBottom(distanceToBottom > 220);
    };

    const scrollToBottom = () => {
        if (!outerRef.current) {
            return;
        }

        scrollOuterToBottom('smooth');
        isNearBottomRef.current = true;
        setShowBackToBottom(false);
    };

    useEffect(() => {
        const element = containerRef.current;

        if (!element) {
            return undefined;
        }

        const updateHeight = () => {
            setListHeight(element.clientHeight);
        };

        updateHeight();

        const observer = new ResizeObserver(updateHeight);
        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, []);

    useEffect(() => {
        if (!listRef.current || messages.length === 0) {
            return;
        }

        if (!hasInitializedScrollRef.current) {
            listRef.current.scrollToItem(messages.length - 1, 'end');
            hasInitializedScrollRef.current = true;
            updateNearBottom();
            return;
        }

        if (isNearBottomRef.current && outerRef.current) {
            scrollOuterToBottom('smooth');
        }
    }, [messages]);

    useEffect(() => {
        sizeMapRef.current = {};
        hasInitializedScrollRef.current = false;
    }, [currentSessionId]);

    const setSize = (index, size) => {
        const prev = sizeMapRef.current[index];

        if (prev === size) {
            return;
        }

        sizeMapRef.current[index] = size;
        if (listRef.current) {
            listRef.current.resetAfterIndex(index);

            if (isNearBottomRef.current) {
                requestAnimationFrame(() => {
                    scrollOuterToBottom('smooth');
                });
            }
        }
    };

    const getItemSize = (index) => sizeMapRef.current[index] || ESTIMATED_ITEM_HEIGHT;

    useEffect(() => {
        const outer = outerRef.current;

        if (!outer) {
            return undefined;
        }

        updateNearBottom();
        outer.addEventListener('scroll', updateNearBottom, { passive: true });

        return () => {
            outer.removeEventListener('scroll', updateNearBottom);
        };
    }, [listHeight]);

    return (
        <div ref={containerRef} className="relative h-full w-full overflow-hidden">
            {isSessionLoading && (
                <div className="absolute inset-0 z-10 space-y-3 bg-[var(--app-bg)]/90 px-6 py-5 backdrop-blur-[2px]">
                    {[1, 2, 3, 4].map((item) => (
                        <div
                            key={item}
                            className="mx-auto h-12 w-full max-w-4xl animate-pulse rounded-2xl bg-[var(--panel-soft)]"
                        />
                    ))}
                </div>
            )}

            {listHeight > 0 && (
                <List
                    ref={listRef}
                    outerRef={outerRef}
                    height={listHeight}
                    width="100%"
                    itemCount={messages.length}
                    itemSize={getItemSize}
                    itemData={{ messages, setSize }}
                    itemKey={(index, data) => data.messages[index].id}
                    overscanCount={5}
                >
                    {Row}
                </List>
            )}

            {showBackToBottom && (
                <button
                    type="button"
                    onClick={scrollToBottom}
                    className="absolute bottom-4 right-4 z-20 rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-main)] shadow-md transition hover:opacity-95"
                >
                    回到底部
                </button>
            )}
        </div>
    );
}
