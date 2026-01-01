import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'node', // Use node environment to avoid jsdom ESM issues
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/unit/**/*.test.{ts,tsx}'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/renderer/src/**/*.{ts,tsx}'],
            exclude: [
                'src/renderer/src/main.tsx',
                'src/renderer/src/**/*.d.ts',
                'src/renderer/src/lib/llm-worker.ts',
            ],
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src/renderer/src'),
        },
    },
})
