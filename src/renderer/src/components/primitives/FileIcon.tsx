import React from 'react'
import {
  File,
  FileAudio,
  FileImage,
  FileText,
  FileSpreadsheet,
} from 'lucide-react'

interface FileIconProps {
  /** MIME type (e.g. 'audio/mp3', 'image/png') */
  type: string
  /** Filename — used as fallback for extension-based detection */
  name: string
  /** Icon size in pixels */
  size?: number
}

/**
 * Returns the appropriate Lucide file icon based on MIME type or file extension.
 *
 * WHY: This logic was embedded inside MessageBubble.getFileIcon as a render
 * helper. Extracting it makes it reusable in AttachmentBar, file pickers, etc.
 */
export function FileIcon({ type, name, size = 14 }: FileIconProps) {
  const lowerType = type.toLowerCase()
  const lowerName = name.toLowerCase()

  if (
    lowerType.includes('audio') ||
    lowerName.endsWith('.mp3') ||
    lowerName.endsWith('.wav') ||
    lowerName.endsWith('.m4a')
  ) {
    return <FileAudio size={size} className="text-blue-400" />
  }

  if (
    lowerType.includes('image') ||
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg')
  ) {
    return <FileImage size={size} className="text-purple-400" />
  }

  if (
    lowerType.includes('sheet') ||
    lowerType.includes('excel') ||
    lowerType.includes('csv') ||
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.xlsx')
  ) {
    return <FileSpreadsheet size={size} className="text-green-400" />
  }

  if (
    lowerType.includes('text') ||
    lowerType.includes('pdf') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.pdf')
  ) {
    return <FileText size={size} className="text-orange-400" />
  }

  return <File size={size} className="text-gray-400" />
}
