/**
 * Injects production WSS relay URL into index.html when BREW_RELAY_WSS_URL is set.
 * Used by GitHub Actions; local dev leaves ws://127.0.0.1:8787 unchanged.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultIndex = path.join(__dirname, '..', 'index.html');

const indexPath = process.env.INDEX_PATH
    ? path.resolve(process.env.INDEX_PATH)
    : defaultIndex;

const url = (process.env.BREW_RELAY_WSS_URL || '').trim();

let html = fs.readFileSync(indexPath, 'utf8');

if (url) {
    const safe = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const replacement = `window.BREW_RELAY_URL = window.BREW_RELAY_URL || '${safe}'`;
    const replaced = html.replace(
        /window\.BREW_RELAY_URL = window\.BREW_RELAY_URL \|\| '[^']*';/,
        replacement
    );
    if (replaced === html) {
        console.error('set-relay-for-pages: could not find BREW_RELAY_URL line in', indexPath);
        process.exit(1);
    }
    html = replaced;
    fs.writeFileSync(indexPath, html);
    // eslint-disable-next-line no-console
    console.log('Injected BREW_RELAY_WSS_URL into', indexPath);
} else {
    // eslint-disable-next-line no-console
    console.log('BREW_RELAY_WSS_URL unset — leaving default localhost relay URL.');
}
