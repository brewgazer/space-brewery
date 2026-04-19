/**
 * Copies static game files into _site/ for GitHub Pages (minimal upload, no .git).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const site = path.join(root, '_site');

function rmrf(p) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true });
}

function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const s = path.join(src, name);
        const d = path.join(dest, name);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else copyFile(s, d);
    }
}

rmrf(site);
fs.mkdirSync(site, { recursive: true });

copyFile(path.join(root, 'index.html'), path.join(site, 'index.html'));
copyFile(path.join(root, 'main.js'), path.join(site, 'main.js'));
copyDir(path.join(root, 'src'), path.join(site, 'src'));
if (fs.existsSync(path.join(root, 'assets'))) {
    copyDir(path.join(root, 'assets'), path.join(site, 'assets'));
}

fs.writeFileSync(path.join(site, '.nojekyll'), '');
// eslint-disable-next-line no-console
console.log('Packaged site to _site/');
