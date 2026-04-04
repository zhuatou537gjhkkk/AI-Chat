export async function fetchChatStream(message, onChunk, onDone, onError) {
    try {
        const response = await fetch('http://localhost:3000/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        if (!response.body) {
            throw new Error('Response body is empty');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                onDone();
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';

            for (const part of parts) {
                const lines = part.split('\n');

                for (const line of lines) {
                    if (!line.startsWith('data: ')) {
                        continue;
                    }

                    if (line === 'data: [DONE]') {
                        continue;
                    }

                    const payload = line.slice(6);

                    try {
                        const parsed = JSON.parse(payload);
                        const text = parsed && typeof parsed.text === 'string' ? parsed.text : '';

                        if (text) {
                            onChunk(text);
                        }
                    } catch (parseError) {
                        // Ignore malformed chunk and continue streaming.
                    }
                }
            }
        }
    } catch (error) {
        onError(error);
    }
}
