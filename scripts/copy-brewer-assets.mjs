/**
 * Copies FBX brewer + kicking clips into assets/brewer/ for the web game.
 * Default source: E:\brewer character (override with BREWER_SRC env).
 *
 * Usage: node scripts/copy-brewer-assets.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const destRoot = path.join(__dirname, '..', 'assets', 'brewer');
const srcRoot = process.env.BREWER_SRC || 'E:\\brewer character';

if (!fs.existsSync(srcRoot)) {
    console.warn('[copy-brewer] Source not found:', srcRoot);
    console.warn('  Set BREWER_SRC or copy files manually into assets/brewer/');
    process.exit(0);
}

function copyDir(from, to) {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from, { withFileTypes: true })) {
        const fp = path.join(from, name.name);
        const tp = path.join(to, name.name);
        if (name.isDirectory()) {
            copyDir(fp, tp);
        } else if (/\.fbx$/i.test(name.name)) {
            fs.copyFileSync(fp, tp);
            console.log('  copied', path.relative(srcRoot, fp));
        }
    }
}

fs.mkdirSync(destRoot, { recursive: true });
console.log('[copy-brewer] From', srcRoot, '→', destRoot);
copyDir(srcRoot, destRoot);

const grabMixSrc = path.join(
    srcRoot,
    'space brewer animations',
    'new new',
    'player_brewer_grabbing grain malt hops brew mix.glb'
);
const grabMixDest = path.join(destRoot, 'player_glb', 'anim_grab_mix.glb');
if (fs.existsSync(grabMixSrc)) {
    fs.mkdirSync(path.dirname(grabMixDest), { recursive: true });
    fs.copyFileSync(grabMixSrc, grabMixDest);
    console.log('  copied', path.relative(srcRoot, grabMixSrc), '→ player_glb/anim_grab_mix.glb');
} else {
    console.warn('[copy-brewer] Optional GLB not found (grab mix):', grabMixSrc);
}

console.log('[copy-brewer] Done. Expected: assets/brewer/<Model>.fbx and kicking out animaions/1.fbx, 2.fbx');
