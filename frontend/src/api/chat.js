const BASE_URL = 'http://localhost:3000';

export async function fetchSessions() {
    const response = await fetch(`${BASE_URL}/sessions`);

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data?.sessions || [];
}

export async function createSession(title) {
    const response = await fetch(`${BASE_URL}/sessions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
    });

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data?.id;
}

export async function updateSessionTitle(id, title) {
    const response = await fetch(`${BASE_URL}/sessions/${id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
    });

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
}

export async function deleteSession(id) {
    const response = await fetch(`${BASE_URL}/sessions/${id}`, {
        method: 'DELETE',
    });

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
}

export async function fetchMessagesBySession(id) {
    const response = await fetch(`${BASE_URL}/sessions/${id}/messages`);

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data?.messages || [];
}

export async function fetchChatStream(sessionId, message, onChunk, onToolEvent, onDone, onError, options = {}) {
    const {
        signal,
        enableWebSearch = true,
        systemPrompt = '你是一个有用的 AI 助手。',
        temperature = 0.7,
    } = options;

    try {
        const response = await fetch(`${BASE_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            signal,
            body: JSON.stringify({
                session_id: sessionId,
                message,
                enable_web_search: enableWebSearch,
                systemPrompt,
                temperature,
            }),
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
                        const eventType = parsed?.type;

                        if (!eventType || eventType === 'text') {
                            const text = parsed && typeof parsed.text === 'string' ? parsed.text : '';

                            if (text) {
                                onChunk(text);
                            }
                            continue;
                        }

                        if (eventType === 'tool_start' || eventType === 'tool_end') {
                            onToolEvent(parsed);
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

export async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        let message = 'Upload failed';

        try {
            const data = await response.json();
            message = data?.message || message;
        } catch (error) {
            // Ignore JSON parsing errors and throw default message.
        }

        throw new Error(message);
    }

    return response.json();
}
