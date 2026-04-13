import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // 极客小贴士：如果你想让局域网内的手机也能访问测试，可以把 host 设为 true
        host: true,
    },
    build: {
        chunkSizeWarningLimit: 450,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) {
                        return undefined;
                    }

                    if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
                        return 'vendor-react';
                    }

                    if (id.includes('node_modules/zustand/')) {
                        return 'vendor-state';
                    }

                    if (
                        id.includes('node_modules/react-markdown/') ||
                        id.includes('node_modules/remark-gfm/') ||
                        id.includes('node_modules/remark-') ||
                        id.includes('node_modules/mdast-util-') ||
                        id.includes('node_modules/micromark') ||
                        id.includes('node_modules/unist-') ||
                        id.includes('node_modules/hast-')
                    ) {
                        return 'vendor-markdown';
                    }

                    if (id.includes('node_modules/react-syntax-highlighter/') || id.includes('node_modules/refractor/')) {
                        return 'vendor-syntax';
                    }

                    return 'vendor-misc';
                },
            },
        },
    },
});