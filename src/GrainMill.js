import * as THREE from 'three';

/**
 * Centralized grain mill state (safe for single shared station / future multiplayer host).
 */
export class GrainMill {
    constructor(audioSystem, visuals, callbacks = {}) {
        this.audio = audioSystem;
        /** @type {{ progressFill: THREE.Mesh, progressBg: THREE.Mesh, hopper: THREE.Object3D | null }} */
        this.visuals = visuals;
        /** Called after a full bucket dump so an empty bucket can sit by the mill while milling. */
        this.placeBucketAtMill = callbacks.placeBucketAtMill ?? null;
        /** Remove the mill’s waiting bucket (reset / day restart). */
        this.clearMillBucket = callbacks.clearMillBucket ?? null;
        this.slots = [null, null, null];
        this.state = 'idle';
        this.progress = 0;
        this.duration = 13;
        this.time = 0;
        /** @type {((ingredients: string[]) => void) | null} */
        this.onMillComplete = null;

        this._cA = new THREE.Color();
        this._cB = new THREE.Color();

        /** @type {THREE.Vector3 | null} */
        this._hopperRestPos = null;
        /** @type {THREE.Euler | null} */
        this._hopperRestRot = null;
    }

    _captureHopperRest() {
        const h = this.visuals.hopper;
        if (!h) return;
        this._hopperRestPos = h.position.clone();
        this._hopperRestRot = new THREE.Euler().copy(h.rotation);
    }

    _restoreHopperRest() {
        const h = this.visuals.hopper;
        if (!h || !this._hopperRestPos || !this._hopperRestRot) return;
        h.position.copy(this._hopperRestPos);
        h.rotation.copy(this._hopperRestRot);
    }

    /** Fast rattling shake while milling (no continuous spin). */
    _applyHopperRattle() {
        const h = this.visuals.hopper;
        if (!h || !this._hopperRestPos || !this._hopperRestRot) return;
        const t = this.time;
        const ap = 0.0038;
        const ar = 0.018;
        const x =
            Math.sin(t * 47.3) * Math.cos(t * 31.9) + Math.sin(t * 89.1) * 0.45;
        const y =
            Math.sin(t * 53.8) * Math.cos(t * 44.2) + Math.cos(t * 76.4) * 0.35;
        const z =
            Math.cos(t * 41.1) * Math.sin(t * 58.6) + Math.sin(t * 94.7) * 0.4;
        const rx =
            Math.sin(t * 62.4) * Math.cos(t * 28.3) + Math.sin(t * 103.2) * 0.3;
        const ry =
            Math.sin(t * 51.1) * Math.cos(t * 67.8);
        const rz =
            Math.cos(t * 73.6) * Math.sin(t * 36.4) + Math.cos(t * 88.9) * 0.35;

        h.position.set(
            this._hopperRestPos.x + x * ap,
            this._hopperRestPos.y + y * ap,
            this._hopperRestPos.z + z * ap
        );
        h.rotation.set(
            this._hopperRestRot.x + rx * ar,
            this._hopperRestRot.y + ry * ar,
            this._hopperRestRot.z + rz * ar
        );
    }

    get filledCount() {
        return this.slots.filter(Boolean).length;
    }

    isFull() {
        return this.filledCount >= 3;
    }

    tryInsert(ingredientId) {
        if (this.state === 'milling') return { ok: false, code: 'busy' };
        if (this.isFull()) return { ok: false, code: 'full' };
        const i = this.slots.findIndex((s) => s == null);
        this.slots[i] = ingredientId;
        return { ok: true };
    }

    /** Start milling if possible. Returns { ok } */
    tryStartMilling() {
        if (this.state === 'milling') return { ok: false, code: 'busy' };
        if (this.filledCount < 3) return { ok: false, code: 'missing' };
        this.state = 'milling';
        this.progress = 0;
        this._captureHopperRest();
        this.visuals.progressFill.visible = true;
        this.visuals.progressBg.visible = true;
        this.audio?.playBrewStart?.();
        return { ok: true };
    }

    update(delta) {
        this.time += delta;

        if (this.state === 'milling') {
            this.progress += delta / this.duration;
            const p = Math.min(1, this.progress);
            const barWidth = 1.6;
            this.visuals.progressFill.scale.x = Math.max(0.001, p);
            this.visuals.progressFill.position.x = -(barWidth * (1 - p)) / 2;

            this._cA.set(0x44aa44);
            this._cB.set(0xaaaa22);
            this.visuals.progressFill.material.color.copy(this._cA.lerp(this._cB, p));

            if (this.visuals.hopper) {
                this._applyHopperRattle();
            }

            if (this.progress >= 1) {
                this._restoreHopperRest();
                const ingredients = [...this.slots];
                this.slots = [null, null, null];
                this.state = 'idle';
                this.progress = 0;
                this.visuals.progressFill.visible = false;
                this.visuals.progressFill.scale.x = 0;
                this.visuals.progressFill.material.color.setHex(0x44aa44);
                this.audio?.playBrewComplete?.();
                if (typeof this.onMillComplete === 'function') {
                    this.onMillComplete(ingredients);
                }
            }
        }
    }

    reset() {
        if (typeof this.clearMillBucket === 'function') {
            this.clearMillBucket();
        }
        this._restoreHopperRest();
        this.slots = [null, null, null];
        this.state = 'idle';
        this.progress = 0;
        if (this.visuals?.progressFill) {
            this.visuals.progressFill.visible = false;
            this.visuals.progressFill.scale.x = 0;
        }
    }

    /**
     * @returns {boolean} true if this interaction consumed the target (grain mill handles E).
     */
    interact(player, ui, animPlayer) {
        if (this.state === 'milling') {
            this.audio?.playError?.();
            return true;
        }

        if (player.carrying?.type === 'ingredient') {
            const r = this.tryInsert(player.carrying.ingredientId);
            if (r.ok) {
                player.carrying = null;
                this.audio?.playPickup?.();
                animPlayer?.playBrewerGesture?.('grabMix');
            } else if (r.code === 'full') {
                this.audio?.playError?.();
                ui?.showNotification?.('Grain Mill Full', 'rgba(120,40,20,0.92)', 2200);
            }
            return true;
        }

        const idsBucket = player.carrying?.type === 'bucket' ? player.carrying.ingredientIds : null;
        const bucketFull =
            Array.isArray(idsBucket) && idsBucket.length === 3 && idsBucket.every(Boolean);
        const bucketEmpty =
            Array.isArray(idsBucket) && idsBucket.length === 3 && !idsBucket.some(Boolean);
        const bucketPartial =
            Array.isArray(idsBucket) && idsBucket.some(Boolean) && !idsBucket.every(Boolean);

        if (player.carrying?.type === 'bucket' && bucketPartial) {
            this.audio?.playError?.();
            ui?.showNotification?.(
                'Finish filling the bucket at the ingredient bins',
                'rgba(110,55,25,0.9)',
                2400
            );
            return true;
        }

        if (player.carrying?.type === 'bucket' && bucketFull) {
            if (player.carrying.milled) {
                this.audio?.playError?.();
                ui?.showNotification?.(
                    'This grist is already milled — take it to a brew kettle',
                    'rgba(120,40,20,0.92)',
                    2400
                );
                return true;
            }
            if (this.filledCount > 0) {
                this.audio?.playError?.();
                ui?.showNotification?.('Empty the mill hopper first', 'rgba(120,40,20,0.92)', 2200);
                return true;
            }
            const dumped = [...idsBucket];
            this.slots = [...dumped];
            player.carrying = null;
            this.audio?.playPickup?.();
            animPlayer?.playBrewerGesture?.('grabMix');
            if (typeof this.placeBucketAtMill === 'function') {
                this.placeBucketAtMill();
            }
            const r = this.tryStartMilling();
            if (!r.ok) {
                this.slots = [null, null, null];
                player.carrying = { type: 'bucket', ingredientIds: dumped };
                this.audio?.playError?.();
            }
            return true;
        }

        const canPressMill =
            !player.carrying || (player.carrying?.type === 'bucket' && bucketEmpty);
        if (canPressMill && this.filledCount === 3) {
            const r = this.tryStartMilling();
            if (!r.ok && r.code === 'missing') {
                this.audio?.playError?.();
                ui?.showNotification?.('Missing Ingredients', 'rgba(120,40,20,0.92)', 2200);
            }
            return true;
        }

        if (player.carrying?.type === 'bucket' && bucketEmpty && this.filledCount < 3) {
            this.audio?.playError?.();
            ui?.showNotification?.(
                'Bucket empty — fill at bins, then dump here',
                'rgba(90,55,30,0.9)',
                2600
            );
            return true;
        }

        if (player.carrying) {
            this.audio?.playError?.();
            return true;
        }

        return true;
    }
}
