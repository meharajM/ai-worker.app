import React from 'react'
import {
    Search,
    ShoppingCart,
    Code,
    FileText,
    Layers,
    Database,
    Globe,
    Zap
} from 'lucide-react'
import templatesData from '../assets/workflow-templates.json'

interface WorkflowTemplate {
    id: string
    title: string
    description: string
    prompt: string
    iconName: string
    color: string
}

const ICON_MAP: Record<string, React.ReactNode> = {
    ShoppingCart: <ShoppingCart size={20} />,
    Search: <Search size={20} />,
    Code: <Code size={20} />,
    FileText: <FileText size={20} />,
    Layers: <Layers size={20} />,
    Database: <Database size={20} />,
    Globe: <Globe size={20} />,
    Zap: <Zap size={20} />
}

export function WorkflowTiles() {
    const handleTileClick = (prompt: string) => {
        const event = new CustomEvent('populate-chat-input', { detail: { prompt } })
        window.dispatchEvent(event)
    }

    const templates = templatesData as WorkflowTemplate[]

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {templates.map((template) => (
                <button
                    key={template.id}
                    onClick={() => handleTileClick(template.prompt)}
                    className={`
                        flex flex-col items-start text-left p-4 rounded-2xl border 
                        bg-gradient-to-br ${template.color}
                        hover:scale-[1.02] hover:shadow-xl hover:shadow-black/20 
                        transition-all duration-300 group relative overflow-hidden
                    `}
                >
                    {/* Glassmorphism Background Effect */}
                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />

                    <div className="mb-3 p-2 rounded-xl bg-white/10 group-hover:bg-white/20 transition-colors">
                        {ICON_MAP[template.iconName] || <Zap size={20} />}
                    </div>

                    <h3 className="font-bold text-sm mb-1 group-hover:translate-x-1 transition-transform">
                        {template.title}
                    </h3>
                    <p className="text-xs opacity-60 line-clamp-2 leading-relaxed">
                        {template.description}
                    </p>

                    {/* Subtle arrow indicator */}
                    <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all">
                        <Zap size={14} className="animate-pulse" />
                    </div>
                </button>
            ))}
        </div>
    )
}
