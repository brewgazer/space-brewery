import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { pickPatronClips } from './PatronClipUtils.js';
import { prepareChairTemplate } from './FurnitureGltfUtils.js';
import { loadBrewerFbxAssets } from './BrewerFbxLoader.js';
import { loadBrewerGlbAssets } from './BrewerGlbLoader.js';

/** Scale Sketchfab keg to game units; pivot feet at origin, centered on XZ. */
/** Scale imported grain mill to sit on floor; ~1.5 m tall. */
function prepareGrainMillTemplate(sceneRoot) {
    const root = sceneRoot.clone(true);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const h = box.max.y - box.min.y;
    const targetH = 1.52;
    const s = targetH / Math.max(0.001, h);
    root.scale.setScalar(s);
    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(root);
    const cx = (box2.min.x + box2.max.x) * 0.5;
    const cz = (box2.min.z + box2.max.z) * 0.5;
    root.position.set(-cx, -box2.min.y, -cz);
    root.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = true;
        }
    });
    return root;
}

function prepareKegTemplate(sceneRoot) {
    const root = sceneRoot.clone(true);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const h = box.max.y - box.min.y;
    /** Sized vs brewer; was 3× tiny import, then 2/3 of that pass (≈ realistic keg). */
    const targetH = 0.52 * 3 * (2 / 3);
    const s = targetH / Math.max(0.001, h);
    root.scale.setScalar(s);
    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(root);
    const cx = (box2.min.x + box2.max.x) * 0.5;
    const cz = (box2.min.z + box2.max.z) * 0.5;
    root.position.set(-cx, -box2.min.y, -cz);
    root.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = true;
        }
    });
    return root;
}

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
                    t.anisotropy = Math.min(2, maxA);
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
        scene.environmentIntensity = 1.05;
    }

    function withTimeout(promise, ms, label) {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`${label} timed out (${ms / 1000}s)`)), ms)
            ),
        ]);
    }

    const loader = new GLTFLoader();
    let patronTemplate = null;
    try {
        const paths = ['assets/models/Patron.glb', 'assets/models/Soldier.glb'];
        let gltf = null;
        let loadedPath = null;
        for (const p of paths) {
            try {
                gltf = await withTimeout(loader.loadAsync(p), 20000, p);
                loadedPath = p;
                break;
            } catch (err) {
                console.warn(`Patron load skipped (${p}):`, err?.message || err);
            }
        }
        if (!gltf) throw new Error('No patron GLB found');

        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const h = box.max.y - box.min.y;
        const s = 1.74 / Math.max(0.001, h);
        root.scale.setScalar(s);
        root.updateMatrixWorld(true);

        const picked = pickPatronClips(gltf.animations);
        const clips = {
            idle: picked.idle,
            walk: picked.walk,
            run: picked.walk,
            drink: picked.drink,
            happy: picked.happy,
            angry: picked.angry,
        };

        const box2 = new THREE.Box3().setFromObject(root);
        const bubbleY = box2.max.y + 0.34;

        patronTemplate = {
            scene: root,
            clips,
            animations: gltf.animations,
            bubbleY,
            sourcePath: loadedPath,
            // Mixamo Soldier faces +Z while moving; RobotExpressive faces -Z (standard glTF).
            walkYawOffset: loadedPath && loadedPath.includes('Soldier') ? Math.PI : 0,
        };
    } catch (e) {
        console.warn(
            'Patron.glb missing — patrons use simple shapes. Run: npm run fetch-assets',
            e?.message || e
        );
    }

    let brewerTemplate = null;
    try {
        brewerTemplate = await loadBrewerGlbAssets(withTimeout);
        if (brewerTemplate) {
            console.info('Brewer GLB loaded:', brewerTemplate.sourcePath);
        }
    } catch (e) {
        console.warn('Brewer GLB not loaded:', e?.message || e);
    }
    if (!brewerTemplate) {
        try {
            brewerTemplate = await loadBrewerFbxAssets(withTimeout);
            if (brewerTemplate) {
                console.info('Brewer FBX loaded:', brewerTemplate.sourcePath);
            }
        } catch (e) {
            console.warn('Brewer FBX not loaded — place model under assets/brewer/', e?.message || e);
        }
    }

    let furnitureChairTemplate = null;
    try {
        const chairGltf = await withTimeout(
            loader.loadAsync('assets/models/FurnitureChair.glb'),
            25000,
            'FurnitureChair.glb'
        );
        furnitureChairTemplate = prepareChairTemplate(chairGltf.scene);
    } catch (e) {
        console.warn('FurnitureChair.glb missing — taproom uses procedural chairs.', e?.message || e);
    }

    let beerTapTemplate = null;
    try {
        const tapGltf = await withTimeout(
            loader.loadAsync('assets/models/beer_tap/scene.gltf'),
            25000,
            'beer_tap/scene.gltf'
        );
        beerTapTemplate = tapGltf.scene;
    } catch (e) {
        console.warn('beer_tap glTF missing — bar uses procedural taps.', e?.message || e);
    }

    let beerFermenterTemplate = null;
    try {
        const fermGltf = await withTimeout(
            loader.loadAsync('assets/models/brewery/Brewery_Fermenter.glb'),
            35000,
            'brewery/Brewery_Fermenter.glb'
        );
        beerFermenterTemplate = fermGltf.scene;
    } catch (e) {
        console.warn('Brewery_Fermenter.glb missing — trying legacy fermenter.', e?.message || e);
        try {
            const fermGltf = await withTimeout(
                loader.loadAsync('assets/models/beer_fermenter_v2/scene_mr.glb'),
                35000,
                'beer_fermenter_v2/scene_mr.glb'
            );
            beerFermenterTemplate = fermGltf.scene;
        } catch (e2) {
            console.warn('beer_fermenter_v2 GLB missing — procedural fermenter tanks.', e2?.message || e2);
        }
    }

    let mashTunTemplate = null;
    try {
        const mashGltf = await withTimeout(
            loader.loadAsync('assets/models/brewery/Brewery_Mash_Ton.glb'),
            35000,
            'brewery/Brewery_Mash_Ton.glb'
        );
        mashTunTemplate = mashGltf.scene;
    } catch (e) {
        console.warn('Brewery_Mash_Ton.glb missing — mash tun uses procedural reactor.', e?.message || e);
    }

    let lagerTankTemplate = null;
    try {
        const lagGltf = await withTimeout(
            loader.loadAsync('assets/models/brewery/Brewery_LagerTank.glb'),
            35000,
            'brewery/Brewery_LagerTank.glb'
        );
        lagerTankTemplate = lagGltf.scene;
    } catch (e) {
        console.warn('Brewery_LagerTank.glb missing — no lager tank prop.', e?.message || e);
    }

    let recipeTerminalTemplate = null;
    try {
        const termGltf = await withTimeout(
            loader.loadAsync('assets/models/recipe_terminal/terminal.glb'),
            45000,
            'recipe_terminal/terminal.glb'
        );
        recipeTerminalTemplate = termGltf.scene;
    } catch (e) {
        console.warn('recipe_terminal terminal.glb missing — trying legacy kiosk.', e?.message || e);
        try {
            const termGltf = await withTimeout(
                loader.loadAsync('assets/models/recipe_terminal/scene.gltf'),
                35000,
                'recipe_terminal/scene.gltf'
            );
            recipeTerminalTemplate = termGltf.scene;
        } catch (e2) {
            console.warn('recipe_terminal glTF missing — procedural recipe kiosk.', e2?.message || e2);
        }
    }

    let taproomChandelierTemplate = null;
    try {
        const chGltf = await withTimeout(
            loader.loadAsync('assets/models/ufo_modern_chandelier/scene.gltf'),
            35000,
            'ufo_modern_chandelier/scene.gltf'
        );
        taproomChandelierTemplate = chGltf.scene;
    } catch (e) {
        console.warn('ufo_modern_chandelier glTF missing — taproom keeps pendant lights.', e?.message || e);
    }

    let kegTemplate = null;
    try {
        const kegGltf = await withTimeout(
            loader.loadAsync('assets/models/old_keg/scene.gltf'),
            25000,
            'old_keg/scene.gltf'
        );
        kegTemplate = prepareKegTemplate(kegGltf.scene);
    } catch (e) {
        console.warn('old_keg glTF missing — keg station uses procedural cylinders.', e?.message || e);
    }

    /** Floor pickup / carry — scaled to ~0.35 m tall, feet near y=0 */
    let grainBucketTemplate = null;
    try {
        const bucketGltf = await withTimeout(
            loader.loadAsync('assets/models/grain_bucket/old_upcycled_5_gallon_paint_bucket.glb'),
            25000,
            'grain_bucket old_upcycled_5_gallon_paint_bucket.glb'
        );
        const root = bucketGltf.scene.clone(true);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const h = box.max.y - box.min.y;
        const targetH = 0.36;
        const s = targetH / Math.max(0.001, h);
        root.scale.setScalar(s);
        root.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(root);
        root.position.set(
            -(box2.min.x + box2.max.x) * 0.5,
            -box2.min.y,
            -(box2.min.z + box2.max.z) * 0.5
        );
        root.traverse((o) => {
            if (o.isMesh) {
                o.castShadow = false;
                o.receiveShadow = true;
            }
        });
        grainBucketTemplate = root;
    } catch (e) {
        console.warn('grain bucket GLB missing — bucket uses a simple fallback mesh.', e?.message || e);
    }

    let grainMillTemplate = null;
    try {
        const millGltf = await withTimeout(
            loader.loadAsync('assets/models/grain_mill/arcade_machine.glb'),
            45000,
            'grain_mill arcade_machine.glb'
        );
        grainMillTemplate = prepareGrainMillTemplate(millGltf.scene);
    } catch (e) {
        console.warn('arcade_machine.glb missing — trying legacy mill GLB.', e?.message || e);
        try {
            const millGltf = await withTimeout(
                loader.loadAsync('assets/models/grain_mill/Meshy_AI_Neon_Blue_Grain_Mill_0418191242_texture.glb'),
                25000,
                'grain_mill Meshy_AI_Neon_Blue_Grain_Mill_0418191242_texture.glb'
            );
            grainMillTemplate = prepareGrainMillTemplate(millGltf.scene);
        } catch (e2) {
            console.warn('grain mill GLB missing — using procedural mill.', e2?.message || e2);
        }
    }

    return {
        textures,
        patronTemplate,
        brewerTemplate,
        envTexture,
        furnitureChairTemplate,
        beerTapTemplate,
        beerFermenterTemplate,
        mashTunTemplate,
        lagerTankTemplate,
        recipeTerminalTemplate,
        taproomChandelierTemplate,
        kegTemplate,
        grainBucketTemplate,
        grainMillTemplate,
    };
}
