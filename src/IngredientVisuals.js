import * as THREE from 'three';
import { getIngredientById } from './Ingredient.js';

function makeBurlapTexture(seed = 1) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6b5a45';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
        const x = (Math.sin(i * 12.9898 + seed) * 43758.5453) % 1;
        const px = ((x * 1000) % 128 + 128) % 128;
        const py = (i * 17 + seed * 31) % 128;
        ctx.fillStyle = `rgba(${40 + (i % 40)},${30 + (i % 35)},${20 + (i % 25)},0.12)`;
        ctx.fillRect(px, py, 2, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
}

/** Loose floor pickup: malt-style sack or hops cluster (no external assets). */
export function createIngredientFloorVisual(ingredientId) {
    const ing = getIngredientById(ingredientId);
    const group = new THREE.Group();
    if (!ing) return group;

    const isHops = ingredientId === 'hopsA' || ingredientId === 'hopsB';

    if (isHops) {
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.035, 0.12, 6),
            new THREE.MeshStandardMaterial({
                color: 0x5c4a32,
                roughness: 0.9,
                metalness: 0.05,
            })
        );
        stem.position.y = 0.06;
        group.add(stem);

        const coneGeo = new THREE.ConeGeometry(0.055, 0.14, 7);
        const hopMats = [];
        for (let i = 0; i < 14; i++) {
            const leafMat = new THREE.MeshStandardMaterial({
                color: ing.color,
                roughness: 0.42,
                metalness: 0.08,
                envMapIntensity: 0.65,
                emissive: new THREE.Color(ing.color).multiplyScalar(0.08),
            });
            hopMats.push(leafMat);
            const cone = new THREE.Mesh(coneGeo, leafMat);
            const a = (i / 14) * Math.PI * 2 + i * 0.31;
            const tilt = 0.35 + (i % 5) * 0.12;
            cone.position.set(Math.cos(a) * 0.06, 0.14 + (i % 3) * 0.04, Math.sin(a) * 0.06);
            cone.rotation.z = Math.cos(a) * tilt;
            cone.rotation.x = Math.sin(a) * tilt;
            group.add(cone);
        }
        group.position.y = 0.02;
        group.userData._disposeCustom = () => {
            coneGeo.dispose();
            for (const m of hopMats) m.dispose();
            stem.geometry.dispose();
            stem.material.dispose();
        };
    } else {
        const burlap = makeBurlapTexture(ingredientId.length * 7);
        const base = new THREE.Color(ing.color);
        const sackMat = new THREE.MeshStandardMaterial({
            map: burlap,
            color: base,
            roughness: 0.88,
            metalness: 0.06,
            envMapIntensity: 0.55,
        });

        const body = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.92),
            sackMat
        );
        body.scale.set(1, 0.85, 0.78);
        body.position.y = 0.2;
        group.add(body);

        const top = new THREE.Mesh(
            new THREE.TorusGeometry(0.1, 0.045, 8, 16, Math.PI * 1.1),
            sackMat
        );
        top.rotation.x = Math.PI / 2;
        top.position.y = 0.38;
        group.add(top);

        const seam = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.28, 0.04),
            new THREE.MeshStandardMaterial({ color: 0x4a4035, roughness: 0.95 })
        );
        seam.position.set(0, 0.22, 0.2);
        group.add(seam);

        group.userData._disposeCustom = () => {
            burlap.dispose();
            body.geometry.dispose();
            top.geometry.dispose();
            seam.geometry.dispose();
            sackMat.dispose();
            seam.material.dispose();
        };
    }

    group.userData.disposeIngredientVisual = () => {
        group.userData._disposeCustom?.();
    };

    return group;
}

export function createMilledGristFloorVisual() {
    const group = new THREE.Group();
    const burlap = makeBurlapTexture(99);
    const mat = new THREE.MeshStandardMaterial({
        map: burlap,
        color: 0x9a7b4a,
        roughness: 0.9,
        metalness: 0.05,
        envMapIntensity: 0.5,
    });
    const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 14, 11, 0, Math.PI * 2, 0, Math.PI * 0.9),
        mat
    );
    body.scale.set(1.05, 0.82, 0.88);
    body.position.y = 0.22;
    group.add(body);
    const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.035, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.85 })
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.36;
    group.add(band);
    group.userData._disposeCustom = () => {
        burlap.dispose();
        body.geometry.dispose();
        mat.dispose();
        band.geometry.dispose();
        band.material.dispose();
    };
    group.userData.disposeIngredientVisual = () => {
        group.userData._disposeCustom?.();
    };
    return group;
}
