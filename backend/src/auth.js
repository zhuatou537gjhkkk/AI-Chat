import crypto from "crypto";

const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || "change-this-secret";
const TOKEN_EXPIRES_IN_SEC = Number(process.env.AUTH_TOKEN_EXPIRES_SEC || 60 * 60 * 24 * 7);

function base64urlEncode(input) {
    return Buffer.from(input)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function base64urlDecode(input) {
    const normalized = String(input || "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8");
}

function signPayload(payload) {
    return crypto
        .createHmac("sha256", TOKEN_SECRET)
        .update(payload)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
    return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password, encodedHash) {
    const value = String(encodedHash || "");

    if (!value.startsWith("scrypt:")) {
        return false;
    }

    const [, salt, hashHex] = value.split(":");
    if (!salt || !hashHex) {
        return false;
    }

    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(String(password || ""), salt, expected.length);

    return crypto.timingSafeEqual(expected, actual);
}

export function issueAuthToken(user) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: Number(user?.id),
        username: String(user?.username || ""),
        iat: now,
        exp: now + TOKEN_EXPIRES_IN_SEC,
    };

    const encodedPayload = base64urlEncode(JSON.stringify(payload));
    const signature = signPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token) {
    const [encodedPayload, signature] = String(token || "").split(".");
    if (!encodedPayload || !signature) {
        return null;
    }

    const expectedSignature = signPayload(encodedPayload);
    if (signature !== expectedSignature) {
        return null;
    }

    try {
        const payload = JSON.parse(base64urlDecode(encodedPayload));
        const now = Math.floor(Date.now() / 1000);

        if (!payload?.sub || !payload?.exp || payload.exp <= now) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

export function parseBearerToken(req) {
    const header = String(req.headers?.authorization || "");
    if (!header.startsWith("Bearer ")) {
        return "";
    }

    return header.slice(7).trim();
}
