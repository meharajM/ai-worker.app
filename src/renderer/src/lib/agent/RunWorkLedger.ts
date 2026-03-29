/**
 * RunWorkLedger - A salvage mechanism for agent execution.
 * 
 * Tracks "meaningful" work done during an agent run so that if the run is 
 * aborted or fails, we can still present the user with the value generated.
 */

export interface Finding {
    type: 'tool_result' | 'llm_insight' | 'subagent_report' | 'error'
    content: string
    timestamp: number
    metadata?: Record<string, unknown>
}

export class RunWorkLedger {
    private findings: Finding[] = []
    private startTime: number
    private taskGoal: string
    private lastError: string | null = null

    constructor(taskGoal: string) {
        this.taskGoal = taskGoal
        this.startTime = Date.now()
    }

    /**
     * Record a tool execution result if it contains useful info
     */
    recordToolResult(toolName: string, result: unknown) {
        let summary = ''
        if (typeof result === 'string') {
            summary = result.substring(0, 400)
        } else if (result && typeof result === 'object') {
            summary = JSON.stringify(result).substring(0, 400)
        }

        if (summary) {
            this.findings.push({
                type: 'tool_result',
                content: `${toolName}: ${summary}`,
                timestamp: Date.now(),
                metadata: { toolName }
            })
        }
    }

    recordToolError(toolName: string, error: string) {
        this.recordError(`Tool ${toolName} failed: ${error}`)
    }

    /**
     * Record an insight or partial response from the LLM
     */
    recordInsight(insight: string) {
        if (!insight || insight.trim().length < 5) return

        this.findings.push({
            type: 'llm_insight',
            content: insight,
            timestamp: Date.now()
        })
    }

    /**
     * Record a summary from a sub-agent
     */
    recordSubAgentReport(agentName: string, report: string) {
        this.findings.push({
            type: 'subagent_report',
            content: `${agentName}: ${report.substring(0, 600)}`,
            timestamp: Date.now(),
            metadata: { agentName }
        })
    }

    recordError(error: string) {
        const clean = (error || '').trim()
        if (!clean) return
        this.lastError = clean
        this.findings.push({
            type: 'error',
            content: clean.substring(0, 500),
            timestamp: Date.now()
        })
    }

    getLastError(): string | null {
        return this.lastError
    }

    /**
     * Generate a Salvage Report (Markdown)
     */
    generateSalvageReport(errorReason?: string): string {
        const elapsedSec = Math.max(1, Math.round((Date.now() - this.startTime) / 1000))
        const completed = this.findings.filter(f => f.type === 'tool_result')
        const partial = this.findings.filter(f => f.type === 'llm_insight' || f.type === 'subagent_report')
        const failed = this.findings.filter(f => f.type === 'error')

        let report = `### Partial Work Summary\n\n`
        report += `Task goal: ${this.taskGoal}\n\n`
        report += `Run time before stop: ${elapsedSec}s\n\n`

        report += `#### Completed\n`
        if (completed.length === 0) report += `- No completed tool outputs were captured.\n`
        completed.slice(-5).forEach(f => {
            report += `- ${f.content}\n`
        })
        report += `\n`

        report += `#### Partial Findings\n`
        if (partial.length === 0) report += `- No partial narrative/sub-agent findings were captured.\n`
        partial.slice(-6).forEach(f => {
            report += `- ${f.content}\n`
        })
        report += `\n`

        report += `#### Failed / Blocked\n`
        if (failed.length === 0 && !errorReason && !this.lastError) {
            report += `- No explicit runtime error was captured.\n`
        }
        failed.slice(-3).forEach(f => {
            report += `- ${f.content}\n`
        })
        if (errorReason) report += `- Ending reason: ${errorReason}\n`
        if (this.lastError) report += `- Last error: ${this.lastError}\n`
        report += `\n`

        report += `---\n`
        report += `Status: Incomplete. Use completed/partial items above to continue without restarting from zero.`

        return report
    }

    getFindingsCount(): number {
        return this.findings.length
    }
}
