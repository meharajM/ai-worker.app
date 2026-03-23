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
        <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-6">
            <h4 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Check size={18} className="text-[#00a896]" /> System Dependencies
            </h4>
            <p className="text-sm text-white/60 mb-6">
                These tools enable core features like audio encoding, offline models, and the MarkItDown parser.
            </p>

            <div className="space-y-3">
                {dependencies.length > 0 ? (
                    dependencies.map((dep, idx) => (
                        <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5 gap-2">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm text-white">{dep.name}</span>
                                    {dep.installed ? (
                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/20 text-green-400 rounded">Installed</span>
                                    ) : (
                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded">Missing</span>
                                    )}
                                </div>
                                {dep.installed && dep.version && (
                                    <p className="text-[10px] text-white/30 mt-1 truncate">{dep.version}</p>
                                )}
                                {!dep.installed && dep.error && (
                                    <p className="text-[10px] text-red-500/50 mt-1 truncate">{dep.error}</p>
                                )}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-sm text-white/40 text-center py-4">Checking system tools...</div>
                )}
            </div>

            {dependencies.some(d => !d.installed) && (
                <div className="mt-6 pt-6 border-t border-white/10 flex flex-col items-center text-center space-y-3">
                    <p className="text-xs text-white/50">Some required tools are missing. Installing them will open a terminal window.</p>
                    <button
                        onClick={async () => {
                            const electron = window.electron as any;
                            if (electron?.app) await electron.app.runSetupScript();
                        }}
                        className="px-4 py-2 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors text-sm"
                    >
                        Run Install Script
                    </button>
                </div>
            )}
        </div>
    );
}
