import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { retargetClipToModel } from './BrewerClipRetarget.js';

/** Match taproom scale (same idea as FBX brewer). */
const TARGET_HEIGHT_METERS = 1.74;
const BASE = 'assets/brewer/player_glb';

/**
 * Y rotation added to movement / idle yaw so the mesh faces travel direction.
 * Mixamo GLB in this pack aligns with atan2(dir.x, dir.z); FBX brewer used +π instead.
 */
export const BREWER_GLB_WALK_YAW_OFFSET = 0;

/** Optional override atlas (same UV layout as Meshy export). */
const DIFFUSE_TEX_PATH = 'assets/textures/player_brewer_diffuse.png';

/**
 * Alternate diffuse for the "blue outfit" colour slot. Same UV layout as the
 * default brewer atlas — only the body panels are repainted so face, hair
 * and extremities stay identical when we swap `material.map`. Loaded
 * eagerly alongside the rig so clones can re-map without an async hop.
 */
const BLUE_SUIT_TEX_PATH = 'assets/textures/player_brewer_bluesuit_diffuse.png';

/** Bind-pose mesh AABB often sits slightly above the soles; nudge into the floor contact. */
const FOOT_CONTACT_SINK_METERS = 0.022;

/**
 * World AABB for the whole rig. SkinnedMesh `geometry.boundingBox` alone is often a tiny bind-pose
 * hull — using only that makes `scaleToHeight` explode and fills the screen with one leg.
 */
function worldBounds(root) {
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(root);
}

/**
 * Snap feet to y=0 using mesh bounds (skin bind pose), not full `setFromObject` hull
 * (idle pose / expanded skin bounds can leave the rig floating).
 */
function alignFeetToGround(root) {
    root.updateMatrixWorld(true);
    let minY = Infinity;
    root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const b = new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        minY = Math.min(minY, b.min.y);
    });
    if (Number.isFinite(minY)) {
        root.position.y -= minY;
    } else {
        const box = worldBounds(root);
        root.position.y -= box.min.y;
    }
    root.updateMatrixWorld(true);
}

function scaleToHeight(root, targetH) {
    const box = worldBounds(root);
    const h = Math.max(0.001, box.max.y - box.min.y);
    let s = targetH / h;
    s = Math.min(s, 80);
    root.scale.setScalar(s);
    root.updateMatrixWorld(true);
}

function encPath(path) {
    return path
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
}

/**
 * `player_brewer.glb` in this pack is often a static mesh only (no skin).
 * Clips live in separate files that include the Mixamo rig — retarget onto `rigRoot`.
 */
function clipForRig(loader, withTimeout, relPath, rigRoot, clipName) {
    const path = `${BASE}/${relPath}`;
    return withTimeout(loader.loadAsync(encPath(path)), 60000, path)
        .then((gltf) => {
            const raw = gltf.animations?.[0];
            if (!raw) return null;
            const named = raw.clone();
            named.name = clipName;
            const ret = retargetClipToModel(named, rigRoot);
            if (ret?.tracks?.length) return ret;
            return named.tracks?.length ? named : null;
        })
        .catch(() => null);
}

function applyOptionalDiffuse(root, texture) {
    if (!texture) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.needsUpdate = true;
    root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
            if (!m) continue;
            if (m.map && m.map !== texture) {
                m.map.dispose?.();
            }
            m.map = texture;
            m.needsUpdate = true;
        }
    });
}

/**
 * Space brewer: **idle GLB** supplies the skinned Mixamo rig; other GLBs contribute clips.
 * `player_brewer.glb` (T-pose mesh-only) is not used as the animation root.
 */
export async function loadBrewerGlbAssets(withTimeout) {
    const loader = new GLTFLoader();
    const rigPath = `${BASE}/anim_idle.glb`;
    let gltf;
    try {
        gltf = await withTimeout(loader.loadAsync(encPath(rigPath)), 60000, rigPath);
    } catch {
        return null;
    }

    const root = gltf.scene;
    root.updateMatrixWorld(true);
    scaleToHeight(root, TARGET_HEIGHT_METERS);
    alignFeetToGround(root);
    root.position.y -= FOOT_CONTACT_SINK_METERS;
    root.updateMatrixWorld(true);

    const texLoader = new THREE.TextureLoader();
    const loadTex = (path) =>
        new Promise((resolve) => {
            try {
                texLoader.load(
                    encPath(path),
                    (t) => resolve(t),
                    undefined,
                    () => resolve(null)
                );
            } catch {
                resolve(null);
            }
        });
    const [diffuse, blueSuit] = await Promise.all([
        loadTex(DIFFUSE_TEX_PATH),
        loadTex(BLUE_SUIT_TEX_PATH),
    ]);
    applyOptionalDiffuse(root, diffuse);
    // Configure the alternate suit atlas the same way as the base diffuse so
    // callers can assign it directly onto `material.map` without further
    // setup. The actual map-swap happens when the local / remote avatar is
    // spawned for the blue colour slot.
    if (blueSuit) {
        blueSuit.colorSpace = THREE.SRGBColorSpace;
        blueSuit.flipY = false;
        blueSuit.needsUpdate = true;
        // Shared by every blue-outfit player (local + remote). Marking it
        // tells the avatar dispose routines not to dispose() this texture
        // when a player leaves — the same GPU instance is reused for the
        // next blue brewer that spawns.
        blueSuit.userData = { ...(blueSuit.userData || {}), shared: true };
    }

    const idleRaw = gltf.animations?.[0];
    const idle = idleRaw ? idleRaw.clone() : null;
    if (idle) idle.name = 'idle';

    let walk =
        (await clipForRig(loader, withTimeout, 'player_brewer_walking.glb', root, 'walk')) || idle;
    if (!walk) walk = idle;

    const [point, yell, pour, grabMix, grabWort, jump, punch1, punch2] = await Promise.all([
        clipForRig(loader, withTimeout, 'anim_point.glb', root, 'point'),
        clipForRig(loader, withTimeout, 'anim_yell.glb', root, 'yell'),
        clipForRig(loader, withTimeout, 'anim_pour.glb', root, 'pour'),
        clipForRig(loader, withTimeout, 'anim_grab_mix.glb', root, 'grabMix'),
        clipForRig(loader, withTimeout, 'anim_grab_wort.glb', root, 'grabWort'),
        clipForRig(loader, withTimeout, 'anim_jump.glb', root, 'jump'),
        clipForRig(loader, withTimeout, 'anim_punch1.glb', root, 'punch1'),
        clipForRig(loader, withTimeout, 'anim_punch2.glb', root, 'punch2'),
    ]);

    root.updateMatrixWorld(true);
    const box2 = worldBounds(root);
    const bubbleY = box2.max.y + 0.34;

    const h = Math.max(0.04, box2.max.y - box2.min.y);
    const vsHuman = THREE.MathUtils.clamp(h / TARGET_HEIGHT_METERS, 0.05, 2.5);

    return {
        scene: root,
        /**
         * Alternate diffuse atlases keyed by semantic name. `default` is what
         * every cloned mesh starts with (already applied to `root`);
         * `blueSuit` is the optional re-paint used when a player picks the
         * blue outfit slot. Callers swap `material.map` to this texture to
         * recolour the body panels without touching the face/hair UVs.
         */
        diffuseVariants: {
            default: diffuse,
            blueSuit: blueSuit,
        },
        clips: {
            idle,
            walk: walk || idle,
            yell,
            point,
            pour,
            grabMix,
            grabWort,
            jump,
            punch1,
            punch2,
        },
        animations: gltf.animations || [],
        bubbleY,
        sourcePath: rigPath,
        walkYawOffset: BREWER_GLB_WALK_YAW_OFFSET,
        viewChestY: box2.min.y + h * 0.95,
        thirdPersonCamDistance: Math.max(0.9, Math.min(4.2, 3.6 * vsHuman)),
        thirdPersonShoulderOffset: Math.max(0.08, Math.min(0.5, 0.4 * vsHuman)),
        thirdPersonMinCamY: Math.max(0.6, Math.min(1.4, 1.35 * vsHuman)),
    };
}
