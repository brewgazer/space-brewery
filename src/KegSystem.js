import * as THREE from 'three';

/** Tight pyramid: 3 + 2 + 1 windowed rows, then overflow in a line (world space near keg station). */
const PYR_SLOT_X = 0.78;
const PYR_BASE_X = 11.35;
const PYR_BASE_Z = -1.05;
/** Nominal vertical step between stacked barrel layers (lying horizontal). */
const PYR_STACK_Y = 0.48;
const PYR_ROWS = [3, 2, 1];
const PYR_TOTAL = PYR_ROWS.reduce((a, b) => a + b, 0);

/** @returns {{ x: number, z: number, layer: number }} */
function kegPyramidSlot(index) {
    let idx = 0;
    for (let layer = 0; layer < PYR_ROWS.length; layer++) {
        const n = PYR_ROWS[layer];
        if (index < idx + n) {
            const s = index - idx;
            let x;
            if (n === 3) {
                const offs = [-PYR_SLOT_X, 0, PYR_SLOT_X];
                x = PYR_BASE_X + offs[s];
            } else if (n === 2) {
                const offs = [-PYR_SLOT_X * 0.5, PYR_SLOT_X * 0.5];
                x = PYR_BASE_X + offs[s];
            } else {
                x = PYR_BASE_X;
            }
            return { x, z: PYR_BASE_Z, layer };
        }
        idx += n;
    }
    const o = index - PYR_TOTAL;
    return {
        x: PYR_BASE_X + PYR_SLOT_X * 1.85 + o * 0.72,
        z: PYR_BASE_Z - 0.55,
        layer: 0,
    };
}

/** Status light above each tap (recipe color / empty red). */
export function syncTapIndicatorMaterial(tap, hex) {
    const m = tap?.knob?.material;
    if (!m) return;
    m.color.setHex(hex);
    if (m.emissive) {
        m.emissive.setHex(hex);
        m.emissive.multiplyScalar(0.28);
    }
}

export class KegSystem {
    /**
     * @param {THREE.Object3D | null} kegTemplate — scaled old_keg glTF clone source (see AssetLoader).
     * @param {Array<{ mesh: THREE.Object3D, box: THREE.Box3 }>|null} colliders — shared with Player (XZ cylinder vs AABB).
     */
    constructor(scene, kegStation, taps, gameState, audioSystem, kegTemplate = null, colliders = null) {
        this.scene = scene;
        this.kegStation = kegStation;
        this.taps = taps;
        this.gameState = gameState;
        this.audio = audioSystem;
        this.kegTemplate = kegTemplate;
        this.colliders = colliders;
        /** @type {{ mesh: THREE.Object3D, box: THREE.Box3 }[]} */
        this._kegColliderRefs = [];
        this.selectingKeg = null;
        this.maxServingsPerKeg = 5;
        this._tapsDirty = false;
    }

    _clearKegColliders() {
        if (!this.colliders || !this._kegColliderRefs.length) {
            this._kegColliderRefs = [];
            return;
        }
        for (const c of this._kegColliderRefs) {
            const ix = this.colliders.indexOf(c);
            if (ix >= 0) this.colliders.splice(ix, 1);
        }
        this._kegColliderRefs = [];
    }

    _addKegCollider(mesh) {
        if (!this.colliders) return;
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        const entry = { mesh, box };
        this.colliders.push(entry);
        this._kegColliderRefs.push(entry);
    }

    interactKegStation(player, animPlayer) {
        if (player.carrying && player.carrying.type === 'beer') {
            const keg = {
                recipe: player.carrying.recipe,
                servings: this.maxServingsPerKeg,
                id: Date.now(),
                batchValid: player.carrying.batchValid !== false,
                premiumLager: player.carrying.premiumLager === true,
            };
            this.gameState.kegs.push(keg);
            player.carrying = null;
            this.audio.playKeg();
            animPlayer?.playBrewerGesture?.('grabWort');
            this._updateKegVisuals();
            return;
        }

        if (!player.carrying) {
            this.audio.playError();
        }
    }

    interactTap(tapIndex, player, customerSystem, animPlayer) {
        const tap = this.taps[tapIndex];
        if (!tap?.unlocked) return;

        // If tap has a keg loaded, serve a customer
        if (tap.keg) {
            const served = customerSystem.serveCustomer(
                tap.keg.recipe,
                tap.keg.batchValid !== false,
                tap.keg.premiumLager === true
            );
            if (served) {
                tap.keg.servings--;
                this._tapsDirty = true;
                this.audio.playServe();
                animPlayer?.playBrewerGesture?.('pour');

                if (tap.keg.servings <= 0) {
                    tap.keg = null;
                    syncTapIndicatorMaterial(tap, 0xff0000);
                }
                return;
            } else {
                this.audio.playError();
                return;
            }
        }

        // If tap empty and kegs available, let player assign one
        if (!tap.keg && this.gameState.kegs.length > 0) {
            this.selectingKeg = tapIndex;
            return;
        }

        this.audio.playError();
    }

    selectKeg(kegIndex) {
        if (this.selectingKeg === null) return;
        if (kegIndex >= this.gameState.kegs.length) {
            this.selectingKeg = null;
            return;
        }

        const keg = this.gameState.kegs.splice(kegIndex, 1)[0];
        const tap = this.taps[this.selectingKeg];
        if (!tap) {
            this.selectingKeg = null;
            return;
        }
        tap.keg = keg;
        syncTapIndicatorMaterial(tap, keg.recipe.color);
        this._tapsDirty = true;
        this._updateKegVisuals();
        this.audio.playKeg();
        this.selectingKeg = null;
    }

    untapKeg(tapIndex) {
        const tap = this.taps[tapIndex];
        if (!tap?.unlocked || !tap.keg) return false;
        if (tap.keg.servings < this.maxServingsPerKeg) return false;

        this.gameState.kegs.push(tap.keg);
        tap.keg = null;
        syncTapIndicatorMaterial(tap, 0xff0000);
        this._tapsDirty = true;
        this._updateKegVisuals();
        this.audio.playKeg();
        return true;
    }

    cancelSelection() {
        this.selectingKeg = null;
    }

    _updateTapLabel(tap, index) {
        const text = tap.keg ? `${tap.keg.recipe.name} (${tap.keg.servings})` : `Tap ${index + 1}`;
        const color = tap.keg ? 0xffdd44 : 0xcccccc;
        // Skip entirely if nothing changed — avoids the CanvasTexture rebuild storm on
        // every pour or tap reassignment when only one tap actually changed.
        if (tap._labelText === text && tap._labelColor === color) return;

        const parent = tap.label.parent;
        const pos = tap.label.position;
        // Dispose the old sprite's map+material (was leaking GPU memory per tap update).
        const old = tap.label;
        parent.remove(old);
        old.material?.map?.dispose?.();
        old.material?.dispose?.();

        tap.label = this._createTextSprite(text, color);
        tap.label.position.copy(pos);
        parent.add(tap.label);
        tap._labelText = text;
        tap._labelColor = color;
    }

    updateTapLabels() {
        if (!this._tapsDirty) return;
        this._tapsDirty = false;
        this.taps.forEach((tap, i) => {
            if (tap?.unlocked) this._updateTapLabel(tap, i);
        });
    }

    _updateKegVisuals() {
        this._clearKegColliders();
        this.kegStation.kegMeshes.forEach((m) => this.scene.remove(m));
        this.kegStation.kegMeshes = [];

        this.gameState.kegs.forEach((keg, i) => {
            const { x: px, z: pz, layer } = kegPyramidSlot(i);

            if (this.kegTemplate) {
                const root = this.kegTemplate.clone(true);
                root.rotation.x = Math.PI / 2;
                root.position.set(px, 0, pz);
                this.scene.add(root);
                root.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(root);
                root.position.y = -box.min.y + layer * PYR_STACK_Y;
                this.kegStation.kegMeshes.push(root);
                this._addKegCollider(root);
            } else {
                const mesh = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.4, 0.4, 1.0, 8),
                    new THREE.MeshStandardMaterial({
                        color: 0xc8c8d0,
                        metalness: 0.62,
                        roughness: 0.34,
                        envMapIntensity: 1.0,
                    })
                );
                mesh.rotation.x = Math.PI / 2;
                mesh.position.set(px, 0, pz);
                this.scene.add(mesh);
                mesh.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(mesh);
                mesh.position.y = -box.min.y + layer * PYR_STACK_Y;
                this.kegStation.kegMeshes.push(mesh);
                this._addKegCollider(mesh);
            }

            const band = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.3, 0.24, 10),
                new THREE.MeshStandardMaterial({
                    color: keg.recipe.color,
                    metalness: 0.15,
                    roughness: 0.45,
                    envMapIntensity: 0.55,
                })
            );
            band.rotation.x = Math.PI / 2;
            const ref = this.kegStation.kegMeshes[this.kegStation.kegMeshes.length - 1];
            band.position.copy(ref.position);
            this.scene.add(band);
            this.kegStation.kegMeshes.push(band);
        });
    }

    _createTextSprite(text, color = 0xffffff) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const hex = '#' + new THREE.Color(color).getHexString();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(text, 128, 32);
        ctx.fillStyle = hex;
        ctx.fillText(text, 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.5, 0.4, 1);
        return sprite;
    }
}
