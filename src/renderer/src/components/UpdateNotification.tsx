import React, { useEffect, useState } from 'react'
import { DownloadCloud, X, AlertTriangle } from 'lucide-react'
import { checkUpdateAvailable, UpdateConfig } from '../lib/updateChecker'
import electron from '../lib/electron'

export function UpdateNotification() {
  const [updateConfig, setUpdateConfig] = useState<UpdateConfig | null>(null)
  const [isForced, setIsForced] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    console.log('[UpdateNotification] Component mounted')
    async function check() {
      console.log('[UpdateNotification] Starting update check (3s delay)...')
      // Small delay on startup so it doesn't jarringly block the initial load
      setTimeout(async () => {
        const { available, config, forceUpdate } = await checkUpdateAvailable()
        console.log('[UpdateNotification] Check result:', { available, config, forceUpdate })
        if (available && config) {
          // Check if user previously skipped this non-forced version
          const skippedVersion = await electron.store.get('system.skippedUpdate')
          if (skippedVersion === config.latestVersion && !forceUpdate) return

          setUpdateConfig(config)
          setIsForced(forceUpdate)
          setIsVisible(true)
        }
      }, 3000)
    }
    check()
  }, [])

  if (!isVisible || !updateConfig) return null

  const handleDownload = () => {
    electron.openExternal(updateConfig.downloadUrl)
    if (!isForced) setIsVisible(false) // Wait to dismiss unless forced
  }

  const handleSkip = async () => {
    if (isForced) return
    await electron.store.set('system.skippedUpdate', updateConfig.latestVersion)
    setIsVisible(false)
  }

  return (
    <div className={`fixed bottom-6 right-6 z-50 p-4 rounded-xl shadow-2xl transition-all duration-500 max-w-sm border backdrop-blur-md ${isForced ? 'bg-red-500/10 border-red-500/50' : 'bg-gray-900/80 border-white/10'}`}>
      <div className="flex items-start gap-4">
        <div className={`p-2 rounded-full mt-1 ${isForced ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-400'}`}>
          {isForced ? <AlertTriangle className="w-5 h-5" /> : <DownloadCloud className="w-5 h-5" />}
        </div>
        
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">
            {isForced ? 'Critical Update Required' : 'New Version Available!'}
          </h3>
          
          <p className="text-xs text-gray-300 mt-1 mb-2 leading-relaxed">
            Version {updateConfig.latestVersion} is out.
            {updateConfig.releaseNotes && <span className="block mt-1 italic text-gray-400">"{updateConfig.releaseNotes}"</span>}
          </p>

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleDownload}
              className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                isForced 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              Download
            </button>
            {!isForced && (
              <button
                onClick={handleSkip}
                className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
              >
                Skip
              </button>
            )}
          </div>
        </div>

        {!isForced && (
          <button 
            onClick={() => setIsVisible(false)}
            className="text-gray-500 hover:text-white transition-colors p-1"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
