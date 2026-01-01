import { vi } from 'vitest'

// Mock localStorage
const mockStorage: Record<string, string> = {}
const localStorageMock = {
    getItem: vi.fn((key: string) => mockStorage[key] || null),
    setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value }),
    removeItem: vi.fn((key: string) => { delete mockStorage[key] }),
    clear: vi.fn(() => { Object.keys(mockStorage).forEach(key => delete mockStorage[key]) }),
    length: 0,
    key: vi.fn(),
}
    ; (globalThis as any).localStorage = localStorageMock

// Mock window for Electron IPC
const windowMock = {
    electron: {
        platform: 'linux',
        mcp: {
            connect: vi.fn().mockResolvedValue({ success: true }),
            disconnect: vi.fn().mockResolvedValue({ success: true }),
            listTools: vi.fn().mockResolvedValue({ tools: [] }),
            callTool: vi.fn().mockResolvedValue({ result: {} }),
        },
        llm: {
            chat: vi.fn().mockResolvedValue({ content: 'Mock response' }),
            getProviders: vi.fn().mockResolvedValue({}),
            fetchOpenAIModels: vi.fn().mockResolvedValue([]),
        },
        store: {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(void 0),
            delete: vi.fn().mockResolvedValue(void 0),
        },
        shell: {
            openExternal: vi.fn().mockResolvedValue(void 0),
        },
        app: {
            getVersion: vi.fn().mockResolvedValue('0.1.0'),
            getName: vi.fn().mockResolvedValue('AI-Worker'),
        },
    },
    location: {
        hostname: 'localhost',
        port: '',
        href: 'http://localhost:5173',
        protocol: 'http:',
        pathname: '/',
        search: '',
        hash: '',
    },
    require: undefined,
}
    ; (globalThis as any).window = windowMock

    // Mock navigator
    ; (globalThis as any).navigator = {
        gpu: undefined,
        deviceMemory: 8,
        storage: {
            estimate: vi.fn().mockResolvedValue({ quota: 100000000000, usage: 1000000 }),
        },
    }

    // Mock performance.memory
    ; (globalThis as any).performance = {
        memory: {
            usedJSHeapSize: 100 * 1024 * 1024, // 100MB
            totalJSHeapSize: 200 * 1024 * 1024, // 200MB
            jsHeapSizeLimit: 4 * 1024 * 1024 * 1024, // 4GB
        },
        now: vi.fn().mockReturnValue(Date.now()),
    }

    // Mock fetch
    ; (globalThis as any).fetch = vi.fn()
