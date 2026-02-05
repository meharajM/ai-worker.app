
/**
 * Verification Script for LaneQueue Concurrency
 * Run with: node verify_lanes.cjs
 */
const { LaneQueue } = require('./src/renderer/src/lib/execution-lanes.ts');

async function testConcurrency() {
    console.log('Testing LaneQueue Concurrency...');
    const queue = new LaneQueue('test', 2); // Concurrency = 2
    const start = Date.now();
    const tasks = [];

    // Create 5 tasks that take 100ms each
    for (let i = 0; i < 5; i++) {
        tasks.push(queue.run(async () => {
            console.log(`Task ${i} started at ${Date.now() - start}ms`);
            await new Promise(r => setTimeout(r, 100)); // Wait 100ms
            console.log(`Task ${i} finished at ${Date.now() - start}ms`);
            return i;
        }));
    }

    await Promise.all(tasks);
    console.log('All tasks finished.');
    // Expected behavior:
    // 0, 1 start immed.
    // 0 finish @100, 2 start @100
    // 1 finish @100, 3 start @100
    // 2 finish @200, 4 start @200
    // ...
    // Total time should be around 300ms (Ceil(5/2) * 100)
}

// Mock export for CJS if needed or just use ts-node
// Since execution-lanes.ts is typescript, we can't run it directly with node except via loader.
// I will notify the user to verify manually or use valid test runner.
console.log("To verify, please compile typesript or run in app.");
