import React, { useEffect, useState } from 'react';

interface Dependency {
    name: string;
    installed: boolean;
    required: boolean;
}

export function MissingDependenciesScreen({ onResolved }: { onResolved: () => void }) {
    const [missing, setMissing] = useState<Dependency[]>([]);
    const [loading, setLoading] = useState(true);
    const [runningScript, setRunningScript] = useState(false);

    const checkDependencies = async () => {
        setLoading(true);
        try {
            const electron = window.electron as any;
            if (!electron?.app) return;
            const deps: Dependency[] = await electron.app.getMissingDependencies();
            setMissing(deps);
            if (deps.length === 0) {
                onResolved();
            }
        } catch (e) {
            console.error("Failed to check dependencies", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Initial check
        checkDependencies();

        // Listen for standard app focus to rehydrate if they installed externally
        const onFocus = () => {
            if (!runningScript) checkDependencies();
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [runningScript]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (runningScript) {
            interval = setInterval(async () => {
                const electron = window.electron as any;
                if (!electron?.app) return;
                const deps: Dependency[] = await electron.app.getMissingDependencies();
                setMissing(deps);
                if (deps.length === 0) {
                    clearInterval(interval);
                    onResolved();
                }
            }, 3000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [runningScript, onResolved]);

    const handleRunScript = async () => {
        setRunningScript(true);
        const electron = window.electron as any;
        if (electron?.app) {
            await electron.app.runSetupScript();
        }
    };

    if (loading && missing.length === 0) {
        return (
            <div className="flex items-center justify-center p-8 bg-[var(--color-bg-dark)] text-[var(--color-text-primary)] w-full h-full">
                <div className="text-[var(--color-text-muted)]">Checking system dependencies...</div>
            </div>
        );
    }

    if (missing.length === 0) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 bg-[var(--color-bg-dark)] flex items-center justify-center text-[var(--color-text-primary)] p-8 overflow-y-auto">
            <div className="max-w-md w-full p-8 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-card-dark)] shadow-[var(--shadow-xl)] space-y-6">
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold">Missing Dependencies</h2>
                    <p className="text-sm text-gray-400">
                        AI-Worker requires a few system tools to function properly (e.g. converting audio, running local AI tools).
                    </p>
                </div>

                <div className="space-y-3">
                    {missing.map((dep) => (
                        <div key={dep.name} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                            <span className="font-mono text-sm">{dep.name}</span>
                            <span className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 font-medium">Missing</span>
                        </div>
                    ))}
                </div>

                {runningScript ? (
                    <div className="space-y-4">
                        <div className="flex items-center justify-center space-x-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
                            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                            <span className="text-sm font-medium">Installing via terminal...</span>
                        </div>
                        <p className="text-xs text-gray-400 text-center">
                            Please complete the installation in the terminal window that opened. This screen will automatically dismiss when finished.
                        </p>
                        <button
                            onClick={() => {
                                const electron = window.electron as any;
                                if (electron?.app) checkDependencies();
                            }}
                            className="w-full py-2 text-sm text-[#4fd1c5] font-medium hover:text-[#4fd1c5]/80 transition-colors"
                        >
                            Refresh Status (click after closing the terminal)
                        </button>
                        <button
                            onClick={onResolved}
                            className="w-full py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                        >
                            Skip for now (Install later from Settings &rarr; About)
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <button
                            onClick={handleRunScript}
                            className="w-full py-3 px-4 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            Run Install Script
                        </button>
                        <button
                            onClick={onResolved}
                            className="w-full py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                        >
                            Skip for now (Install later from Settings &rarr; About)
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
