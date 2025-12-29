# Feature Flags Testing Guide

## Overview
The feature flags panel has been successfully implemented and integrated into the settings page. This guide explains how to test and verify that the feature flags are working correctly.

## Implementation Summary

### ✅ Completed Features:
1. **Feature Flags Panel Component** - Interactive UI for managing flags
2. **Development Mode Detection** - Panel only appears in development mode  
3. **LocalStorage Persistence** - Flag changes are saved and persist across restarts
4. **Dynamic Flag Loading** - Flags are refreshed when changes are saved
5. **Categorized Display** - Flags grouped by Authentication, Voice, LLM, Rate Limiting
6. **Save/Reset Functionality** - Users can save changes or reset to defaults

### 🔧 Key Files Modified:
- `src/renderer/src/components/FeatureFlagsPanel.tsx` - Main panel component
- `src/renderer/src/lib/featureFlags.ts` - Development mode detection and localStorage utilities
- `src/renderer/src/lib/constants.ts` - Dynamic feature flags with getFeatureFlags() function
- `src/renderer/src/components/SettingsPanel.tsx` - Integration with settings sidebar

## How to Test

### 1. Verify Development Mode Detection
```bash
# Run in development mode
npm run dev

# The feature flags panel should appear in Settings
# It will NOT appear in production builds
```

### 2. Test Feature Flags Panel
1. Open the app with `npm run dev`
2. Go to Settings → Feature Flags
3. You should see 6 feature flags:
   - **Authentication**: AUTH_ENABLED
   - **Voice**: TTS_ENABLED  
   - **LLM**: OLLAMA_ENABLED, CLOUD_LLM_ENABLED, BROWSER_LLM_ENABLED
   - **Rate Limiting**: RATE_LIMITING_ENABLED

### 3. Test Flag Functionality
1. **Toggle a flag** (e.g., disable TTS_ENABLED)
2. **Click "Save Changes"**
3. **Check localStorage** in browser console:
   ```javascript
   localStorage.getItem('ai-worker-dev-flags')
   ```
4. **Restart the app** - changes should persist
5. **Verify the feature** - if you disabled TTS, AI responses should not be spoken

### 4. Test Each Flag's Impact

#### AUTH_ENABLED
- **Enabled**: Account section appears in Settings, login/logout functionality available
- **Disabled**: Account section hidden, app works in anonymous mode

#### TTS_ENABLED  
- **Enabled**: AI responses are automatically read aloud
- **Disabled**: No text-to-speech, voice mute button hidden

#### OLLAMA_ENABLED
- **Enabled**: Ollama models available in LLM provider selection
- **Disabled**: Ollama options hidden from provider list

#### CLOUD_LLM_ENABLED
- **Enabled**: OpenAI-compatible API options available
- **Disabled**: Cloud LLM options hidden from provider list

#### BROWSER_LLM_ENABLED
- **Enabled**: Browser-native LLM options (Gemini Nano, Phi) available
- **Disabled**: Browser LLM options hidden

#### RATE_LIMITING_ENABLED
- **Enabled**: Usage limits enforced for anonymous users
- **Disabled**: No rate limiting, unlimited usage

### 5. Test Edge Cases
- **Reset Functionality**: Click "Reset" to restore original values
- **Invalid localStorage**: Corrupt the stored data and verify app still works
- **Production Mode**: Build the app and verify feature flags panel is hidden

## Browser Console Testing
Run this script in the browser console to test functionality:
```javascript
// Load the test script
fetch('/feature-flags-test.js').then(r => r.text()).then(eval);
```

## Expected Behavior
- ✅ Feature flags panel only appears in development mode
- ✅ All 6 feature flags are displayed and toggleable
- ✅ Changes are saved to localStorage immediately
- ✅ Features respond to flag changes after app restart
- ✅ Reset button restores original flag values
- ✅ Panel is hidden in production builds

## Troubleshooting
- **Panel not appearing**: Check that you're running `npm run dev` (not `npm run build`)
- **Changes not persisting**: Check browser localStorage limits and permissions
- **Features not updating**: Remember that most changes require app restart
- **TypeScript errors**: Run `npm run typecheck` to verify no type issues