import React, { useState, useEffect } from 'react'
import { Monitor, Download, Check, AlertCircle, Loader2, ChevronRight, Chrome, Globe, Flame, Settings2 } from 'lucide-react'
import { isElectron, electron } from '../lib/electron'
import { useSettingsStore, PlaywrightBrowserType } from '../stores/settingsStore'

interface SetupStep {
    id: string
    title: string
    description: string
}

const steps: SetupStep[] = [
    { id: 'welcome', title: 'Welcome', description: 'Welcome to AI Worker' },
    { id: 'browser', title: 'Browser Setup', description: 'Choose your preferred browser' },
    { id: 'install', title: 'Installation', description: 'Installing browser' },
    { id: 'complete', title: 'Complete', description: 'Setup complete' },
]

const browserOptions: { value: PlaywrightBrowserType; label: string; icon: React.ReactNode; description: string }[] = [
    { 
        value: 'chrome', 
        label: 'Google Chrome', 
        icon: <Chrome className="w-6 h-6" />,
        description: 'Fast and widely supported'
    },
    { 
        value: 'firefox', 
        label: 'Mozilla Firefox', 
        icon: <Flame className="w-6 h-6" />,
        description: 'Privacy-focused and open source'
    },
    { 
        value: 'chromium', 
        label: 'Chromium (Bundled)', 
        icon: <Globe className="w-6 h-6" />,
        description: 'Lightweight, no system install needed'
    },
    { 
        value: 'msedge', 
        label: 'Microsoft Edge', 
        icon: <Settings2 className="w-6 h-6" />,
        description: 'Built-in on Windows'
    },
]

export const InitialSetup: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
    const [currentStep, setCurrentStep] = useState(0)
    const [selectedBrowser, setSelectedBrowser] = useState<PlaywrightBrowserType>('chrome')
    const [installProgress, setInstallProgress] = useState('')
    const [installError, setInstallError] = useState('')
    const [isInstalling, setIsInstalling] = useState(false)
    const [installSuccess, setInstallSuccess] = useState(false)
    
    const { setPlaywrightBrowser } = useSettingsStore()

    const handleBrowserSelect = (browser: PlaywrightBrowserType) => {
        setSelectedBrowser(browser)
    }

    const handleNext = async () => {
        if (currentStep === 1) {
            // Save browser preference
            await setPlaywrightBrowser(selectedBrowser)
            setCurrentStep(2)
            
            // Start installation
            await installBrowser()
        } else if (currentStep < steps.length - 1) {
            setCurrentStep(currentStep + 1)
        } else {
            onComplete()
        }
    }

    const installBrowser = async () => {
        if (!isElectron()) {
            setInstallError('Browser installation requires Electron app')
            return
        }

        setIsInstalling(true)
        setInstallProgress('Preparing installation...')
        setInstallError('')

        try {
            // Map browser type to install command
            let browserToInstall: 'chrome' | 'firefox' | 'webkit' | 'chromium' | 'msedge'
            
            switch (selectedBrowser) {
                case 'chrome':
                case 'msedge':
                    // These use system browsers, check if they exist first
                    setInstallProgress('Checking system browser...')
                    const status = await electron.browser.checkStatus(selectedBrowser)
                    if (status.installed) {
                        setInstallSuccess(true)
                        setInstallProgress('System browser detected!')
                        setTimeout(() => setCurrentStep(3), 1000)
                        return
                    } else {
                        // If system browser isn't installed, let Playwright install it
                        browserToInstall = selectedBrowser
                        break
                    }
                case 'firefox':
                    browserToInstall = 'firefox'
                    break
                case 'chromium':
                    browserToInstall = 'chromium'
                    break
                default:
                    browserToInstall = 'chromium'
            }

            setInstallProgress(`Installing ${browserToInstall}...`)
            const result = await electron.browser.install(browserToInstall)
            
            if (result.success) {
                setInstallSuccess(true)
                setInstallProgress('Installation complete!')
                setTimeout(() => setCurrentStep(3), 1000)
            } else {
                setInstallError(result.error || 'Installation failed')
            }
        } catch (error) {
            setInstallError(error instanceof Error ? error.message : 'Unknown error')
        } finally {
            setIsInstalling(false)
        }
    }

    const handleSkip = () => {
        // Skip browser installation, use auto-detect
        setPlaywrightBrowser('auto')
        onComplete()
    }

    const renderStep = () => {
        switch (currentStep) {
            case 0:
                return (
                    <div className="text-center space-y-6">
                        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                            <Monitor className="w-10 h-10 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold mb-2">Welcome to AI Worker</h1>
                            <p className="text-muted-foreground">
                                Let's get you set up with a browser for web automation.
                                This only takes a minute.
                            </p>
                        </div>
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={handleNext}
                                className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
                            >
                                Get Started
                                <ChevronRight className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleSkip}
                                className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-muted transition-colors"
                            >
                                Skip for now
                            </button>
                        </div>
                    </div>
                )

            case 1:
                return (
                    <div className="space-y-6">
                        <div className="text-center">
                            <h2 className="text-xl font-bold mb-2">Choose Your Browser</h2>
                            <p className="text-muted-foreground text-sm">
                                Select which browser you want to use for web automation tasks
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            {browserOptions.map((browser) => (
                                <button
                                    key={browser.value}
                                    onClick={() => handleBrowserSelect(browser.value)}
                                    className={`p-4 border rounded-lg flex items-center gap-4 transition-all ${
                                        selectedBrowser === browser.value
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                                    }`}
                                >
                                    <div className={`p-2 rounded-lg ${
                                        selectedBrowser === browser.value ? 'bg-primary/10' : 'bg-muted'
                                    }`}>
                                        {browser.icon}
                                    </div>
                                    <div className="flex-1 text-left">
                                        <div className="font-medium">{browser.label}</div>
                                        <div className="text-sm text-muted-foreground">{browser.description}</div>
                                    </div>
                                    {selectedBrowser === browser.value && (
                                        <Check className="w-5 h-5 text-primary" />
                                    )}
                                </button>
                            ))}
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleSkip}
                                className="px-4 py-2 border border-border rounded-lg font-medium hover:bg-muted transition-colors"
                            >
                                Skip
                            </button>
                            <button
                                onClick={handleNext}
                                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                )

            case 2:
                return (
                    <div className="text-center space-y-6">
                        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                            {installSuccess ? (
                                <Check className="w-10 h-10 text-green-500" />
                            ) : isInstalling ? (
                                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                            ) : installError ? (
                                <AlertCircle className="w-10 h-10 text-destructive" />
                            ) : (
                                <Download className="w-10 h-10 text-primary" />
                            )}
                        </div>

                        <div>
                            <h2 className="text-xl font-bold mb-2">
                                {installSuccess ? 'Installation Complete!' : 'Installing Browser'}
                            </h2>
                            <p className="text-muted-foreground">
                                {installProgress || 'Preparing...'}
                            </p>
                        </div>

                        {installError && (
                            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                                <p className="text-sm text-destructive">{installError}</p>
                                <div className="flex gap-2 mt-3">
                                    <button
                                        onClick={() => setCurrentStep(1)}
                                        className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors"
                                    >
                                        Choose Different Browser
                                    </button>
                                    <button
                                        onClick={handleSkip}
                                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors"
                                    >
                                        Skip & Use Auto
                                    </button>
                                </div>
                            </div>
                        )}

                        {installSuccess && (
                            <button
                                onClick={() => setCurrentStep(3)}
                                className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                            >
                                Continue
                            </button>
                        )}
                    </div>
                )

            case 3:
                return (
                    <div className="text-center space-y-6">
                        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                            <Check className="w-10 h-10 text-green-500" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
                            <p className="text-muted-foreground">
                                {selectedBrowser === 'auto' 
                                    ? 'Browser will be auto-detected.' 
                                    : `${browserOptions.find(b => b.value === selectedBrowser)?.label} is ready to use.`}
                            </p>
                        </div>
                        <div className="p-4 bg-muted rounded-lg text-left text-sm space-y-2">
                            <p className="font-medium">What's next?</p>
                            <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                                <li>Start chatting with the AI</li>
                                <li>Ask it to browse websites or perform web tasks</li>
                                <li>Change browser anytime in Settings</li>
                            </ul>
                        </div>
                        <button
                            onClick={onComplete}
                            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                        >
                            Start Using AI Worker
                        </button>
                    </div>
                )

            default:
                return null
        }
    }

    return (
        <div className="fixed inset-0 bg-background z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Progress indicator */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                        {steps.map((step, index) => (
                            <div key={step.id} className="flex items-center">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                                    index <= currentStep
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted text-muted-foreground'
                                }`}>
                                    {index < currentStep ? (
                                        <Check className="w-4 h-4" />
                                    ) : (
                                        index + 1
                                    )}
                                </div>
                                {index < steps.length - 1 && (
                                    <div className={`w-12 h-0.5 mx-1 ${
                                        index < currentStep ? 'bg-primary' : 'bg-muted'
                                    }`} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="text-center">
                        <p className="text-sm font-medium">{steps[currentStep].title}</p>
                        <p className="text-xs text-muted-foreground">{steps[currentStep].description}</p>
                    </div>
                </div>

                {/* Step content */}
                <div className="bg-card border rounded-xl p-6 shadow-lg">
                    {renderStep()}
                </div>
            </div>
        </div>
    )
}

export default InitialSetup
