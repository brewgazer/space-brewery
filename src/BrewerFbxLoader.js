import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { pickPatronClips } from './PatronClipUtils.js';
import { retargetClipToModel } from './BrewerClipRetarget.js';

const TARGET_HEIGHT = 1.74;

function encPath(path) {
    return path
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
}

function basenameNoExt(url) {
    const base = url.split('/').pop() || url;
    const dec = decodeURIComponent(base);
    const i = dec.lastIndexOf('.');
    return i > 0 ? dec.slice(0, i) : dec;
}

/** World-space AABB from rendered meshes only (bone empties often skew full-object bounds). */
function meshWorldBox3(root, out = new THREE.Box3()) {
    root.updateMatrixWorld(true);
    const tmp = new THREE.Box3();
    let any = false;
    root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (!any) {
            out.copy(tmp);
            any = true;
        } else {
            out.union(tmp);
        }
    });
    return any ? out : null;
}

/** Lift model so the lowest mesh vertex sits on y=0 (fixes half-buried FBX pivots). */
function alignFeetToGround(root) {
    root.updateMatrixWorld(true);
    const box = meshWorldBox3(root) || new THREE.Box3().setFromObject(root);
    root.position.y += -box.min.y;
    root.updateMatrixWorld(true);
}

function scaleToHeight(root, targetH) {
    root.updateMatrixWorld(true);
    const box = meshWorldBox3(root) || new THREE.Box3().setFromObject(root);
    const h = box.max.y - box.min.y;
    const s = targetH / Math.max(0.001, h);
    root.scale.setScalar(s);
    root.updateMatrixWorld(true);
}

export async function loadBrewerFbxAssets(withTimeout) {
    const loader = new FBXLoader();
    const load = (path) => withTimeout(loader.loadAsync(encPath(path)), 60000, path);

    const modelCandidates = [
        'assets/brewer/space brewer character/space brewer/Meshy_AI_space_brewer_0409020336_texture.fbx',
        'assets/brewer/SpaceBrewer.fbx',
        'assets/brewer/Brewer.fbx',
        'assets/brewer/space_brewer.fbx',
        'assets/brewer/Character.fbx',
    ];

    let root = null;
    let loadedModelPath = null;
    for (const p of modelCandidates) {
        try {
            root = await load(p);
            loadedModelPath = p;
            break;
        } catch {
            /* try next */
        }
    }
    if (!root) return null;

    scaleToHeight(root, TARGET_HEIGHT);
    alignFeetToGround(root);

    const anims = [...(root.animations || [])];
    const picked = pickPatronClips(anims);
    let idle = picked.idle;
    let walk = picked.walk || picked.idle;

    const tryClipFromFile = async (path) => {
        try {
            const fbx = await load(path);
            const c = fbx.animations?.[0];
            if (c) {
                c.name = basenameNoExt(path);
                return c;
            }
        } catch {
            /* missing */
        }
        return null;
    };

    const animDir = 'assets/brewer/space brewer animations';

    const extIdle = await tryClipFromFile(`${animDir}/idle.fbx`);
    if (extIdle) {
        idle = retargetClipToModel(extIdle, root) || extIdle;
    }

    const extWalk = await tryClipFromFile(`${animDir}/Walking.fbx`);
    if (extWalk) {
        walk = retargetClipToModel(extWalk, root) || extWalk;
    }
    if (!walk) walk = idle;

    const kickDirs = [
        `${animDir}/kicking out animations`,
        'assets/brewer/kicking out animaions',
        'assets/brewer/kicking out animations',
        'assets/brewer/kicking_out_animations',
    ];

    let yellClip = null;
    let pointClip = null;

    for (const dir of kickDirs) {
        const y =
            (await tryClipFromFile(`${dir}/Yelling.fbx`)) ||
            (await tryClipFromFile(`${dir}/yell.fbx`)) ||
            (await tryClipFromFile(`${dir}/1.fbx`));
        const pt =
            (await tryClipFromFile(`${dir}/Pointing.fbx`)) ||
            (await tryClipFromFile(`${dir}/point.fbx`)) ||
            (await tryClipFromFile(`${dir}/2.fbx`));
        if (y) yellClip = retargetClipToModel(y, root) || y;
        if (pt) pointClip = retargetClipToModel(pt, root) || pt;
        if (yellClip && pointClip) break;
    }

    root.updateMatrixWorld(true);
    const box2 = meshWorldBox3(root) || new THREE.Box3().setFromObject(root);
    const bubbleY = box2.max.y + 0.34;

    return {
        scene: root,
        clips: {
            idle,
            walk,
            yell: yellClip,
            point: pointClip,
        },
        animations: anims,
        bubbleY,
        sourcePath: loadedModelPath,
        walkYawOffset: Math.PI,
    };
}
