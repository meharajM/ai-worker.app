/**
 * Backwards-compatibility re-export.
 *
 * The MessageBubble component has been decomposed into atomic sub-components
 * in the chat/ directory. This file re-exports from the new location so
 * existing imports continue to work.
 *
 * New code should import from './chat/MessageBubble' or './chat' directly.
 */
export { MessageBubble } from './chat/MessageBubble'
