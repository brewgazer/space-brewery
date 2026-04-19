import * as THREE from 'three';
import { getIngredientById } from './Ingredient.js';

function removeGrist(visualRoot) {
    const g = visualRoot.userData._bucketGristGroup;
    if (!g) return;
    visualRoot.remove(g);
    g.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
            m?.dispose?.();
        }
    });
    visualRoot.userData._bucketGristGroup = null;
}

function averageColorFromIds(ingredientIds) {
    const present = (ingredientIds || []).filter(Boolean);
    if (present.length === 0) return 0x9a7a4a;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const id of present) {
        const c = getIngredientById(id)?.color ?? 0x8a6a3a;
        r += (c >> 16) & 255;
        g += (c >> 8) & 255;
        b += c & 255;
    }
    const n = present.length;
    r = Math.round(r / n);
    g = Math.round(g / n);
    b = Math.round(b / n);
    return (r << 16) | (g << 8) | b;
}

/**
 * Adds or updates visible grist inside the bucket mesh (world-space sizing).
 * Call after the bucket root is placed and matrixWorld is up to date.
 * @param {THREE.Object3D} visualRoot — cloned bucket template or procedural bucket group
 * @param {[string|null,string|null,string|null]|null} ingredientIds
 */
export function applyBucketGristFill(visualRoot, ingredientIds) {
    removeGrist(visualRoot);

    const present = (ingredientIds || []).filter(Boolean);
    const n = present.length;
    if (n === 0) return;

    visualRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(visualRoot);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;

    const fullH = box.max.y - box.min.y;
    const fullW = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    if (fullH < 0.02 || fullW < 0.02) return;

    const rim = fullH * 0.06;
    const maxFillH = fullH * 0.68;
    const fillH = Math.max(0.03, (n / 3) * maxFillH);
    const rBot = fullW * 0.34;
    const rTop = fullW * 0.31;

    const col = averageColorFromIds(ingredientIds);
    const mat = new THREE.MeshStandardMaterial({
        color: col,
        roughness: 0.94,
        metalness: 0.02,
        flatShading: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });
    mat.emissive = new THREE.Color(col);
    mat.emissive.multiplyScalar(0.18);

    const gristGroup = new THREE.Group();
    gristGroup.name = 'bucketGrist';

    const mound = new THREE.Mesh(
        new THREE.CylinderGeometry(rTop * 0.88, rBot * 0.96, fillH, 20, 1),
        mat
    );
    mound.castShadow = false;
    mound.receiveShadow = true;
    gristGroup.add(mound);

    const worldMid = new THREE.Vector3(
        (box.min.x + box.max.x) * 0.5,
        box.min.y + rim + fillH * 0.5,
        (box.min.z + box.max.z) * 0.5
    );
    const localMid = visualRoot.worldToLocal(worldMid);
    gristGroup.position.copy(localMid);

    visualRoot.add(gristGroup);
    visualRoot.userData._bucketGristGroup = gristGroup;
}
