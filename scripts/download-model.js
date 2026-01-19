const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
const MODELS_DIR = path.join(__dirname, '../public/models');
const MODEL_NAME = 'vosk-model-small-en-us-0.15';
const MODEL_PATH = path.join(MODELS_DIR, 'vosk-model'); // Target generic name

if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Check if model already exists
if (fs.existsSync(MODEL_PATH) && fs.readdirSync(MODEL_PATH).length > 0) {
    console.log('✅ Vosk model already exists. Skipping download.');
    process.exit(0);
}

console.log('⬇️ Downloading Vosk model...');
const zipPath = path.join(MODELS_DIR, 'model.zip');

const file = fs.createWriteStream(zipPath);
https.get(MODEL_URL, (response) => {
    response.pipe(file);

    file.on('finish', () => {
        file.close(() => {
            console.log('📦 Extracting model...');
            try {
                // Use tar or unzip depending on OS. Since user is on Mac, unzip is safe.
                // But for cross-platform, we might need a library. 
                // For this environment (Mac), 'unzip' command is standard.
                execSync(`unzip -o "${zipPath}" -d "${MODELS_DIR}"`);

                // Rename specific version folder to generic 'vosk-model'
                const extractedPath = path.join(MODELS_DIR, MODEL_NAME);
                if (fs.existsSync(extractedPath)) {
                    if (fs.existsSync(MODEL_PATH)) {
                        fs.rmSync(MODEL_PATH, { recursive: true, force: true });
                    }
                    fs.renameSync(extractedPath, MODEL_PATH);
                }

                // Cleanup zip
                fs.unlinkSync(zipPath);

                console.log('✅ Model downloaded and extracted successfully!');
            } catch (e) {
                console.error('❌ Extraction failed:', e);
                process.exit(1);
            }
        });
    });
}).on('error', (err) => {
    fs.unlink(zipPath);
    console.error('❌ Download failed:', err.message);
    process.exit(1);
});
