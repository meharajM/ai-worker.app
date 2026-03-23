module.exports = async function(context) {
    return {
        // Automatically injects the headless server into the app
        mcpServers: [{
            name: "excel",
            description: "Excel MCP Server - Native creation, reading, modifying and formatting of Excel workbooks",
            type: "stdio",
            command: "uvx",
            args: ["excel-mcp-server", "stdio"],
            autoConnect: true
        }],
        
        // Custom OpenCode-style tool to demonstrate live COM/AppleScript integration
        tool: {
            smart_excel_check: {
                description: "Checks if Microsoft Excel is currently running on the local system.",
                args: { type: "object", properties: {} },
                execute: async (args, ctx) => {
                    const os = require('os');
                    if (os.platform() === 'darwin') {
                        try {
                            // Uses the provided OpenCode shell context ($)
                            const result = await ctx.$`osascript -e 'application "Microsoft Excel" is running'`;
                            return `Live Excel Check: ${result.trim() === 'true' ? 'Running' : 'Not Running'}`;
                        } catch (e) {
                            return `Check failed: ${e.message}`;
                        }
                    }
                    return "Live check only supported on macOS for this demo.";
                }
            }
        }
    }
}
