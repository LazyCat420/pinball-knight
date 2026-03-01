import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.join(__dirname, '..', 'src');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
    });
}

walkDir(srcDir, (filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('retro-cursor-')) {
            const newContent = content.replace(/retro-cursor-/g, 'pixel-cursor-');
            fs.writeFileSync(filePath, newContent);
            console.log(`Updated cursors in ${filePath}`);
        }
    }
});
