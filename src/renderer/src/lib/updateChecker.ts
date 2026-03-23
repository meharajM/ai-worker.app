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

export async function checkUpdateAvailable(
  updateUrl: string = 'https://raw.githubusercontent.com/mhrj/ai-worker/main/update.json'
): Promise<{ available: boolean; config?: UpdateConfig; forceUpdate: boolean }> {
  try {
    const response = await fetch(updateUrl)
    if (!response.ok) return { available: false, forceUpdate: false }

    const config: UpdateConfig = await response.json()
    const currentVersionStr = await electron.getVersion()
    
    const currentVersion = parseVersion(currentVersionStr)
    const latestVersion = parseVersion(config.latestVersion)
    const minRequired = config.minRequiredVersion ? parseVersion(config.minRequiredVersion) : 0

    const isForceUpdate = currentVersion < minRequired

    // If current version is already greater or equal to latest, no update
    if (currentVersion >= latestVersion) {
      return { available: false, forceUpdate: false }
    }

    // Check rollout percentage (1-100)
    // If the rollout is 25%, users with rolloutId 1-25 will get it.
    const rolloutId = await getRolloutId()
    const includedInRollout = rolloutId <= config.rolloutPercentage

    if (!includedInRollout && !isForceUpdate) {
      return { available: false, forceUpdate: false }
    }

    return {
      available: true,
      config,
      forceUpdate: isForceUpdate
    }
  } catch (error) {
    console.error('Failed to check for updates:', error)
    return { available: false, forceUpdate: false }
  }
}
