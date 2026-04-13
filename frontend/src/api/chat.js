const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').trim();
const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS) || 30000;
const DEFAULT_RETRY_COUNT = 1;

function shouldRetryStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504;
}

async function parseResponseError(response) {
    let message = `Request failed with status ${response.status}`;

    try {
        const data = await response.clone().json();
        if (data?.message) {
            message = data.message;
        } else if (data?.error) {
            message = data.error;
        }
    } catch {
        try {
            const text = await response.clone().text();
            if (text) {
                message = text;
            }
        } catch {
            // Ignore text parsing errors and keep default message.
        }
    }

    return message;
}

function createRequestController(externalSignal, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort(new Error('Request timeout'));
    }, timeoutMs);

    const abortFromExternal = () => {
        controller.abort(externalSignal?.reason || new Error('Request aborted'));
    };

    if (externalSignal) {
        if (externalSignal.aborted) {
            abortFromExternal();
        } else {
            externalSignal.addEventListener('abort', abortFromExternal, { once: true });
        }
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeout);
            if (externalSignal) {
                externalSignal.removeEventListener('abort', abortFromExternal);
            }
        },
    };
}

async function request(path, options = {}, config = {}) {
    const {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        retryCount = DEFAULT_RETRY_COUNT,
        externalSignal,
    } = config;

    const method = options.method || 'GET';

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        const { signal, cleanup } = createRequestController(externalSignal, timeoutMs);

        try {
            const response = await fetch(`${BASE_URL}${path}`, {
                ...options,
                signal,
            });

            if (!response.ok) {
                const message = await parseResponseError(response);

                if (attempt < retryCount && shouldRetryStatus(response.status)) {
                    continue;
                }

                throw new Error(message);
            }

            return response;
        } catch (error) {
            const isAbort = error?.name === 'AbortError';
            if (isAbort || externalSignal?.aborted) {
                throw error;
            }

            if (attempt >= retryCount) {
                throw error;
            }

            if (error instanceof Error && /Request failed with status/.test(error.message)) {
                throw error;
            }
        } finally {
            cleanup();
        }
    }

    throw new Error(`${method} request failed`);
}

export async function fetchSessions() {
    const response = await request('/sessions');
    const data = await response.json();
    return data?.sessions || [];
}

export async function createSession(title) {
    const response = await request('/sessions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
    });

    const data = await response.json();
    return data?.id;
}

export async function updateSessionTitle(id, title) {
    const response = await request(`/sessions/${id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
    });

    return response.json();
}

export async function deleteSession(id) {
    const response = await request(`/sessions/${id}`, {
        method: 'DELETE',
    });

    return response.json();
}

export async function updateSessionPin(id, pinned) {
    const response = await request(`/sessions/${id}/pin`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pinned }),
    });

    return response.json();
}

export async function fetchMessagesBySession(id) {
    const response = await request(`/sessions/${id}/messages`);
    const data = await response.json();
    return data?.messages || [];
}

export async function fetchChatStream(sessionId, message, onChunk, onToolEvent, onDone, onError, options = {}) {
    const {
        signal,
        enableWebSearch = false,
        systemPrompt = '你是一个有用的 AI 助手。',
        temperature = 0.7,
        image = null,
        imageId = null,
    } = options;

    try {
        const response = await request(
            '/chat',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: sessionId,
                    message,
                    image,
                    image_id: imageId,
                    enable_web_search: enableWebSearch,
                    systemPrompt,
                    temperature,
                }),
            },
            {
                externalSignal: signal,
                retryCount: DEFAULT_RETRY_COUNT,
            }
        );

        if (!response.body) {
            throw new Error('Response body is empty');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        const handlePayload = (payload) => {
            if (!payload || payload === '[DONE]') {
                return;
            }

            try {
                const parsed = JSON.parse(payload);
                const eventType = parsed?.type;

                if (!eventType || eventType === 'text') {
                    const text = parsed && typeof parsed.text === 'string' ? parsed.text : '';

                    if (text) {
                        onChunk(text);
                    }
                    return;
                }

                if (eventType === 'tool_start' || eventType === 'tool_end' || eventType === 'thought') {
                    onToolEvent(parsed);
                }
            } catch {
                // Ignore malformed chunk and continue streaming.
            }
        };

        const consumeBuffer = (isDone = false) => {
            const separator = isDone ? /\n\n+/ : /\n\n/;
            const parts = buffer.split(separator);

            if (!isDone) {
                buffer = parts.pop() || '';
            } else {
                buffer = '';
            }

            for (const part of parts) {
                const lines = part.split('\n');

                for (const line of lines) {
                    if (!line.startsWith('data: ')) {
                        continue;
                    }

                    handlePayload(line.slice(6));
                }
            }
        };

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                consumeBuffer(true);
                onDone();
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            consumeBuffer(false);
        }
    } catch (error) {
        if (error instanceof Error && /413/.test(error.message)) {
            onError(new Error('图片过大，请压缩后重试。'));
            return;
        }

        onError(error);
    }
}

export async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await request('/upload', {
        method: 'POST',
        body: formData,
    });

    return response.json();
}

export async function uploadImage(file, options = {}) {
    const {
        onProgress,
        signal,
        retryCount = DEFAULT_RETRY_COUNT,
        timeoutMs = DEFAULT_TIMEOUT_MS,
    } = options;

    const formData = new FormData();
    formData.append('image', file);

    const sendWithXhr = () => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${BASE_URL}/upload-image`, true);
        xhr.responseType = 'json';
        xhr.timeout = timeoutMs;

        const abortFromSignal = () => {
            xhr.abort();
        };

        const cleanup = () => {
            if (signal) {
                signal.removeEventListener('abort', abortFromSignal);
            }
        };

        if (signal) {
            if (signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            signal.addEventListener('abort', abortFromSignal, { once: true });
        }

        xhr.upload.onprogress = (event) => {
            if (typeof onProgress === 'function') {
                onProgress(event);
            }
        };

        xhr.onerror = () => {
            cleanup();
            reject(new Error('Image upload failed'));
        };

        xhr.ontimeout = () => {
            cleanup();
            reject(new Error('Image upload timeout'));
        };

        xhr.onabort = () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
        };

        xhr.onload = async () => {
            cleanup();

            const status = xhr.status;
            const data = xhr.response;

            if (status >= 200 && status < 300) {
                resolve(data || {});
                return;
            }

            const message = data?.message || data?.error || `Request failed with status ${status}`;
            reject(new Error(message));
        };

        xhr.send(formData);
    });

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
            return await sendWithXhr();
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw error;
            }

            if (attempt >= retryCount) {
                throw error;
            }
        }
    }

    throw new Error('Image upload failed');
}
