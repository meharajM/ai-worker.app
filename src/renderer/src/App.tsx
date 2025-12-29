import React, { useState, useCallback, useEffect } from 'react'
import { VoiceInput } from './components/VoiceInput'
import { ChatView } from './components/ChatView'
import { ConnectionsPanel } from './components/ConnectionsPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { Sidebar, View } from './components/Sidebar'
import { Header } from './components/Header'
import { useChatStore } from './stores/chatStore'
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis'
import { chat, getAvailableProviders, LLMMessage } from './lib/llm'

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
            <Sidebar currentView={currentView} onViewChange={setCurrentView} />

            <div className="flex-1 flex flex-col relative">
                <Header status={llmStatus} />

                <main className="flex-1 flex flex-col overflow-hidden">
                    {currentView === 'chat' && (
                        <div className="flex-1 flex flex-col overflow-hidden">
                            <ChatView />
                            <div className="p-4 flex-shrink-0 border-t border-white/5">
                                <VoiceInput onSubmit={handleSubmit} disabled={isProcessing} />
                            </div>
                        </div>
                    )}

                    {currentView === 'connections' && <ConnectionsPanel />}
                    {currentView === 'settings' && <SettingsPanel />}
                </main>
            </div>
        </div>
    )
}

export default App
