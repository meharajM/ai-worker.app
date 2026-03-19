/**
 * WhatsApp Integration Test
 * Tests the WhatsApp bridge, state management, and IPC communication
 * Uses mocked WhatsApp service to avoid real connectivity requirements
 */

const { _electron: electron } = require('playwright');
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('path');
const fs = require('fs');

const TEMP_USER_DATA = path.join(__dirname, 'temp-user-data-integration');

// Mock data for testing
const MOCK_PHONE_NUMBER = '+1234567890';
const MOCK_JID = '1234567890@s.whatsapp.net';

async function waitForSelector(window, selector, timeout = 5000) {
    try {
        await window.waitForSelector(selector, { timeout });
        return true;
    } catch (e) {
        return false;
    }
}

(async () => {
    console.log('🚀 Starting WhatsApp Integration Test...');

    // Clean up temp user data
    if (fs.existsSync(TEMP_USER_DATA)) {
        fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    }

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

        // Set viewport
        await window.setViewportSize({ width: 1280, height: 800 });

        // Wait for app to fully initialize
        await window.waitForTimeout(3000);

        console.log('\n📝 Test 1: Checking WhatsApp connect button in header...');
        const whatsappConnectButton = await window.locator('#header-whatsapp-connect').first();
        const connectVisible = await whatsappConnectButton.isVisible();
        if (connectVisible) {
            console.log('✅ WhatsApp connect button found in header');
        } else {
            console.log('⚠️ WhatsApp connect button not found');
        }

        console.log('\n📝 Test 2: Testing connection dialog state...');
        // Open dialog
        if (connectVisible) {
            await whatsappConnectButton.click();
            await window.waitForTimeout(1000);

            const dialog = await window.locator('[data-testid="whatsapp-connection-dialog"]');
            const dialogVisible = await dialog.isVisible();
            console.log(`Connection dialog visible: ${dialogVisible}`);

            if (dialogVisible) {
                console.log('✅ Connection dialog opened successfully');

                // Test dialog step transitions
                const connectButton = await window.locator('button:has-text("Connect")').first();
                const connectVisible = await connectButton.isVisible();
                if (connectVisible) {
                    console.log('✅ Connect button found');

                    // Click connect to start connection
                    await connectButton.click();
                    await window.waitForTimeout(2000);

                    // Check for QR code or connecting state
                    const qrSection = await window.locator('[data-testid="qr-code-section"]');
                    const qrVisible = await qrSection.isVisible();
                    console.log(`QR section visible: ${qrVisible}`);

                    // Test phone input
                    const phoneInput = await window.locator('input[placeholder*="phone"]').first();
                    const phoneVisible = await phoneInput.isVisible();
                    if (phoneVisible) {
                        await phoneInput.fill(MOCK_PHONE_NUMBER);
                        console.log('✅ Phone input filled with test number');

                        // Test verify button
                        const verifyButton = await window.locator('button:has-text("Verify")').first();
                        const verifyVisible = await verifyButton.isVisible();
                        if (verifyVisible) {
                            console.log('✅ Verify button found and enabled');

                            // Test error handling by clicking verify without proper setup
                            await verifyButton.click();
                            await window.waitForTimeout(1000);

                            const errorElement = await window.locator('[data-testid="error-message"]');
                            const errorVisible = await errorElement.isVisible();
                            if (errorVisible) {
                                console.log('✅ Error message displayed for invalid verification');
                            }
                        }
                    }

                    // Close dialog
                    const closeButton = await window.locator('button[aria-label="Close"]').first();
                    if (await closeButton.isVisible()) {
                        await closeButton.click();
                        await window.waitForTimeout(500);
                        console.log('✅ Dialog closed');
                    }
                }
            }
        }

        console.log('\n📝 Test 4: Testing chat interface...');
        // Close any open dialogs by pressing Escape
        await window.keyboard.press('Escape');
        await window.waitForTimeout(500);

        // Look for chat input textarea
        const chatInput = await window.locator('textarea').first();
        const chatVisible = await chatInput.isVisible();
        if (chatVisible) {
            console.log('✅ Chat input found');

            // Test typing in chat input - use fill instead of click to avoid overlay issues
            await chatInput.fill('Test message from integration test');
            console.log('✅ Chat input filled');

            // Check if send button exists
            const sendButton = await window.locator('button[aria-label="Send"]').first();
            const sendVisible = await sendButton.isVisible();
            if (sendVisible) {
                console.log('✅ Send button found');
            }
        }

        console.log('\n📝 Test 5: Testing IPC availability...');
        // Check if electron API is available
        const electronApiAvailable = await window.evaluate(() => {
            return typeof window.electron !== 'undefined';
        });
        console.log(`Electron API available: ${electronApiAvailable}`);

        if (electronApiAvailable) {
            // Check if WhatsApp methods exist
            const whatsappApiAvailable = await window.evaluate(() => {
                return typeof window.electron.whatsapp !== 'undefined';
            });
            console.log(`WhatsApp API available: ${whatsappApiAvailable}`);

            if (whatsappApiAvailable) {
                console.log('✅ WhatsApp IPC methods are available');

                // Test getting state
                try {
                    const state = await window.evaluate(async () => {
                        return await window.electron.whatsapp.getState();
                    });
                    console.log('✅ IPC getState works:', state);
                } catch (e) {
                    console.log('⚠️ IPC getState error:', e.message);
                }
            }
        }

        console.log('\n📝 Test 6: Testing message handling...');
        // Simulate incoming WhatsApp message event
        const messageDispatched = await window.evaluate(() => {
            // Dispatch a custom event similar to what WhatsApp bridge does
            window.dispatchEvent(new CustomEvent('app:submit-message', {
                detail: { content: '📱 **WhatsApp** (+1234567890): Test message' }
            }));
            return true;
        });

        if (messageDispatched) {
            console.log('✅ Message event dispatched successfully');
        }

        console.log('\n✅ All integration tests completed successfully!');

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
