/**
 * useDisplayMode.ts — Derives whether the UI should render in "prod" view.
 *
 * Centralises the display-mode logic so components don't duplicate the check:
 *   shouldShowProdView = displayMode === 'prod' || devPreviewProd
 *
 * WHY a hook instead of inline: multiple components need this (MessageBubble,
 * ChatView, ProgressBanner, Header toggle) and the derivation should live
 * in one place to prevent drift.
 */

import { useSettingsStore } from '../stores/settingsStore'

/**
 * Returns display mode helpers.
 * - `isProdView`: true when the UI should hide dev internals
 * - `isDevMode`: true when the underlying mode is 'dev' (controls toggle visibility)
 * - `isPreviewingProd`: true when dev mode is previewing prod
 */
export function useDisplayMode() {
  const displayMode = useSettingsStore((s) => s.displayMode)
  const devPreviewProd = useSettingsStore((s) => s.devPreviewProd)

  return {
    isProdView: displayMode === 'prod' || devPreviewProd,
    isDevMode: displayMode === 'dev',
    isPreviewingProd: devPreviewProd,
  }
}
