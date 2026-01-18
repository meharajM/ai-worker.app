import { useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useMcpStore } from '../stores/mcpStore'
import { saveUserSettings, getUserProfile } from '../lib/firebase/db'

const SYNC_DEBOUNCE_MS = 2000

export function useSettingsSync() {
    const { user } = useAuthStore()
    const { 
        hydrateSettings, // New action
        setIsSyncing
    } = useSettingsStore()
    const mcpStore = useMcpStore()
    
    const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // 1. Unified Hydration on Login
    useEffect(() => {
        if (user?.uid) {
            console.log('[Sync] User logged in, hydrating data...')
            setIsSyncing(true)
            
            getUserProfile(user.uid).then((userData) => {
                if (userData) {
                    // 1. Hydrate Settings
                    if (userData.settings) {
                        hydrateSettings(userData.settings)
                    }
                    
                    // 2. Hydrate MCP Servers
                    if (userData.mcpServers && Array.isArray(userData.mcpServers)) {
                        mcpStore.syncServers(userData.mcpServers)
                    }
                }
                setIsSyncing(false)
            }).catch((err) => {
                console.error('[Sync] Hydration failed', err)
                setIsSyncing(false)
            })
        }
    }, [user?.uid, hydrateSettings, setIsSyncing, mcpStore.syncServers])

    // 2. Unified Auto-Save
    useEffect(() => {
        if (!user?.uid) return

        const handleSave = () => {
             // Debounce save
             if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)

             syncTimeoutRef.current = setTimeout(async () => {
                 const state = useSettingsStore.getState()
                 const mcpState = useMcpStore.getState()
                 
                 // Don't save if we are currently syncing FROM cloud (avoid loops)
                 if (state.isSyncing) return

                 console.log('[Sync] Saving data to cloud...')
                 
                 // Prepare Settings Payload
                 const settingsToSave = {
                     theme: state.theme,
                     preferredProvider: state.preferredProvider,
                     ollamaModel: state.ollamaModel,
                     ollamaBaseUrl: state.ollamaBaseUrl,
                     // We DO NOT sync API keys by default as per requirement/plan?
                     // Plan said "Common data... API Keys are local-only."
                     // So we omit them here.
                     // openaiApiKey: state.openaiApiKey, 
                     openaiModel: state.openaiModel,
                     geminiModel: state.geminiModel,
                     openrouterModel: state.openrouterModel,
                     browserModel: state.browserModel,
                     ttsEnabled: state.ttsEnabled,
                     ttsRate: state.ttsRate,
                     ttsPitch: state.ttsPitch,
                     ttsVoice: state.ttsVoice,
                     speechLang: state.speechLang,
                 }
                 
                 // Prepare MCP Payload (filter out secrets)
                 const mcpServersToSave = mcpState.servers.map(server => ({
                     name: server.name,
                     description: server.description,
                     type: server.type,
                     command: server.command,
                     args: server.args,
                     url: server.url,
                     autoConnect: server.autoConnect,
                     // EXPLICITLY OMIT env
                 }))

                 try {
                     await saveUserSettings(user.uid, {
                         settings: settingsToSave,
                         mcpServers: mcpServersToSave
                     })
                     console.log('[Sync] Save complete')
                 } catch (err) {
                     console.error('[Sync] Save failed', err)
                 }
             }, SYNC_DEBOUNCE_MS)
        }

        // Subscribe to both stores
        const unsubSettings = useSettingsStore.subscribe(handleSave)
        const unsubMcp = useMcpStore.subscribe(handleSave)

        return () => {
             unsubSettings()
             unsubMcp()
             if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
        }
    }, [user?.uid])
}
