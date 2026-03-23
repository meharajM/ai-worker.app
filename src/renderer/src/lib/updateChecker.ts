import electron from './electron'

export interface UpdateConfig {
  latestVersion: string
  rolloutPercentage: number
  downloadUrl: string
  minRequiredVersion?: string
  isRollback?: boolean
  releaseNotes?: string
}

// Ensure every install gets a stable rollout ID (1-100)
async function getRolloutId(): Promise<number> {
  let id = await electron.store.get<number>('system.rolloutId')
  if (!id) {
    id = Math.floor(Math.random() * 100) + 1
    await electron.store.set('system.rolloutId', id)
  }
  return id
}

// E.g. "0.1.0" -> 100
function parseVersion(v: string): number {
  const parts = v.replace(/[^0-9.]/g, '').split('.').map(Number)
  let score = 0
  if (parts[0]) score += parts[0] * 1000000
  if (parts[1]) score += parts[1] * 1000
  if (parts[2]) score += parts[2]
  return score
}

// Helper function to compare versions
function isNewerVersion(newVersion: string, currentVersion: string): boolean {
  const newParts = newVersion.split('.').map(Number);
  const currentParts = currentVersion.split('.').map(Number);

  for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
    const newPart = newParts[i] || 0;
    const currentPart = currentParts[i] || 0;

    if (newPart > currentPart) {
      return true;
    }
    if (newPart < currentPart) {
      return false;
    }
  }
  return false; // Versions are the same
}

export async function checkUpdateAvailable(
  updateUrl?: string
): Promise<{ available: boolean; config?: UpdateConfig; forceUpdate: boolean }> {
  const url = updateUrl || (typeof import.meta !== 'undefined' && import.meta.env?.DEV 
    ? '/mock-update.json' 
    : 'https://raw.githubusercontent.com/meharajM/ai-worker/main/update.json')

  try {
    const response = await fetch(url)
    if (!response.ok) return { available: false, forceUpdate: false }

    const config: UpdateConfig = await response.json()
    console.log('[updateChecker] Config received:', config)

    // Use window.electron safely
    const electronApp = window.electron?.app
    if (!electronApp) {
      console.error('[updateChecker] window.electron.app is not available')
      return { available: false, forceUpdate: false }
    }

    const currentVersionStr = await electronApp.getVersion()
    console.log('[updateChecker] Current version:', currentVersionStr)
    
    const userRolloutId = (await getRolloutId()) as number
    console.log('[updateChecker] User rolloutId:', userRolloutId)

    const currentVersionScore = parseVersion(currentVersionStr)
    const latestVersionScore = parseVersion(config.latestVersion)
    const minRequiredScore = config.minRequiredVersion ? parseVersion(config.minRequiredVersion) : 0

    const isForceUpdate = currentVersionScore < minRequiredScore
    const hasNewVersion = latestVersionScore > currentVersionScore
    const isRolloutBucket = userRolloutId <= (config.rolloutPercentage || 100)
    
    console.log('[updateChecker] isRolloutBucket:', isRolloutBucket, 'hasNewVersion:', hasNewVersion, 'isForceUpdate:', isForceUpdate)

    const available = hasNewVersion && (isRolloutBucket || isForceUpdate)

    return {
      available,
      config,
      forceUpdate: isForceUpdate
    }
  } catch (error) {
    console.error('Failed to check for updates:', error)
    return { available: false, forceUpdate: false }
  }
}
