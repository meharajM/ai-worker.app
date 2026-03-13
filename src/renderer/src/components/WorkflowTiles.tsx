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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 animate-in fade-in slide-in-from-bottom-4 duration-slow">
            {templates.map((template) => (
                <button
                    key={template.id}
                    onClick={() => handleTileClick(template.prompt)}
                    className={`
                        flex flex-col items-start text-left p-4 rounded-tile border 
                        bg-[var(--color-surface)] border-[var(--color-border)]
                        hover:border-[var(--color-border-hover)] hover:bg-[var(--color-card-dark)]
                        hover:shadow-glass 
                        transition-all duration-slow group relative overflow-hidden
                    `}
                >
                    {/* Glassmorphism Background Effect */}
                    <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-surface)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-slow" />

                    <div className={`mb-3 p-2.5 rounded-xl bg-[var(--color-surface)] group-hover:bg-[var(--color-border)] transition-colors duration-slow`}>
                        <div className={`${template.color.split(' ')[0]} group-hover:scale-110 transition-transform duration-slow`}>
                           {ICON_MAP[template.iconName] || <Zap size={18} />}
                        </div>
                    </div>

                    <div className="flex-1 w-full">
                        <h3 className="font-bold text-sm text-[var(--color-text-primary)] mb-1.5 group-hover:translate-x-1 transition-transform duration-slow">
                            {template.title}
                        </h3>
                        <p className="text-[11px] text-[var(--color-text-muted)] line-clamp-2 leading-relaxed group-hover:text-[var(--color-text-secondary)] transition-colors duration-slow">
                            {template.description}
                        </p>
                    </div>

                    {/* Subtle arrow indicator */}
                    <div className="absolute top-5 right-5 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-slow">
                        <ChevronRight size={14} className="text-[var(--color-text-muted)]" />
                    </div>
                    
                    {/* Bottom accent line */}
                    <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-[var(--color-primary)] group-hover:w-full transition-all duration-slow" />
                </button>
            ))}
        </div>
    )
}
