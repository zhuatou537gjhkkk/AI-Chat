export default function MessageItem({ message }) {
    const isUser = message.role === 'user';

    return (
        <div className={`flex w-full px-3 py-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
                className={[
                    'max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-6 shadow-sm',
                    isUser ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800',
                ].join(' ')}
            >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
            </div>
        </div>
    );
}
