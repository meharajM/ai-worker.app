/**
 * media-utils.ts — Centralized, plug-and-play media classification and LLM payload building.
 *
 * This module is the single source of truth for:
 *   1. Classifying any file by extension into a canonical MediaType
 *   2. Building LLM-ready content parts from file paths
 *   3. Generating human-readable descriptions for each media type
 *
 * Used by: WhatsApp integration, regular UI file drops, history reconstruction.
 * Has zero dependencies on WhatsApp — works globally across the app.
 */

import type { LLMContentPart } from './types';

// ─── Canonical Media Types ───────────────────────────────────────────────────

export type MediaType =
    | 'image'
    | 'audio'
    | 'video'
    | 'spreadsheet'
    | 'document'
    | 'archive'
    | 'code'
    | 'binary';

// ─── Extension Maps ──────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'avif', 'heic', 'heif']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus', 'wma', 'aiff']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v', '3gp', 'mts']);
const SPREADSHEET_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'tsv', 'ods', 'numbers', 'gsheet']);
const DOCUMENT_EXTS = new Set(['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'ppt', 'pptx', 'odp', 'pages', 'epub']);
const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'tar.gz', 'tgz']);
const CODE_EXTS = new Set(['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'sh', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'sql']);

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classifies a file by its extension into a canonical MediaType.
 * Works with both filenames ('report.xlsx') and full paths ('/tmp/wa_media.pdf').
 */
export function classifyFileByExtension(fileNameOrPath: string): MediaType {
    const ext = fileNameOrPath.split('.').pop()?.toLowerCase() ?? '';
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (SPREADSHEET_EXTS.has(ext)) return 'spreadsheet';
    if (DOCUMENT_EXTS.has(ext)) return 'document';
    if (ARCHIVE_EXTS.has(ext)) return 'archive';
    if (CODE_EXTS.has(ext)) return 'code';
    return 'binary';
}

/**
 * Classifies a file using its MIME type (from browser File objects),
 * falling back to extension-based classification.
 */
export function classifyFile(file: { name: string; type?: string }): MediaType {
    const mime = file.type ?? '';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (
        mime.includes('spreadsheet') ||
        mime.includes('excel') ||
        mime === 'text/csv' ||
        mime === 'text/tab-separated-values'
    ) return 'spreadsheet';
    if (
        mime.startsWith('text/') ||
        mime.includes('pdf') ||
        mime.includes('word') ||
        mime.includes('presentation') ||
        mime.includes('opendocument')
    ) return 'document';
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip') || mime.includes('7z')) return 'archive';
    // Fallback to extension
    return classifyFileByExtension(file.name);
}

// ─── LLM Payload Builder ─────────────────────────────────────────────────────

/**
 * Builds LLM content parts for a file at the given absolute local path.
 * This is the core function consumed by all parts of the app.
 *
 * @param localPath  Absolute local filesystem path (NO file:// prefix)
 * @param mediaType  Pre-classified type (call classifyFileByExtension if unknown)
 * @param caption    Optional user-provided caption/text alongside the file
 */
export function buildMediaLLMParts(
    localPath: string,
    mediaType: MediaType,
    caption?: string
): LLMContentPart[] {
    const parts: LLMContentPart[] = [];

    switch (mediaType) {
        case 'image':
            parts.push({
                type: 'image_url',
                image_url: { url: `file://${localPath}` }
            });
            // Always provide the path so the LLM can reference the file in tools
            parts.push({
                type: 'text',
                text: `[Image saved locally at: ${localPath}]`
            });
            break;

        case 'audio':
            parts.push({
                type: 'text',
                text: `[User attached an audio file: ${localPath}. Use convert_to_markdown to transcribe it.]`
            });
            break;

        case 'video':
            parts.push({
                type: 'text',
                text: `[User attached a video file: ${localPath}. Use convert_to_markdown to extract audio/captions if needed.]`
            });
            break;

        case 'spreadsheet':
            parts.push({
                type: 'text',
                text: `[User attached a spreadsheet (Excel/CSV): ${localPath}. Use convert_to_markdown to read its tabular data.]`
            });
            break;

        case 'document':
            parts.push({
                type: 'text',
                text: `[User attached a document: ${localPath}. Use convert_to_markdown to read its content.]`
            });
            break;

        case 'code':
            parts.push({
                type: 'text',
                text: `[User attached a code/text file: ${localPath}. Use convert_to_markdown or read_file to read it.]`
            });
            break;

        case 'archive':
            parts.push({
                type: 'text',
                text: `[User attached an archive/zip file: ${localPath}. Use convert_to_markdown to inspect its contents if supported.]`
            });
            break;

        default:
            parts.push({
                type: 'text',
                text: `[User attached a file: ${localPath}]`
            });
    }

    if (caption && caption !== '[Media Message]') {
        parts.push({ type: 'text', text: caption });
    }

    return parts;
}

/**
 * Converts a list of attachments (from chat store) back into LLM content parts.
 * Used for history reconstruction — keeps multi-turn context intact.
 *
 * @param attachments  Array of { name, path, type } from the chat store message
 * @param textContent  Original text content of the message (appended at the end)
 */
export function buildAttachmentLLMParts(
    attachments: { name: string; path: string; type: string }[],
    textContent?: string
): LLMContentPart[] {
    const parts: LLMContentPart[] = [];

    for (const att of attachments) {
        // att.type may be a MIME string ('image/jpeg') or a canonical MediaType ('spreadsheet')
        // Normalize to canonical type
        const mediaType = normalizeAttachmentType(att.type, att.name);
        const attParts = buildMediaLLMParts(att.path, mediaType);
        parts.push(...attParts);
    }

    if (textContent && textContent !== '[Media Message]') {
        parts.push({ type: 'text', text: textContent });
    }

    return parts;
}

// ─── Type Normalization ───────────────────────────────────────────────────────

/**
 * Normalizes a raw type string (MIME or canonical) into a MediaType.
 * Handles: 'image/jpeg', 'spreadsheet', 'application/pdf', 'audio', etc.
 */
export function normalizeAttachmentType(rawType: string, fileName?: string): MediaType {
    // Already a canonical MediaType
    const CANONICAL: MediaType[] = ['image', 'audio', 'video', 'spreadsheet', 'document', 'archive', 'code', 'binary'];
    if (CANONICAL.includes(rawType as MediaType)) return rawType as MediaType;

    // MIME type
    if (rawType.startsWith('image/')) return 'image';
    if (rawType.startsWith('audio/')) return 'audio';
    if (rawType.startsWith('video/')) return 'video';
    if (rawType.includes('spreadsheet') || rawType.includes('excel') || rawType === 'text/csv') return 'spreadsheet';
    if (rawType.includes('pdf') || rawType.includes('word') || rawType.includes('presentation') || rawType.startsWith('text/')) return 'document';
    if (rawType.includes('zip') || rawType.includes('tar') || rawType.includes('gzip')) return 'archive';

    // Fallback to file extension
    if (fileName) return classifyFileByExtension(fileName);
    return 'binary';
}

// ─── WhatsApp Compatibility Helper ───────────────────────────────────────────

/**
 * The WhatsApp type union uses 'document' as a catch-all for non-spreadsheet files.
 * This maps it cleanly back to MediaType for unified processing.
 */
export function whatsappTypeToMediaType(
    waType: 'text' | 'image' | 'video' | 'document' | 'audio' | 'spreadsheet',
    fileName?: string
): MediaType {
    if (waType === 'text') return 'document'; // fallback; caller should not call for 'text'
    if (waType === 'spreadsheet') return 'spreadsheet';
    if (waType === 'document' && fileName) return classifyFileByExtension(fileName);
    return waType as MediaType; // 'image', 'audio', 'video' are identical
}
