import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

interface ModelSelectProps {
    value: string
    onChange: (value: string) => void
    models: string[]
    placeholder?: string
    disabled?: boolean
    ariaLabel?: string
}

export function ModelSelect({ value, onChange, models, placeholder = 'Select or type model name', disabled = false, ariaLabel }: ModelSelectProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')
    const [customValue, setCustomValue] = useState('')
    const containerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Filter models based on search term
    const filteredModels = models.filter(model =>
        model.toLowerCase().includes(searchTerm.toLowerCase())
    )

    // Check if current value is in the models list
    const isCustomModel = value && !models.includes(value)

    // Handle click outside to close dropdown
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
                setSearchTerm('')
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    // Focus input when dropdown opens
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus()
        }
    }, [isOpen])

    const handleSelect = (model: string) => {
        onChange(model)
        setIsOpen(false)
        setSearchTerm('')
        setCustomValue('')
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value
        setSearchTerm(newValue)
        setCustomValue(newValue)
    }

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (filteredModels.length === 1) {
                handleSelect(filteredModels[0])
            } else if (searchTerm.trim()) {
                // Use search term as custom value
                onChange(searchTerm.trim())
                setIsOpen(false)
                setSearchTerm('')
                setCustomValue('')
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false)
            setSearchTerm('')
            setCustomValue('')
        } else if (e.key === 'ArrowDown' && filteredModels.length > 0) {
            e.preventDefault()
            // Focus first option
            const firstOption = containerRef.current?.querySelector('[role="option"]') as HTMLElement
            firstOption?.focus()
        }
    }

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation()
        onChange('')
        setSearchTerm('')
        setCustomValue('')
    }

    const displayValue = isCustomModel ? value : (searchTerm || value || '')

    return (
        <div ref={containerRef} className="relative w-full">
            <div className="relative">
                <div
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                    className={`
                        w-full bg-black/30 border rounded-lg px-3 py-2 text-sm
                        flex items-center gap-2 cursor-pointer
                        ${disabled 
                            ? 'border-white/5 text-white/30 cursor-not-allowed' 
                            : isOpen
                                ? 'border-[#4fd1c5]/50 bg-black/40'
                                : 'border-white/10 text-white hover:border-white/20'
                        }
                        transition-colors
                    `}
                >
                    <Search size={16} className="text-white/40 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={displayValue}
                        onChange={handleInputChange}
                        onKeyDown={handleInputKeyDown}
                        onFocus={() => !disabled && setIsOpen(true)}
                        disabled={disabled}
                        placeholder={placeholder}
                        aria-label={ariaLabel || 'Model selection'}
                        className="flex-1 bg-transparent outline-none text-white placeholder-white/30"
                        onClick={(e) => e.stopPropagation()}
                    />
                    {value && !disabled && (
                        <button
                            onClick={handleClear}
                            className="p-0.5 hover:bg-white/10 rounded transition-colors"
                            aria-label="Clear selection"
                        >
                            <X size={14} className="text-white/40" />
                        </button>
                    )}
                    <ChevronDown 
                        size={16} 
                        className={`text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                </div>
            </div>

            {isOpen && !disabled && (
                <div className="absolute z-50 w-full mt-1 bg-[#1a1d23] border border-white/10 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {filteredModels.length > 0 ? (
                        <>
                            {filteredModels.map((model) => (
                                <div
                                    key={model}
                                    role="option"
                                    onClick={() => handleSelect(model)}
                                    className={`
                                        px-3 py-2 text-sm cursor-pointer
                                        hover:bg-white/10 transition-colors
                                        ${value === model ? 'bg-[#4fd1c5]/10 text-[#4fd1c5]' : 'text-white'}
                                    `}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            handleSelect(model)
                                        }
                                    }}
                                    tabIndex={0}
                                >
                                    {model}
                                </div>
                            ))}
                            {searchTerm && !filteredModels.includes(searchTerm) && (
                                <div
                                    role="option"
                                    onClick={() => handleSelect(searchTerm)}
                                    className="px-3 py-2 text-sm cursor-pointer hover:bg-white/10 transition-colors text-white/60 border-t border-white/5"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            handleSelect(searchTerm)
                                        }
                                    }}
                                    tabIndex={0}
                                >
                                    <span className="text-[#4fd1c5]">Use custom:</span> {searchTerm}
                                </div>
                            )}
                        </>
                    ) : searchTerm ? (
                        <div
                            role="option"
                            onClick={() => handleSelect(searchTerm)}
                            className="px-3 py-2 text-sm cursor-pointer hover:bg-white/10 transition-colors text-white/60"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    handleSelect(searchTerm)
                                }
                            }}
                            tabIndex={0}
                        >
                            <span className="text-[#4fd1c5]">Use custom:</span> {searchTerm}
                        </div>
                    ) : (
                        <div className="px-3 py-2 text-sm text-white/40">
                            No models found. Type to enter custom model name.
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

