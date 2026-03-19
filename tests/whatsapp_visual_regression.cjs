/**
 * WhatsApp Visual Regression Test
 * Captures screenshots of WhatsApp UI components for visual comparison
 * Run this on main branch first, then on feature branch to detect visual changes
 */

const { _electron: electron } = require('playwright');
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('path');
const fs = require('fs');

const BASELINE_DIR = path.join(__dirname, 'visual-baseline');
const COMPARISON_DIR = path.join(__dirname, 'visual-comparison');
const TEMP_USER_DATA = path.join(__dirname, 'temp-user-data-visual');

// Component selectors for visual testing
const COMPONENT_SELECTORS = {
    whatsappConnectButton: '#header-whatsapp-connect',
    whatsappStatusButton: '#header-whatsapp-status',
    connectionDialog: '[data-testid="whatsapp-connection-dialog"]',
    qrCodeSection: '[data-testid="qr-code-section"]',
    phoneInput: 'input[placeholder*="phone"]',
    connectionStatus: '[data-testid="connection-status"]',
    errorMessage: '[data-testid="error-message"]',
    chatInput: 'textarea[data-testid="chat-textarea"]',
    messageBubble: '[data-testid="message-bubble"]'
};

async function captureComponentScreenshot(window, componentName, selector) {
    try {
        const element = await window.locator(selector).first();
        if (await element.isVisible()) {
            const screenshotPath = path.join(COMPARISON_DIR, `${componentName}.png`);
            await element.screenshot({ path: screenshotPath });
            console.log(`📸 Captured ${componentName}`);
            return screenshotPath;
        } else {
            console.log(`⚠️ Component ${componentName} not visible`);
            return null;
        }
    } catch (error) {
        console.log(`⚠️ Failed to capture ${componentName}: ${error.message}`);
        return null;
    }
}

async function captureFullWindowScreenshot(window, name) {
    const screenshotPath = path.join(COMPARISON_DIR, `${name}.png`);
    await window.screenshot({ path: screenshotPath });
    console.log(`📸 Captured full window: ${name}`);
    return screenshotPath;
}

async function compareScreenshots(baselinePath, comparisonPath) {
    if (!fs.existsSync(baselinePath)) {
        console.log(`ℹ️ No baseline found for ${path.basename(baselinePath)}`);
        return { status: 'no-baseline', diff: 0 };
    }

    const { PNG } = require('pngjs');
    const pixelmatch = require('pixelmatch');

    const baselineBuffer = fs.readFileSync(baselinePath);
    const comparisonBuffer = fs.readFileSync(comparisonPath);

    const baselinePng = PNG.sync.read(baselineBuffer);
    const comparisonPng = PNG.sync.read(comparisonBuffer);

    const { width, height } = baselinePng;
    const diff = new PNG({ width, height });

    const numDiffPixels = pixelmatch(
        baselinePng.data,
        comparisonPng.data,
        diff.data,
        width,
        height,
        { threshold: 0.1 }
    );

    const diffPercentage = (numDiffPixels / (width * height)) * 100;

    if (numDiffPixels > 0) {
        const diffPath = path.join(COMPARISON_DIR, `${path.basename(baselinePath, '.png')}_diff.png`);
        fs.writeFileSync(diffPath, PNG.sync.write(diff));
        console.log(`⚠️ Visual difference detected: ${diffPercentage.toFixed(2)}%`);
        return { status: 'diff', diff: diffPercentage, diffPath };
    }

    return { status: 'match', diff: 0 };
}

(async () => {
    console.log('🚀 Starting WhatsApp Visual Regression Test...');

    // Ensure directories exist
    if (!fs.existsSync(BASELINE_DIR)) {
        fs.mkdirSync(BASELINE_DIR, { recursive: true });
        console.log('ℹ️ Created baseline directory. Run with --update-baseline to capture new baselines');
    }
    if (!fs.existsSync(COMPARISON_DIR)) {
        fs.mkdirSync(COMPARISON_DIR, { recursive: true });
    }

    // Clean up temp user data
    if (fs.existsSync(TEMP_USER_DATA)) {
        fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    }

    const args = process.argv.slice(2);
    const updateBaseline = args.includes('--update-baseline');

    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
    const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    let electronApp;
    try {
        electronApp = await electron.launch({
            executablePath: execPath,
            args: [
                path.join(__dirname, '../out/main/index.js'),
                '--no-sandbox',
                `--user-data-dir=${TEMP_USER_DATA}`
            ],
            timeout: 60000,
            env: { ...process.env, NODE_ENV: 'production' }
        });
        console.log('✅ Electron launched');
    } catch (e) {
        console.error('❌ Launch failed:', e);
        process.exit(1);
    }

    try {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Window loaded');

        // Wait for app to fully initialize
        await window.waitForTimeout(3000);

        console.log('\n📸 Capturing screenshots...');

        // 1. Full window screenshot
        await captureFullWindowScreenshot(window, 'app_full_window');

        // 2. WhatsApp connect button in header
        await captureComponentScreenshot(window, 'whatsapp_connect_button', COMPONENT_SELECTORS.whatsappConnectButton);

        // 3. Open dialog and capture
        const whatsappConnectButton = await window.locator(COMPONENT_SELECTORS.whatsappConnectButton).first();
        if (await whatsappConnectButton.isVisible()) {
            await whatsappConnectButton.click();
            await window.waitForTimeout(1000);

            // 4. Connection dialog intro state
            await captureComponentScreenshot(window, 'connection_dialog_intro', COMPONENT_SELECTORS.connectionDialog);

            // 5. Click connect to show QR code
            const connectButton = await window.locator('button:has-text("Connect")').first();
            if (await connectButton.isVisible()) {
                await connectButton.click();
                await window.waitForTimeout(2000);
                await captureComponentScreenshot(window, 'qr_code_section', COMPONENT_SELECTORS.qrCodeSection);
            }

            // 6. Phone input state
            const phoneInput = await window.locator(COMPONENT_SELECTORS.phoneInput).first();
            if (await phoneInput.isVisible()) {
                await phoneInput.fill('+1234567890');
                await captureComponentScreenshot(window, 'phone_input_filled', COMPONENT_SELECTORS.phoneInput);
            }

            // 7. Close dialog
            const closeButton = await window.locator('button[aria-label="Close"]').first();
            if (await closeButton.isVisible()) {
                await closeButton.click();
                await window.waitForTimeout(500);
            }
        }

        // 8. Chat interface with WhatsApp mode enabled
        // Close dialog first
        await window.keyboard.press('Escape');
        await window.waitForTimeout(500);
        
        const chatInput = await window.locator(COMPONENT_SELECTORS.chatInput).first();
        if (await chatInput.isVisible()) {
            await captureComponentScreenshot(window, 'chat_input', COMPONENT_SELECTORS.chatInput);
        }

        // Compare screenshots if not updating baseline
        if (!updateBaseline) {
            console.log('\n🔍 Comparing screenshots with baseline...');

            const results = [];
            const comparisonFiles = fs.readdirSync(COMPARISON_DIR).filter(f => f.endsWith('.png'));

            for (const file of comparisonFiles) {
                const baselinePath = path.join(BASELINE_DIR, file);
                const comparisonPath = path.join(COMPARISON_DIR, file);
                const result = await compareScreenshots(baselinePath, comparisonPath);
                results.push({ file, ...result });
            }

            // Print results
            console.log('\n📊 Visual Regression Results:');
            let hasDiffs = false;
            for (const result of results) {
                if (result.status === 'diff') {
                    console.log(`❌ ${result.file}: ${result.diff.toFixed(2)}% difference`);
                    hasDiffs = true;
                } else if (result.status === 'no-baseline') {
                    console.log(`ℹ️ ${result.file}: No baseline (new component)`);
                } else {
                    console.log(`✅ ${result.file}: Matches baseline`);
                }
            }

            if (hasDiffs) {
                console.log('\n⚠️ Visual differences detected!');
                process.exit(1);
            } else {
                console.log('\n✅ All visual tests passed!');
            }
        } else {
            // Copy comparison to baseline
            const comparisonFiles = fs.readdirSync(COMPARISON_DIR).filter(f => f.endsWith('.png'));
            for (const file of comparisonFiles) {
                const src = path.join(COMPARISON_DIR, file);
                const dest = path.join(BASELINE_DIR, file);
                fs.copyFileSync(src, dest);
            }
            console.log('\n✅ Baseline screenshots updated!');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    } finally {
        if (electronApp) {
            await electronApp.close();
        }
        // Clean up temp user data
        if (fs.existsSync(TEMP_USER_DATA)) {
            fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
        }
    }
})();
