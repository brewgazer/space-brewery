import * as THREE from 'three';

function disposeMaterial(m) {
    if (!m) return;
    const mats = Array.isArray(m) ? m : [m];
    for (const mat of mats) {
        if (!mat) continue;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((k) => {
            const t = mat[k];
            if (t && t.dispose) t.dispose();
        });
        mat.dispose?.();
    }
}

/**
 * Normalize downloaded furniture so clones sit on y=0 with sensible height.
 * Replaces heavy textured/sheen materials with simple sci-fi hull + seat mats (faster shading).
 */
export function prepareChairTemplate(root) {
    const r = root;
    r.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(r);
    const h = box.max.y - box.min.y;
    const targetH = 0.92;
    const s = targetH / Math.max(0.001, h);
    r.scale.setScalar(s);
    r.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(r);
    r.position.y = -b2.min.y;
    r.updateMatrixWorld(true);

    const hullMat = new THREE.MeshStandardMaterial({
        color: 0x2c3d4f,
        metalness: 0.78,
        roughness: 0.38,
        envMapIntensity: 0.72,
        emissive: new THREE.Color(0x060d18),
        emissiveIntensity: 0.06,
    });
    const seatMat = new THREE.MeshStandardMaterial({
        color: 0x1a4a72,
        metalness: 0.42,
        roughness: 0.48,
        envMapIntensity: 0.85,
        emissive: new THREE.Color(0x103050),
        emissiveIntensity: 0.22,
    });
    const accentMat = new THREE.MeshStandardMaterial({
        color: 0x0f2838,
        metalness: 0.88,
        roughness: 0.28,
        envMapIntensity: 0.65,
        emissive: new THREE.Color(0x1a4080),
        emissiveIntensity: 0.12,
    });

    r.traverse((ch) => {
        if (ch.name && ch.name.toLowerCase().includes('label')) {
            ch.visible = false;
        }
        if (!ch.isMesh) return;

        const prev = ch.material;
        const groupCount = Array.isArray(prev) ? prev.length : 1;
        disposeMaterial(prev);

        const nm = (ch.name || '').toLowerCase();
        let mat = hullMat;
        if (
            nm.includes('cushion')
            || nm.includes('pillow')
            || nm.includes('fabric')
            || nm.includes('upholstery')
            || nm.includes('seat')
            || nm.includes('cloth')
        ) {
            mat = seatMat;
        } else if (nm.includes('leg') || nm.includes('base') || nm.includes('foot')) {
            mat = accentMat;
        }
        ch.material = groupCount > 1 ? Array.from({ length: groupCount }, () => mat) : mat;

        ch.castShadow = false;
        ch.receiveShadow = true;
    });

    r.userData.chairYawExtra = 0;

    return r;
}
