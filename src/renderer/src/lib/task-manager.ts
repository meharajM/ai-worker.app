import { ExecutionPlan } from "./agent-protocol";
import electron from "./electron";

/**
 * Syncs the internal ExecutionPlan to a JSON file 
 * in AI-Worker's hidden internal system workspace (`~/.ai-worker/system-workspace/.../tasks.json`).
 * 
 * Bypasses Safe Mode so the user isn't prompted for every step.
 */
export async function syncPlanToFile(workspacePath: string | undefined, plan: ExecutionPlan | null): Promise<void> {
    if (!workspacePath || !plan) return;

    try {
        await electron.fs.writeInternalFile(workspacePath, 'tasks.json', JSON.stringify(plan, null, 2));
    } catch (e) {
        console.warn('[TaskManager] Failed to sync tasks.json to workspace:', e);
    }
}
