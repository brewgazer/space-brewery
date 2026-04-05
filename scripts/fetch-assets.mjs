/**
 * Downloads free CC0 / example assets for Brewery Sim.
 * Sources:
 *   - Soldier.glb, Fox.glb — three.js examples (MIT project; models commonly used for demos)
 *   - Poly Haven textures — CC0 (https://polyhaven.com)
 *
 * Run: npm run fetch-assets
 */
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const modelsDir = path.join(root, 'assets', 'models');
const texDir = path.join(root, 'assets', 'textures');

fs.mkdirSync(modelsDir, { recursive: true });
fs.mkdirSync(texDir, { recursive: true });

const downloads = [
    [
        'Soldier.glb',
        'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/models/gltf/Soldier.glb',
    ],
    [
        'Fox.glb',
        'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb',
    ],
    [
        'wood_floor_worn_diff_1k.jpg',
        'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor_worn/wood_floor_worn_diff_1k.jpg',
    ],
    [
        'asphalt_floor_diff_1k.jpg',
        'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_floor/asphalt_floor_diff_1k.jpg',
    ],
    [
        'metal_grate_rusty_diff_1k.jpg',
        'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/metal_grate_rusty/metal_grate_rusty_diff_1k.jpg',
    ],
];

function fetchToFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const req = (u) => {
            https
                .get(
                    u,
                    {
                        headers: { 'User-Agent': 'brewery-sim-asset-fetch/1.0' },
                    },
                    (res) => {
                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            res.resume();
                            req(res.headers.location);
                            return;
                        }
                        if (res.statusCode !== 200) {
                            res.resume();
                            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
                            return;
                        }
                        res.pipe(file);
                        file.on('finish', () => file.close(resolve));
                    }
                )
                .on('error', (err) => {
                    fs.unlink(dest, () => {});
                    reject(err);
                });
        };
        req(url);
    });
}

async function main() {
    for (const [name, url] of downloads) {
        const isModel = name.endsWith('.glb');
        const dir = isModel ? modelsDir : texDir;
        const dest = path.join(dir, name);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
            console.log(`OK (exists) ${name}`);
            continue;
        }
        console.log(`Downloading ${name} ...`);
        try {
            await fetchToFile(url, dest);
            console.log(`  saved → ${path.relative(root, dest)}`);
        } catch (e) {
            console.error(`  FAILED ${name}:`, e.message);
        }
    }
    console.log('\nDone. Start the game with a local server (e.g. npx serve).');
}

main();
