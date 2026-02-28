const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    const macPath = path.join(__dirname, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, 'node_modules/electron/dist/electron');
    const execPath = fs.existsSync(macPath) ? macPath : linuxPath;

    try {
        console.log('Launching directory...');
        const electronApp = await electron.launch({
            executablePath: execPath,
            args: [
                path.join(__dirname, '.'),
                '--no-sandbox'
            ],
            timeout: 10000
        });
        console.log("Directory Launched!");
        await electronApp.close();

        console.log('Launching script directly...');
        const electronApp2 = await electron.launch({
            executablePath: execPath,
            args: [
                path.join(__dirname, 'out/main/index.js'),
                '--no-sandbox'
            ],
            timeout: 10000
        });
        console.log("Script Launched!");
        await electronApp2.close();
    } catch (e) {
        console.error("Failed:", e);
    }
})();
