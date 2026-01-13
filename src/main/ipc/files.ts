import { ipcMain, app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

export function registerFileHandlers(): void {
    const tempDir = path.join(app.getPath('userData'), 'temp_outputs');

    // Ensure temp dir exists
    fs.mkdir(tempDir, { recursive: true }).catch(console.error);

    // Write content to a temporary file
    ipcMain.handle('files:write-temp', async (_event, content: string, extension: string = '.txt') => {
        try {
            await fs.mkdir(tempDir, { recursive: true });
            const filename = `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${extension}`;
            const filePath = path.join(tempDir, filename);
            await fs.writeFile(filePath, content, 'utf-8');
            return { success: true, path: filePath };
        } catch (error) {
            console.error('Failed to write temp file:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    // Clean up temporary files (all files in the temp dir)
    ipcMain.handle('files:cleanup-temp', async () => {
        try {
            const files = await fs.readdir(tempDir);
            await Promise.all(
                files.map(file => fs.unlink(path.join(tempDir, file)).catch(err => 
                    console.warn(`Failed to delete temp file ${file}:`, err)
                ))
            );
            return { success: true, count: files.length };
        } catch (error) {
            console.error('Failed to cleanup temp files:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });
}
