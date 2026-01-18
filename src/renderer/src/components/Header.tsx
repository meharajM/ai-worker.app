import React from 'react'
import { Wifi, WifiOff, HardDrive, Download, Layers, Check } from 'lucide-react'
import { AppModeId, APP_MODES } from '../types/modes'

export interface LLMStatus {
    provider: string | null;
    available: boolean;
    isDownloading?: boolean; // New: specific for local model downloading
}

interface HeaderProps {
    localStatus?: LLMStatus;
    remoteStatus?: LLMStatus;
    activeMode: AppModeId;
    onModeChange: (mode: AppModeId) => void;
}

export function Header({ localStatus, remoteStatus, activeMode, onModeChange }: HeaderProps) {
    const [isModeOpen, setIsModeOpen] = React.useState(false);

    // Close dropdown when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.mode-selector')) {
                setIsModeOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const currentMode = APP_MODES[activeMode];

    return (
        <header className="h-12 flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0">
            {/* Mode Switcher */}
            <div className="relative mode-selector">
                <button
                    onClick={() => setIsModeOpen(!isModeOpen)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors text-xs text-secondary hover:text-primary"
                >
                    <Layers size={14} />
                    <span className="font-medium tracking-wide uppercase">{currentMode.name} Mode</span>
                </button>

                {isModeOpen && (
                    <div className="absolute top-full left-0 mt-1 w-56 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-50 p-1 flex flex-col gap-0.5">
                        {Object.values(APP_MODES).map((mode) => (
                            <button
                                key={mode.id}
                                onClick={() => {
                                    onModeChange(mode.id);
                                    setIsModeOpen(false);
                                }}
                                className={`flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-colors w-full ${activeMode === mode.id
                                        ? 'bg-primary/20 text-primary'
                                        : 'hover:bg-white/5 text-secondary hover:text-white'
                                    }`}
                            >
                                <div className={`mt-0.5 ${activeMode === mode.id ? 'opacity-100' : 'opacity-0'}`}>
                                    <Check size={14} />
                                </div>
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-wider mb-0.5">
                                        {mode.name}
                                    </div>
                                    <div className="text-[10px] opacity-70 leading-snug">
                                        {mode.description}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="text-[10px] uppercase tracking-widest text-white/20 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                local-session: active
            </div>

            <div className="flex items-center gap-4">
                {/* Local LLM Status */}
                {localStatus && (
                    <div className={`flex items-center gap-1.5 text-[10px] ${localStatus.available
                        ? 'text-green-400'
                        : localStatus.isDownloading
                            ? 'text-blue-400'
                            : 'text-white/40' // Dim when not available/downloading
                        }`}>
                        {localStatus.isDownloading ? (
                            <Download size={12} className="animate-bounce" />
                        ) : localStatus.available ? (
                            <HardDrive size={12} />
                        ) : (
                            <HardDrive size={12} className="opacity-50" />
                        )}
                        <span className="uppercase tracking-wide">
                            {localStatus.provider || 'Local AI'}
                        </span>
                    </div>
                )}

                {/* Separator if both exist */}
                {localStatus && remoteStatus && (
                    <div className="h-3 w-[1px] bg-white/10" />
                )}

                {/* Remote LLM Status */}
                {remoteStatus && (
                    <div className={`flex items-center gap-1.5 text-[10px] ${remoteStatus.available ? 'text-blue-400' : 'text-yellow-400'
                        }`}>
                        {remoteStatus.available ? <Wifi size={12} /> : <WifiOff size={12} />}
                        <span className="uppercase tracking-wide">
                            {remoteStatus.provider || 'Cloud AI'}
                        </span>
                    </div>
                )}
            </div>
        </header>
    )
}
