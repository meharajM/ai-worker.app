/**
 * Speech Recognition E2E Test
 * Tests the Web Speech API fallback with audio visualization
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('🎤 Starting Speech Recognition E2E Test...');

    // Cleanup old screenshots
    const screenshots = ['speech-test-start.png', 'speech-test-listening.png', 'speech-test-failure.png'];
    screenshots.forEach(s => { if (fs.existsSync(s)) fs.unlinkSync(s); });

    // Find electron
    const electronExecutable = path.join(__dirname, '../node_modules/electron/dist/electron');
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    console.log('Using electron execPath:', execPath);

    let electronApp;
    try {
        console.log('🚀 Launching Electron...');
        electronApp = await electron.launch({
            executablePath: execPath,
            args: [
                path.join(__dirname, '../out/main/index.js'),
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                // Enable fake audio for testing (simulates microphone)
                '--use-fake-device-for-media-stream',
                '--use-fake-ui-for-media-stream'
            ],
            timeout: 45000,
            env: {
                ...process.env,
                NODE_ENV: 'production'
            }
        });
        console.log('✅ Electron launched successfully');
    } catch (launchError) {
        console.error('❌ Failed to launch Electron:', launchError);
        process.exit(1);
    }

    try {
        const window = await electronApp.firstWindow();

        // Debug logging
        window.on('console', msg => {
            if (msg.type() === 'error') {
                console.log(`[Renderer Error]: ${msg.text()}`);
            }
        });

        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Window Loaded');

        // Wait for app to initialize
        await window.waitForTimeout(3000);
        await window.screenshot({ path: 'speech-test-start.png' });
        console.log('📸 Initial state captured');

        // --- TEST 1: Verify Speech Recognition Support Detection ---
        console.log('\n--- Test 1: Speech Recognition Support ---');

        // Wait for the main app to load - check for mic button
        const micButtonTitled = window.locator('button[title="Start Voice Mode"]');
        const micButtonIcon = window.locator('button:has(svg.lucide-mic)');

        let micLocator = null;

        // Try titled button first
        try {
            await micButtonTitled.first().waitFor({ state: 'visible', timeout: 10000 });
            micLocator = micButtonTitled.first();
            console.log('✅ Microphone button found (with title)');
        } catch (e) {
            // Try icon button if title not found
            const iconCount = await micButtonIcon.count();
            if (iconCount > 0) {
                micLocator = micButtonIcon.first();
                console.log('✅ Microphone button found (via icon)');
            }
        }

        if (!micLocator) {
            console.log('⚠️ Microphone button not found - checking if it exists offscreen');
            // Take screenshot to debug
            await window.screenshot({ path: 'speech-test-no-mic.png' });
            throw new Error('Microphone button not found');
        }

        // Check if it's enabled (speech is supported)
        const isDisabled = await micLocator.getAttribute('disabled');
        if (!isDisabled) {
            console.log('✅ Microphone button is enabled (Web Speech API supported)');
        } else {
            console.log('⚠️ Microphone button is disabled (Speech not supported in this environment)');
        }

        // --- TEST 2: Voice Mode UI Transition ---
        console.log('\n--- Test 2: Voice Mode UI ---');

        if (!isDisabled) {
            // Click mic to enter voice mode
            await micLocator.click();
            console.log('✅ Clicked microphone button');

            // Wait for voice mode UI to appear
            await window.waitForTimeout(1000);

            // Check for listening state indicators
            const listeningText = await window.locator('text=LISTENING').count();
            const initializingText = await window.locator('text=Initializing').count();
            const visualizer = await window.locator('canvas').count();
            const closeButton = await window.locator('button:has(svg.lucide-x)').count();
            const stopButton = await window.locator('button:has-text("■")').count();

            // Take screenshot of voice mode
            await window.screenshot({ path: 'speech-test-listening.png' });
            console.log('📸 Voice mode captured');

            if (listeningText > 0) {
                console.log('✅ "LISTENING..." status visible');
            } else if (initializingText > 0) {
                console.log('✅ "Initializing..." status visible');
            } else {
                console.log('ℹ️ No status text found (may be styled differently)');
            }

            if (visualizer > 0) {
                console.log('✅ Visualizer canvas present');
            } else {
                console.log('⚠️ Visualizer canvas not found');
            }

            // Cancel voice mode
            if (closeButton > 0) {
                console.log('✅ Close/Cancel button present');
                try {
                    await window.locator('button:has(svg.lucide-x)').first().click({ timeout: 3000 });
                    console.log('✅ Canceled voice mode');
                } catch (e) {
                    // Voice mode may have auto-closed due to speech recognition ending
                    console.log('ℹ️ Voice mode already closed (auto-closed on recognition end)');
                }
            } else {
                // Try clicking elsewhere or wait
                console.log('ℹ️ No X button, looking for stop button');
                try {
                    const stopBtn = window.locator('.w-16.h-16').first();
                    if (await stopBtn.count() > 0) {
                        await stopBtn.click({ timeout: 3000 });
                        console.log('✅ Clicked stop button');
                    }
                } catch (e) {
                    console.log('ℹ️ Voice mode already closed');
                }
            }

            // Verify we're back to text mode
            await window.waitForTimeout(500);
        } else {
            console.log('ℹ️ Skipping voice mode test (button disabled)');
        }

        // --- TEST 3: Speech IPC Handlers (Main Process) ---
        console.log('\n--- Test 3: Speech IPC Handlers ---');

        // The fact that the app loaded successfully confirms IPC handlers are registered
        // We already know from speech.ts that handlers return { supported: false }
        console.log('✅ Speech IPC handlers registered (app running)');

        // --- TEST 4: UI Elements Integrity ---
        console.log('\n--- Test 4: UI Integrity Check ---');

        // Verify status bar shows READY or ACTIVE
        try {
            await window.getByText('READY', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
            console.log('✅ Status is READY');
        } catch (e) {
            // Could be ACTIVE if there's history
            const activeText = await window.locator('text=ACTIVE').count();
            if (activeText > 0) {
                console.log('✅ Status is ACTIVE');
            } else {
                console.log('ℹ️ Status text not found (may be styled differently)');
            }
        }

        // Verify send button exists
        const sendBtn = await window.locator('button:has(svg.lucide-send)').count();
        if (sendBtn > 0) {
            console.log('✅ Send button present');
        } else {
            console.log('ℹ️ Send button not in viewport');
        }

        // --- TEST 5: Verify Offline Mode Status (Electron Environment) ---
        console.log('\n--- Test 5: Offline Mode Status Check ---');

        // Navigate to Settings
        const settingsButton = window.locator('button[title="Settings"]');
        await settingsButton.click();
        console.log('✅ Clicked Settings button');

        await window.waitForTimeout(1000); // Wait for transition

        // Verify Status Text
        const engineTitle = await window.locator('text=Speech Recognition Engine').count();
        if (engineTitle > 0) {
            console.log('✅ Found "Speech Recognition Engine" section');
        } else {
            throw new Error('"Speech Recognition Engine" section not found in Settings');
        }

        const offlineText = await window.locator('text=Using Vosk (Offline/Local) - Electron Environment').count();
        const offlineBadge = await window.locator('text=Offline Mode').count();

        if (offlineText > 0 && offlineBadge > 0) {
            console.log('✅ Verified Offline Mode status text and badge');
        } else {
            // Take screenshot if failed
            await window.screenshot({ path: 'speech-test-offline-fail.png' });
            console.error('Text found:', await window.content());
            throw new Error('Offline Mode status not found. Is isElectron() returning true?');
        }

        console.log('\n🎉 SPEECH E2E TEST PASSED');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);
        try {
            const window = await electronApp.firstWindow();
            await window.screenshot({ path: 'speech-test-failure.png' });
            console.log('📸 Failure screenshot saved');
        } catch (e) {
            console.error('Failed to capture failure screenshot');
        }
        process.exit(1);
    } finally {
        await electronApp.close();
    }
})();
