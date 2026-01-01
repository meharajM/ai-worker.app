```javascript
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Log to stderr so it doesn't interfere with stdout JSON-RPC
const log = (msg) => console.error(`[MockServer] ${ msg } `);

log('Started');

rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
        const msg = JSON.parse(line);

        // Ignore responses to us (if any)
        if (!msg.method && msg.result) return;
        if (!msg.method && msg.error) return;

        if (msg.method === 'initialize') {
            log('Initialize');
            send({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'MockServer', version: '1.0' }
                }
            });
        } else if (msg.method === 'notifications/initialized') {
            log('Initialized Notif');
        } else if (msg.method === 'tools/list') {
            log('List Tools');
            send({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                    tools: [{
                        name: 'mock_echo',
                        description: 'Echoes back the input message',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                message: { type: 'string', description: 'The message to echo' }
                            },
                            required: ['message']
                        }
                    }]
                }
            });
        } else if (msg.method === 'tools/call') {
            log(`Call Tool: ${ msg.params.name } `);
            if (msg.params.name === 'mock_echo') {
                const text = msg.params.arguments.message;
                send({
                    jsonrpc: '2.0',
                    id: msg.id,
                    result: {
                        content: [{ type: 'text', text: `EchoResult: ${ text } ` }]
                    }
                });
            } else {
                send({
                    jsonrpc: '2.0',
                    id: msg.id,
                    error: { code: -32601, message: 'Tool not found' }
                });
            }
        } else if (msg.method === 'ping') {
            send({ jsonrpc: '2.0', id: msg.id, result: {} });
        } else {
            // unexpected method, just ack to avoid hanging?
            // or ignore notifications
            if (msg.id) {
                send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
            }
        }

    } catch (e) {
        log(`Error: ${ e } `);
    }
});

function send(obj) {
    console.log(JSON.stringify(obj));
}
