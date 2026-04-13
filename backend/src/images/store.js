import crypto from "crypto";

const TTL_MS = 30 * 60 * 1000;
const imageStore = new Map();

function makeDataUrl(buffer, mimeType) {
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${mimeType};base64,${base64}`;
}

function cleanupExpired() {
    const now = Date.now();

    for (const [id, item] of imageStore.entries()) {
        if (now - item.createdAt > TTL_MS) {
            imageStore.delete(id);
        }
    }
}

export function saveUploadedImage(buffer, mimeType) {
    cleanupExpired();

    const id = crypto.randomUUID();
    imageStore.set(id, {
        createdAt: Date.now(),
        dataUrl: makeDataUrl(buffer, mimeType),
    });

    return id;
}

export function getUploadedImageDataUrl(id) {
    if (!id) {
        return null;
    }

    cleanupExpired();

    const item = imageStore.get(id);
    if (!item) {
        return null;
    }

    return item.dataUrl;
}
