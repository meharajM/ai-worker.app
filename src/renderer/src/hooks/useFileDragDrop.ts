import { useState, useCallback, DragEvent } from 'react'

/**
 * Supported file extensions for MarkItDown conversion
 */
const SUPPORTED_EXTENSIONS = [
    // Documents
    '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp',
    // Audio
    '.mp3', '.wav', '.m4a', '.ogg', '.flac',
    // Web & Data
    '.html', '.htm', '.csv', '.json', '.xml', '.txt', '.md',
    // Other
    '.epub', '.zip'
]

interface UseFileDragDropOptions {
    onFilesDropped: (files: File[]) => void
    validateFiles?: boolean
}

interface UseFileDragDropReturn {
    isDragging: boolean
    dragHandlers: {
        onDragEnter: (e: DragEvent) => void
        onDragLeave: (e: DragEvent) => void
        onDragOver: (e: DragEvent) => void
        onDrop: (e: DragEvent) => void
        onPaste: (e: React.ClipboardEvent) => void
    }
}

/**
 * Custom hook for handling file drag-and-drop functionality
 * 
 * @param options - Configuration options
 * @param options.onFilesDropped - Callback when files are dropped
 * @param options.validateFiles - Whether to validate file extensions (default: true)
 * 
 * @example
 * ```tsx
 * const { isDragging, dragHandlers } = useFileDragDrop({
 *   onFilesDropped: (files) => console.log('Files:', files)
 * })
 * 
 * return <div {...dragHandlers}>Drop files here</div>
 * ```
 */
export function useFileDragDrop({
    onFilesDropped,
    validateFiles = true
}: UseFileDragDropOptions): UseFileDragDropReturn {
    const [isDragging, setIsDragging] = useState(false)

    /**
     * Check if a file has a supported extension
     */
    const isSupportedFile = useCallback((file: File): boolean => {
        const extension = '.' + file.name.split('.').pop()?.toLowerCase()
        return SUPPORTED_EXTENSIONS.includes(extension)
    }, [])

    /**
     * Handle drag enter event
     */
    const handleDragEnter = useCallback((e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
    }, [])

    /**
     * Handle drag leave event
     */
    const handleDragLeave = useCallback((e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        
        // Only set isDragging to false if we're leaving the drop zone entirely
        // This prevents flickering when dragging over child elements
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const x = e.clientX
        const y = e.clientY
        
        if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            setIsDragging(false)
        }
    }, [])

    /**
     * Handle drag over event (required to enable drop)
     */
    const handleDragOver = useCallback((e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    /**
     * Handle drop event
     */
    const handleDrop = useCallback((e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        const files = Array.from(e.dataTransfer.files)
        
        if (files.length === 0) return

        // Filter supported files if validation is enabled
        const validFiles = validateFiles
            ? files.filter(isSupportedFile)
            : files

        if (validFiles.length > 0) {
            onFilesDropped(validFiles)
        }
    }, [onFilesDropped, validateFiles, isSupportedFile])

    /**
     * Handle paste event
     */
    const handlePaste = useCallback((e: any) => {
        const items = Array.from(e.clipboardData?.items || []) as DataTransferItem[]
        const files: File[] = []

        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile()
                if (file) files.push(file)
            }
        }

        // Electron Fallback: If web API yielded no files, try reading paths directly from clipboard
        // This fixes the issue where pasting files (especially on macOS) doesn't work via standard Web APIs
        if (files.length === 0 && window.electron?.clipboard) {
            const paths = window.electron.clipboard.readFilePaths()
            if (paths && paths.length > 0) {
                paths.forEach(path => {
                    // Create a proxy File object
                    // We can't create a real File with content easily, but we have the path
                    // capable of being used by our system which relies on .path
                    const name = path.split('/').pop() || 'unknown_file'
                    
                    // Allow "duck typing" for our internal usage
                    const proxyFile = {
                        name,
                        path, // Important: This is what our app uses
                        type: 'application/octet-stream', // Default
                        size: 0,
                        lastModified: Date.now(),
                        // Mock Blob methods
                        slice: () => new Blob(),
                        stream: () => new ReadableStream(),
                        text: async () => '',
                        arrayBuffer: async () => new ArrayBuffer(0)
                    } as unknown as File
                    
                    files.push(proxyFile)
                })
            }
        }

        if (files.length > 0) {
            // Filter supported files if validation is enabled
            const validFiles = validateFiles
                ? files.filter(isSupportedFile)
                : files
            
            // Note: We might be validating based on name only for proxy files, which is fine

            if (validFiles.length > 0) {
                // Prevent default only if we actually found and handled files
                e.preventDefault()
                onFilesDropped(validFiles)
            }
        }
    }, [onFilesDropped, validateFiles, isSupportedFile])

    return {
        isDragging,
        dragHandlers: {
            onDragEnter: handleDragEnter,
            onDragLeave: handleDragLeave,
            onDragOver: handleDragOver,
            onDrop: handleDrop,
            onPaste: handlePaste
        }
    }
}

/**
 * Generate a prompt for file conversion based on the number of files
 */
export function generateFileConversionPrompt(files: File[]): string {
    // Extract file paths (Electron provides .path property)
    const filePaths = files.map(f => (f as any).path || f.name)
    
    if (files.length === 1) {
        return `Convert this file to markdown: ${filePaths[0]}`
    }
    
    return `Convert these files to markdown:\n${filePaths.map(p => `- ${p}`).join('\n')}`
}
