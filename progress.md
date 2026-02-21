# Browser Setup Wizard - Development Progress

## Overview
Implementation of an initial setup wizard for browser selection and installation when the app first runs. This replaces the previous approach of silently using system browsers with a user-friendly guided setup experience.

## Status: IN PROGRESS (Paused)

---

## Problem Statement

### Original Issue
The app was failing to launch Firefox on Linux without Chromium installed, even when Firefox was specified. The Playwright service was passing Chromium-specific arguments to Firefox (e.g., `--disable-blink-features=AutomationControlled`), which Firefox doesn't understand.

### Root Cause Analysis
1. **Chromium args passed to all browsers**: The launch options were browser-agnostic, causing Firefox launch failures
2. **No guided browser setup**: Users had to manually install Playwright browsers via CLI
3. **Auto-detect could fail silently**: If no browsers were installed, the app would fail without clear guidance

---

## Implementation Details

### Files Created

#### `src/main/ipc/browserManager.ts`
**Purpose**: Main process IPC handlers for browser management

**Features**:
- `checkBrowserStatus(browser)` - Check if a specific browser is installed
- `checkAllBrowserStatuses()` - Check all Playwright browsers (chrome, msedge, firefox, webkit, chromium)
- `installBrowser(browser)` - Install browser via `npx playwright install <browser>`
- `getInstallCommand(browser)` - Get manual install command for documentation

**Browser Detection Logic**:
- For bundled browsers (chromium, firefox, webkit): Check if Playwright's bundled executable exists
- For system browsers (chrome, msedge): Attempt to launch with channel to verify system installation

---

#### `src/renderer/src/components/InitialSetup.tsx`
**Purpose**: 4-step wizard UI for first-run browser setup

**Steps**:
1. **Welcome** - Introduction with "Get Started" or "Skip" options
2. **Browser Selection** - Cards for Chrome, Firefox, Chromium (bundled), Edge
3. **Installation** - Progress indicator with error handling
4. **Complete** - Success confirmation and next steps

**Key Features**:
- Progress indicator at top showing current step
- Browser selection with icons and descriptions
- Real-time installation progress
- Error recovery (choose different browser or skip)
- Skip option available at every step

---

#### `src/renderer/src/hooks/useBrowserAvailability.ts`
**Purpose**: Hook to check if any Playwright browser is available

**Note**: Currently not used in main flow (was part of auto-skip logic that was removed). May be useful for future enhancements.

---

### Files Modified

#### `src/main/services/PlaywrightService.ts`
**Changes**: Separated browser-specific launch options

**Before** (problematic):
```typescript
const launchOptions = {
    headless: headless,
    args: [
        '--disable-blink-features=AutomationControlled', // Chromium-only!
        '--no-sandbox',
        // ... other args
    ]
}
// Same options passed to ALL browsers
```

**After** (fixed):
```typescript
const getChromiumOptions = () => ({
    args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // ... chromium-specific args
    ]
})

const getFirefoxOptions = () => ({
    args: [
        '--no-sandbox',
        '--window-position=0,0',
    ]
})

const getWebkitOptions = () => ({
    // Minimal options for WebKit
})
```

---

#### `src/renderer/src/App.tsx`
**Changes**: Added setup wizard gate with reliable state management

**Key Logic**:
```typescript
// Dedicated store key, separate from zustand settings blob
const SETUP_STORE_KEY = 'ai-worker-setup-completed'

function App() {
  const [setupChecked, setSetupChecked] = useState(false)
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false)

  // Read directly from electron-store on mount (not zustand)
  useEffect(() => {
    const completed = await electron.store.get<boolean>(SETUP_STORE_KEY)
    setHasCompletedSetup(!!completed)
    setSetupChecked(true)
  }, [])

  if (!setupChecked) return <LoadingSpinner />
  if (!hasCompletedSetup) return <InitialSetup onComplete={...} />
  return <MainApp />
}
```

**Why Not Zustand?**: The zustand persist middleware uses async IPC. React renders with defaults first, then async rehydration fires. This caused race conditions where the wizard would flash or not show at all.

---

#### `src/renderer/src/components/settings/McpPreferencesPanel.tsx`
**Changes**: Added browser status display and install button in settings

**Features**:
- Shows installed/not-installed status for selected browser
- "Install" button appears when browser not installed
- Re-checks status when browser selection changes
- Error display for failed installations

---

#### `src/preload/index.ts`
**Changes**: Added browser IPC channel definitions

```typescript
browser: {
    checkStatus: (browser) => ipcRenderer.invoke('browser:check-status', browser),
    checkAllStatuses: () => ipcRenderer.invoke('browser:check-all-statuses'),
    install: (browser) => ipcRenderer.invoke('browser:install', browser),
    getInstallCommand: (browser) => ipcRenderer.invoke('browser:get-install-command', browser),
},
```

---

#### `src/renderer/src/lib/electron.ts`
**Changes**: Added browser API wrapper for renderer process

---

#### `src/renderer/src/env.d.ts`
**Changes**: Added TypeScript definitions for browser API

---

#### `src/main/ipc/index.ts`
**Changes**: Registered browser manager handlers

```typescript
import { registerBrowserManagerHandlers } from './browserManager'
// ...
registerBrowserManagerHandlers()
```

---

#### `src/renderer/src/stores/settingsStore.ts`
**Changes**: Removed `hasCompletedSetup` from zustand store

**Reason**: Moved to dedicated electron-store key to avoid async rehydration race conditions.

---

## Known Issues / TODOs

### 1. Firefox Installation on Linux
- Playwright's bundled Firefox may still have issues on some Linux distros
- System Firefox detection could be improved
- Consider offering to use system Firefox with `executablePath` option

### 2. Installation Progress
- Current implementation shows generic "Installing..." text
- Could be enhanced with actual progress percentage from `npx playwright install`

### 3. Offline Scenarios
- Browser installation requires internet connection
- No offline mode or pre-bundled browser fallback

### 4. Error Handling
- Installation errors are displayed but could be more user-friendly
- Could offer retry logic or alternative suggestions

### 5. Testing
- No automated tests for the setup wizard
- Manual testing required on each platform (Windows, macOS, Linux)

---

## Testing Notes

### Manual Testing Performed
- TypeScript compilation: ✅ Passing
- Build: ✅ Successful
- Linux Firefox issue: ✅ Fixed (args separation)

### Testing Required
- [ ] Windows - Edge detection and installation
- [ ] macOS - Chrome/Safari detection
- [ ] Linux - Firefox/Chrome detection
- [ ] Fresh install (no previous settings)
- [ ] Upgrade from previous version
- [ ] Skip flow
- [ ] Error recovery flow
- [ ] Settings panel install button

---

## Rollback Instructions

If issues arise, the feature can be easily disabled:

1. In `App.tsx`, change:
```typescript
// Always skip wizard
const [hasCompletedSetup, setHasCompletedSetup] = useState(true)
```

2. The original Playwright fallback logic still works independently

---

## Future Enhancements

1. **Progress Bar**: Show actual download progress during browser installation
2. **Custom Executable Path**: Allow users to specify their own browser path
3. **Browser Profiles**: Support for multiple browser profiles
4. **Ad Blocker Toggle**: Option to enable/disable ad blocking per browser
5. **Browser Extensions**: Pre-configure useful extensions for automation
6. **Mobile Emulation**: Add mobile device emulation options in setup

---

## Commit History

All changes are on branch `feat/browser-setup-wizard`:

1. Fix Firefox launch - separate browser-specific args
2. Add browser manager IPC handlers
3. Add initial setup wizard component
4. Add browser availability hook
5. Update preload and electron wrapper
6. Add TypeScript definitions
7. Update settings panel with install button
8. Fix state management - move setup flag to dedicated store key

---

## References

- [Playwright Browsers](https://playwright.dev/docs/browsers)
- [Playwright CLI](https://playwright.dev/docs/cli)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Zustand Persist](https://docs.pmnd.rs/zustand/integrations/persisting-store-data)
