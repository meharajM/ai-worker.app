const { _electron: electron } = require('playwright');
const path = require('path');
(async () => {
    const electronApp = await electron.launch({
        args: [
            path.join(__dirname, '.'),
            '--no-sandbox'
        ],
    });
    console.log("Launched!");
    await electronApp.close();
})();
