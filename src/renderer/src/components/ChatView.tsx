/**
 * Backwards-compatibility re-export.
 *
 * ChatView has been decomposed into atomic sub-components in the chat/ directory.
 * This file re-exports from the new location so existing imports continue to work.
 *
 * New code should import from './chat/ChatView' or './chat' directly.
 */
export { ChatView } from './chat/ChatView'
