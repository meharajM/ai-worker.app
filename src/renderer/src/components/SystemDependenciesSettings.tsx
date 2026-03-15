import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

export function SystemDependenciesSettings() {
    const [dependencies, setDependencies] = useState<any[]>([]);

    useEffect(() => {
        const fetchDeps = async () => {
            const electron = window.electron as any;
            if (electron?.app?.getAllDependencies) {
                const deps = await electron.app.getAllDependencies();
                setDependencies(deps);
            }
        };
        fetchDeps();
    }, []);

    return (
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-6">
            <h4 className="font-bold text-lg text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
                <Check size={18} className="text-[var(--color-success)]" /> System Dependencies
            </h4>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                These tools enable core features like audio encoding, offline models, and the MarkItDown parser.
            </p>

            <div className="space-y-3">
                {dependencies.length > 0 ? (
                    dependencies.map((dep, idx) => (
                        <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-[var(--color-bg-dark)] border border-[var(--color-border)] gap-2">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm text-[var(--color-text-primary)]">{dep.name}</span>
                                    {dep.installed ? (
                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-success-muted)] text-[var(--color-success)] rounded">Installed</span>
                                    ) : (
                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-error-muted)] text-[var(--color-error)] rounded">Missing</span>
                                    )}
                                </div>
                                {dep.installed && dep.version && (
                                    <p className="text-[10px] text-[var(--color-text-disabled)] mt-1 truncate">{dep.version}</p>
                                )}
                                {!dep.installed && dep.error && (
                                    <p className="text-[10px] text-[var(--color-error)]/50 mt-1 truncate">{dep.error}</p>
                                )}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-sm text-[var(--color-text-tertiary)] text-center py-4">Checking system tools...</div>
                )}
            </div>

            {dependencies.some(d => !d.installed) && (
                <div className="mt-6 pt-6 border-t border-[var(--color-border)] flex flex-col items-center text-center space-y-3">
                    <p className="text-xs text-[var(--color-text-tertiary)]">Some required tools are missing. Installing them will open a terminal window.</p>
                    <button
                        onClick={async () => {
                            const electron = window.electron as any;
                            if (electron?.app) await electron.app.runSetupScript();
                        }}
                        className="px-4 py-2 bg-[var(--color-text-primary)] text-[var(--color-bg-dark)] font-semibold rounded-lg hover:opacity-90 transition-colors text-sm"
                    >
                        Run Install Script
                    </button>
                </div>
            )}
        </div>
    );
}
