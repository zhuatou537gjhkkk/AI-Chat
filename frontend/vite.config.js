import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // 极客小贴士：如果你想让局域网内的手机也能访问测试，可以把 host 设为 true
        host: true,
    }
});