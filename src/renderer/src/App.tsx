import React, { useState, useCallback } from 'react'
import { Settings, MessageSquare, Database } from 'lucide-react'
import { VoiceInput } from './components/VoiceInput'
import { ChatView } from './components/ChatView'
import { useChatStore } from './stores/chatStore'
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis'

type View = 'chat' | 'connections' | 'settings'

function App() {
    const [currentView, setCurrentView] = useState<View>('chat')
    const { addMessage, setProcessing, isProcessing } = useChatStore()
    const { speak } = useSpeechSynthesis()

    // Handle message submission
    const handleSubmit = useCallback(async (content: string) => {
        if (!content.trim()) return

        // Add user message
        addMessage({
            role: 'user',
            content: content.trim(),
        })

        setProcessing(true)

        // TODO: Replace with actual LLM call
        // For now, simulate a response
        setTimeout(() => {
            const response = `I heard you say: "${content}". LLM integration coming soon!`

            addMessage({
                role: 'assistant',
                content: response,
            })

            setProcessing(false)

            // Speak the response
            speak(response)
        }, 1000)
    }, [addMessage, setProcessing, speak])

    return (
        <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden">
            {/* Sidebar */}
            <div className="w-16 bg-[#1a1d23] flex flex-col items-center py-6 border-r border-white/5">
                <div className="flex-1 flex flex-col gap-4">
                    {/* Chat Tab */}
                    <button
                        onClick={() => setCurrentView('chat')}
                        className={`p-3 rounded-lg transition-colors ${currentView === 'chat'
                                ? 'bg-white/10 text-[#4fd1c5]'
                                : 'text-white/40 hover:text-white hover:bg-white/5'
                            }`}
                        title="Chat"
                    >
                        <MessageSquare size={24} />
                    </button>

                    {/* Connections Tab */}
                    <button
                        onClick={() => setCurrentView('connections')}
                        className={`p-3 rounded-lg transition-colors ${currentView === 'connections'
                                ? 'bg-white/10 text-[#4fd1c5]'
                                : 'text-white/40 hover:text-white hover:bg-white/5'
                            }`}
                        title="MCP Connections"
                    >
                        <Database size={24} />
                    </button>
                </div>

                {/* Settings */}
                <button
                    onClick={() => setCurrentView('settings')}
                    className={`p-3 rounded-lg transition-colors ${currentView === 'settings'
                            ? 'bg-white/10 text-[#4fd1c5]'
                            : 'text-white/40 hover:text-white hover:bg-white/5'
                        }`}
                    title="Settings"
                >
                    <Settings size={24} />
                </button>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col relative">
                {/* Header */}
                <header className="h-12 flex items-center justify-center border-b border-white/5 flex-shrink-0">
                    <div className="text-[10px] uppercase tracking-widest text-white/20 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        local-session: active
                    </div>
                </header>

                {/* Content Area */}
                {currentView === 'chat' && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Chat Messages */}
                        <ChatView />

                        {/* Voice Input */}
                        <div className="p-4 flex-shrink-0 border-t border-white/5">
                            <VoiceInput onSubmit={handleSubmit} disabled={isProcessing} />
                        </div>
                    </div>
                )}

                {currentView === 'connections' && (
                    <div className="flex-1 p-6">
                        <h2 className="text-xl font-bold mb-4">MCP Connections</h2>
                        <p className="text-white/60">Connect to MCP servers to enable tool usage.</p>
                        <p className="text-white/40 mt-2 text-sm">Coming in Phase 5...</p>
                    </div>
                )}

                {currentView === 'settings' && (
                    <div className="flex-1 p-6">
                        <h2 className="text-xl font-bold mb-4">Settings</h2>
                        <p className="text-white/60">Configure your AI-Worker preferences.</p>
                        <p className="text-white/40 mt-2 text-sm">Coming in Phase 6...</p>
                    </div>
                )}
            </div>
        </div>
    )
}

export default App
