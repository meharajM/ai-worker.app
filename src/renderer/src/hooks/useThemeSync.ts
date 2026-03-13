import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * Applies the user's chosen theme to the document root element.
 *
 * Sets `data-theme="dark"` or `data-theme="light"` on `<html>` so that
 * CSS custom properties in design-tokens.css switch automatically.
 *
 * For 'system' mode, resolves the actual preference via `matchMedia` and
 * listens for OS-level color-scheme changes.
 */
export function useThemeSync(): void {
  const theme = useSettingsStore(state => state.theme)

  useEffect(() => {
    const root = document.documentElement

    const applyTheme = (resolved: 'dark' | 'light') => {
      root.setAttribute('data-theme', resolved)
    }

    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mql.matches ? 'dark' : 'light')

      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light')
      }
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }

    applyTheme(theme)
  }, [theme])
}
