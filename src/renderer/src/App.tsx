import React, { useState, useCallback, useEffect } from 'react'
import { Settings, MessageSquare, Database, Wifi, WifiOff } from 'lucide-react'
import { VoiceInput } from './components/VoiceInput'
import { ChatView } from './components/ChatView'
import { ConnectionsPanel } from './components/ConnectionsPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { useChatStore } from './stores/chatStore'
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis'
import { chat, getAvailableProviders, LLMMessage, LLMProvider } from './lib/llm'

type View = 'chat' | 'connections' | 'settings'

function App() {
    const [currentView, setCurrentView] = useState<View>('chat')
    const { messages, addMessage, setProcessing, isProcessing } = useChatStore()
    const { speak } = useSpeechSynthesis()
    const [llmStatus, setLlmStatus] = useState<{ provider: string | null; available: boolean }>({
        provider: null,
        available: false,
    })

    // Check LLM availability on mount
    useEffect(() => {
        async function checkLLM() {
            try {
                const providers = await getAvailableProviders()
                if (providers.ollama.available) {
                    setLlmStatus({ provider: `Ollama (${providers.ollama.model})`, available: true })
                } else if (providers.openai.available) {
                    setLlmStatus({ provider: 'OpenAI', available: true })
                } else {
                    setLlmStatus({ provider: null, available: false })
                }
            } catch (error) {
                console.error('Error checking LLM:', error)
                setLlmStatus({ provider: null, available: false })
            }
        }
        checkLLM()
        // Re-check every 30 seconds
        const interval = setInterval(checkLLM, 30000)
        return () => clearInterval(interval)
    }, [])

    // Handle message submission
    const handleSubmit = useCallback(async (content: string) => {
        if (!content.trim()) return

        // Add user message
        addMessage({
            role: 'user',
            content: content.trim(),
        })

        setProcessing(true)

        try {
            // Build message history for LLM
            const llmMessages: LLMMessage[] = messages.map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            }))

            // Add the new user message
            llmMessages.push({
                role: 'user',
                content: content.trim(),
            })

            // Call LLM
            const response = await chat(llmMessages)

            // Add assistant response
            addMessage({
                role: 'assistant',
                content: response.content,
                toolCalls: response.toolCalls,
            })

            // Speak the response
            speak(response.content)

            // Update provider status
            setLlmStatus({ provider: `${response.provider} (${response.model})`, available: true })

        } catch (error) {
            console.error('LLM error:', error)
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'

            addMessage({
                role: 'assistant',
                content: `Sorry, I couldn't process that. ${errorMessage}`,
            })

            speak("Sorry, I couldn't process that request.")
        } finally {
            setProcessing(false)
        }
    }, [messages, addMessage, setProcessing, speak])

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
                <header className="h-12 flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0">
                    <div></div>
                    <div className="text-[10px] uppercase tracking-widest text-white/20 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        local-session: active
                    </div>
                    {/* LLM Status */}
                    <div className={`flex items-center gap-1.5 text-[10px] ${llmStatus.available ? 'text-green-400' : 'text-yellow-400'
                        }`}>
                        {llmStatus.available ? <Wifi size={12} /> : <WifiOff size={12} />}
                        <span className="uppercase tracking-wide">
                            {llmStatus.provider || 'No LLM'}
                        </span>
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

                {currentView === 'connections' && <ConnectionsPanel />}

                {currentView === 'settings' && <SettingsPanel />}
            </div>
        </div>
    )
}

export default App
