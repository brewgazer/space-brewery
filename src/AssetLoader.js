import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Loads local GLBs + optional CC0 textures, builds IBL from RoomEnvironment.
 * Run `npm run fetch-assets` so paths under assets/ exist.
 */
export async function loadGameAssets(renderer, scene) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const textures = {
        woodFloor: null,
        breweryFloor: null,
        metal: null,
    };

    const texLoader = new THREE.TextureLoader();
    const loadTex = (relPath, repeatX, repeatY) =>
        new Promise((resolve) => {
            texLoader.load(
                relPath,
                (t) => {
                    t.wrapS = t.wrapT = THREE.RepeatWrapping;
                    t.repeat.set(repeatX, repeatY);
                    t.colorSpace = THREE.SRGBColorSpace;
                    const maxA = renderer.capabilities.getMaxAnisotropy?.() ?? 4;
                    t.anisotropy = Math.min(4, maxA);
                    resolve(t);
                },
                undefined,
                () => resolve(null)
            );
        });

    const [woodFloor, breweryFloor, metal] = await Promise.all([
        loadTex('assets/textures/wood_floor_worn_diff_1k.jpg', 10, 12),
        loadTex('assets/textures/asphalt_floor_diff_1k.jpg', 14, 14),
        loadTex('assets/textures/metal_grate_rusty_diff_1k.jpg', 1.5, 1.5),
    ]);

    textures.woodFloor = woodFloor;
    textures.breweryFloor = breweryFloor;
    textures.metal = metal;

    // Image-based lighting (no external HDR file)
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envTexture = null;
    try {
        const envScene = new RoomEnvironment();
        const rt = pmrem.fromScene(envScene, 0.04);
        envTexture = rt.texture;
        envScene.dispose();
    } catch (e) {
        console.warn('RoomEnvironment IBL failed', e);
    } finally {
        pmrem.dispose();
    }

    if (envTexture) {
        scene.environment = envTexture;
        scene.environmentIntensity = 0.9;
    }

    let patronTemplate = null;
    try {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync('assets/models/Soldier.glb');
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const h = box.max.y - box.min.y;
        const s = 1.74 / Math.max(0.001, h);
        root.scale.setScalar(s);
        root.updateMatrixWorld(true);

        const clips = {};
        for (const a of gltf.animations) {
            const n = a.name.toLowerCase().replace(/\s/g, '');
            if (n.includes('idle') || n === 'tpose') clips.idle = a;
            else if (n.includes('walk')) clips.walk = a;
            else if (n.includes('run')) clips.run = a;
        }
        if (!clips.idle && gltf.animations[0]) clips.idle = gltf.animations[0];
        if (!clips.walk && clips.run) clips.walk = clips.run;
        if (!clips.walk && clips.idle) clips.walk = clips.idle;
        if (!clips.idle && clips.walk) clips.idle = clips.walk;

        patronTemplate = {
            scene: root,
            clips,
            animations: gltf.animations,
        };
    } catch (e) {
        console.warn(
            'Soldier.glb missing — patrons use simple shapes. Run: npm run fetch-assets',
            e?.message || e
        );
    }

    return { textures, patronTemplate, envTexture };
}
