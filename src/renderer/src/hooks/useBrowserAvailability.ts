import { useState, useEffect } from 'react'
import { isElectron, electron } from '../lib/electron'

interface BrowserCheckState {
    isChecking: boolean
    hasBrowser: boolean
    checked: boolean
}

export function useBrowserAvailability(): BrowserCheckState {
    const [state, setState] = useState<BrowserCheckState>({
        isChecking: true,
        hasBrowser: false,
        checked: false
    })

    useEffect(() => {
        const checkBrowsers = async () => {
            // In browser mode, assume browsers are available
            if (!isElectron()) {
                setState({
                    isChecking: false,
                    hasBrowser: true,
                    checked: true
                })
                return
            }

            try {
                const statuses = await electron.browser.checkAllStatuses()
                
                // Check if ANY browser is installed
                const hasAnyBrowser = statuses.some(status => status.installed)
                
                setState({
                    isChecking: false,
                    hasBrowser: hasAnyBrowser,
                    checked: true
                })
            } catch (error) {
                console.error('Failed to check browser availability:', error)
                // On error, assume no browser to be safe
                setState({
                    isChecking: false,
                    hasBrowser: false,
                    checked: true
                })
            }
        }

        checkBrowsers()
    }, [])

    return state
}
