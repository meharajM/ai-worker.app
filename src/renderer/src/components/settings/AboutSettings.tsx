import React from 'react'
import { APP_INFO } from '../../lib/constants'

export function AboutSettings() {
    return (
        <div>
            <h3 className="text-xl font-bold mb-6">About</h3>

            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-6 text-center">
                <div className="w-16 h-16 bg-[#00a896] rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <div className="w-8 h-8 border-2 border-white rounded-lg flex items-center justify-center">
                        <div className="w-4 h-[2px] bg-white rounded-full"></div>
                    </div>
                </div>
                <h4 className="text-xl font-bold">{APP_INFO.NAME}</h4>
                <p className="text-white/40 text-sm">Version {APP_INFO.VERSION}</p>
                <p className="text-white/60 mt-4 text-sm">
                    Voice-first desktop workspace with MCP integration
                </p>
                <div className="mt-6 pt-4 border-t border-white/10">
                    <p className="text-xs text-white/30">
                        Built with Electron, React, and ❤️
                    </p>
                </div>
            </div>
        </div>
    )
}
