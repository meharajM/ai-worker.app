/**
 * Backwards-compatibility re-export.
 *
 * VoiceInput has been decomposed into atomic sub-components in the input/ directory.
 * This file re-exports ChatInput as VoiceInput so existing imports continue to work.
 *
 * New code should import from './input/ChatInput' or './input' directly.
 */
export { ChatInput as VoiceInput } from './input/ChatInput'
