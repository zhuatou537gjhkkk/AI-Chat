import fs from "fs";
import multer from "multer";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { FaissStore } from "@langchain/community/vectorstores/faiss";

let vectorStore = null;
const knowledgeChunks = [];
const knowledgeMetadatas = [];
const indexedFiles = new Set();
const DEFAULT_TOP_K = 5;
const DEFAULT_RETURN_K = 3;
const DEFAULT_MAX_SCORE = Number(
    process.env.RAG_MAX_SCORE ?? Number.POSITIVE_INFINITY
);

const upload = multer({
    storage: multer.memoryStorage()
});

const embeddings = new OpenAIEmbeddings({
    modelName: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-v1",
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-v1",
    configuration: {
        apiKey: process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || process.env.DASHSCOPE_BASE_URL
    }
});

export const uploadMiddleware = upload.single("file");

export async function processAndStoreDocument(fileBuffer, fileName) {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
        throw new Error("invalid file buffer");
    }

    const text = fileBuffer.toString("utf-8").trim();

    if (!text) {
        throw new Error("empty document");
    }

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 50
    });

    const chunks = await splitter.splitText(text);

    if (chunks.length === 0) {
        throw new Error("document cannot be split into valid chunks");
    }

    const metadata = chunks.map(() => ({
        source: fileName,
        uploadedAt: new Date().toISOString(),
        cwdExists: fs.existsSync(process.cwd())
    }));

    knowledgeChunks.push(...chunks);
    knowledgeMetadatas.push(...metadata);
    indexedFiles.add(fileName);

    // Rebuild the FAISS index from all accumulated chunks so uploads are incremental.
    vectorStore = await FaissStore.fromTexts(
        knowledgeChunks,
        knowledgeMetadatas,
        embeddings
    );

    return {
        fileName,
        chunkCount: chunks.length,
        totalChunks: knowledgeChunks.length,
        totalFiles: indexedFiles.size
    };
}

export async function queryKnowledgeBase(query) {
    const evidence = await retrieveKnowledgeEvidence(query);

    if (evidence.status === "empty") {
        return "当前知识库为空";
    }

    if (evidence.status === "no_match") {
        return "未检索到相关知识片段";
    }

    return JSON.stringify({
        status: "ok",
        items: evidence.items
    });
}

export async function retrieveKnowledgeEvidence(
    query,
    options = {}
) {
    if (!vectorStore) {
        return {
            status: "empty",
            items: []
        };
    }

    const topK = options.topK ?? DEFAULT_TOP_K;
    const returnK = options.returnK ?? DEFAULT_RETURN_K;
    const maxScore = options.maxScore ?? DEFAULT_MAX_SCORE;
    const docsWithScore = await vectorStore.similaritySearchWithScore(query, topK);

    const scorePreview = docsWithScore
        .map(([, score]) => Number(score))
        .filter((score) => Number.isFinite(score))
        .slice(0, topK)
        .map((score) => score.toFixed(4));
    console.log(
        `[rag][scores] query=${JSON.stringify(query)} top=${scorePreview.join(", ")} maxScore=${maxScore}`
    );

    const normalized = docsWithScore
        .map(([doc, score]) => ({
            source: doc?.metadata?.source || "unknown",
            content: doc?.pageContent || "",
            score: Number(score)
        }))
        .filter((item) => item.content && Number.isFinite(item.score))
        .sort((a, b) => a.score - b.score);

    const filtered = Number.isFinite(maxScore)
        ? normalized
            .filter((item) => item.score <= maxScore)
            .slice(0, returnK)
        : normalized.slice(0, returnK);

    if (filtered.length === 0) {
        return {
            status: "no_match",
            items: []
        };
    }

    return {
        status: "ok",
        items: filtered
    };
}
