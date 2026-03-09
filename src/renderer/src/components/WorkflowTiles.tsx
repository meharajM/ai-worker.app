import React from 'react'
import {
    Search,
    ShoppingCart,
    Code,
    FileText,
    Layers,
    Database,
    Globe,
    Zap,
    ChevronRight
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
        const event = new CustomEvent('populate-chat-input', { detail: { prompt} })
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
                        flex flex-col items-start text-left p-5 rounded-3xl border 
                        bg-[var(--color-surface)] border-[var(--color-border)]
                        hover:border-[var(--color-border-hover)] hover:bg-[var(--color-card-dark)]
                        hover:shadow-2xl hover:shadow-black/40 
                        transition-all duration-500 group relative overflow-hidden
                    `}
                >
                    {/* Glassmorphism Background Effect */}
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                    <div className={`mb-4 p-3 rounded-2xl bg-white/5 group-hover:bg-white/10 transition-colors duration-500`}>
                        <div className={`${template.color.split(' ')[0]} group-hover:scale-110 transition-transform duration-500`}>
                           {ICON_MAP[template.iconName] || <Zap size={20} />}
                        </div>
                    </div>

                    <div className="flex-1 w-full">
                        <h3 className="font-bold text-sm text-white/90 mb-1.5 group-hover:translate-x-1 transition-transform duration-500">
                            {template.title}
                        </h3>
                        <p className="text-[11px] text-white/40 line-clamp-2 leading-relaxed group-hover:text-white/50 transition-colors duration-500">
                            {template.description}
                        </p>
                    </div>

                    {/* Subtle arrow indicator */}
                    <div className="absolute top-5 right-5 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-500">
                        <ChevronRight size={14} className="text-white/40" />
                    </div>
                    
                    {/* Bottom accent line */}
                    <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-[var(--color-primary)] group-hover:w-full transition-all duration-500" />
                </button>
            ))}
        </div>
    )
}
