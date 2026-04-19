import * as THREE from 'three';

/**
 * Interactive placement mode: shows a blinking ghost box where the player is aiming,
 * blue when valid, red when it intersects existing colliders (or the player itself),
 * and commits the picked transform through a caller-supplied callback.
 *
 * Typical usage (see main.js `tryBuyStoreObject`):
 *
 *     placementSystem.start({
 *         type: 'fermenter',
 *         label: 'Bio-Tank 2',
 *         footprint: { w: 1.8, h: 3.2, d: 1.8, y: 0 },
 *         bounds: { minX, maxX, minZ, maxZ },
 *         onConfirm: ({ x, z, yaw }) => { ... spawn + deduct ... },
 *         onCancel: () => { ... restore shop ... },
 *     });
 *
 * The caller is expected to:
 *   • call `update(delta)` every frame from the main loop (no-op when inactive);
 *   • call `confirm()` when the player presses the interact key ("E");
 *   • call `cancel()` on Escape.
 */
export class PlacementSystem {
    constructor({ scene, world, gameState, ui, audio, camera, player }) {
        this.scene = scene;
        this.world = world;
        this.gameState = gameState;
        this.ui = ui;
        this.audio = audio;
        this.camera = camera;
        this.player = player;

        this._active = false;
        this._valid = false;
        this._elapsed = 0;

        this._footprint = null;
        this._bounds = null;
        this._onConfirm = null;
        this._onCancel = null;

        this._ghost = null;
        this._fillMat = null;
        this._edgeMat = null;
        this._haloMat = null;

        this._tmpVec = new THREE.Vector3();
        this._tmpDir = new THREE.Vector3();
        this._tmpBox = new THREE.Box3();
        this._tmpMin = new THREE.Vector3();
        this._tmpMax = new THREE.Vector3();
    }

    get active() {
        return this._active;
    }

    /**
     * Enter placement mode. Only one placement may be active at a time; calling
     * `start` while active silently replaces the previous session (no confirm/cancel
     * callbacks are fired).
     *
     * @param {object} cfg
     * @param {string} cfg.type        Placement category (e.g. 'fermenter'/'lagerTank'); informational.
     * @param {string} [cfg.label]     Shown in the on-screen notification.
     * @param {{w:number,h:number,d:number,y?:number}} cfg.footprint
     *                                 Bounding-box dimensions + optional y-origin for the ghost base.
     * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} cfg.bounds
     *                                 World-space XZ rectangle that constrains ghost movement.
     * @param {(transform:{x:number,z:number,yaw:number}) => void} cfg.onConfirm
     * @param {() => void} [cfg.onCancel]
     */
    start(cfg) {
        if (this._active) this._teardownGhost();

        this._active = true;
        this._valid = false;
        this._elapsed = 0;
        this._footprint = { y: 0, ...cfg.footprint };
        this._bounds = cfg.bounds;
        this._onConfirm = cfg.onConfirm || null;
        this._onCancel = cfg.onCancel || null;

        this._buildGhost();

        const name = cfg.label || cfg.type || 'equipment';
        this.ui?.showNotification?.(
            `Placing ${name} — aim where you want it, [E] to place · [Esc] to cancel`,
            'rgba(30,60,110,0.92)',
            3500
        );
    }

    /**
     * Commit the current placement if the spot is valid. No-op when inactive or
     * when the ghost is currently red (plays an error buzzer + notification).
     */
    confirm() {
        if (!this._active) return;
        if (!this._valid) {
            this.audio?.playError?.();
            this.ui?.showNotification?.(
                'Too close to another object — move the marker until it turns blue.',
                'rgba(120,40,40,0.92)',
                1600
            );
            return;
        }
        const transform = {
            x: this._ghost.position.x,
            z: this._ghost.position.z,
            yaw: this._ghost.rotation.y,
        };
        const cb = this._onConfirm;
        this._teardownGhost();
        cb?.(transform);
    }

    /** Exit placement mode without placing; fires the `onCancel` callback if supplied. */
    cancel() {
        if (!this._active) return;
        const cb = this._onCancel;
        this._teardownGhost();
        cb?.();
    }

    /**
     * Per-frame tick. Raycasts the camera against the ground plane, clamps the
     * candidate position to `bounds` and a reachable distance from the player,
     * then updates the ghost's color/opacity depending on collision validity.
     */
    update(delta) {
        if (!this._active || !this._ghost) return;
        this._elapsed += delta;

        const origin = this.camera.getWorldPosition(this._tmpVec);
        const dir = this.camera.getWorldDirection(this._tmpDir);

        // Intersect camera ray with the ground plane (y = footprint.y).
        const groundY = this._footprint.y;
        let hx = origin.x;
        let hz = origin.z;
        if (Math.abs(dir.y) > 1e-4) {
            const tHit = (groundY - origin.y) / dir.y;
            if (tHit > 0) {
                hx = origin.x + dir.x * tHit;
                hz = origin.z + dir.z * tHit;
            } else {
                // Looking up/away from the floor — project forward along the XZ plane instead.
                const horizLen = Math.hypot(dir.x, dir.z) || 1;
                hx = origin.x + (dir.x / horizLen) * 3;
                hz = origin.z + (dir.z / horizLen) * 3;
            }
        }

        // Clamp to a reasonable reach around the player's feet (so the ghost can't
        // fly off to the far side of the room just by aiming up).
        const MAX_REACH = 5.5;
        const MIN_REACH = 1.4;
        const playerX = origin.x;
        const playerZ = origin.z;
        let dx = hx - playerX;
        let dz = hz - playerZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-4) {
            const horizLen = Math.hypot(dir.x, dir.z) || 1;
            dx = (dir.x / horizLen) * MIN_REACH;
            dz = (dir.z / horizLen) * MIN_REACH;
        } else if (dist < MIN_REACH) {
            dx *= MIN_REACH / dist;
            dz *= MIN_REACH / dist;
        } else if (dist > MAX_REACH) {
            dx *= MAX_REACH / dist;
            dz *= MAX_REACH / dist;
        }
        let finalX = playerX + dx;
        let finalZ = playerZ + dz;

        const b = this._bounds;
        const fp = this._footprint;
        const halfW = fp.w * 0.5;
        const halfD = fp.d * 0.5;
        finalX = Math.min(Math.max(finalX, b.minX + halfW), b.maxX - halfW);
        finalZ = Math.min(Math.max(finalZ, b.minZ + halfD), b.maxZ - halfD);

        this._ghost.position.set(finalX, groundY, finalZ);
        this._valid = this._isValidPosition(finalX, finalZ);

        // Blink: sinewave 0..1, full cycle ≈ 1.1s, slightly faster when invalid.
        const speed = this._valid ? 5.0 : 7.5;
        const pulse = 0.5 + 0.5 * Math.sin(this._elapsed * speed);

        const fillColor = this._valid ? 0x40c8ff : 0xff3a4a;
        const emColor = this._valid ? 0x103a60 : 0x4a1018;
        const edgeColor = this._valid ? 0xc0eaff : 0xffc0c8;

        if (this._fillMat) {
            this._fillMat.color.setHex(fillColor);
            this._fillMat.emissive.setHex(emColor);
            this._fillMat.emissiveIntensity = 0.45 + 0.55 * pulse;
            this._fillMat.opacity = 0.18 + 0.32 * pulse;
        }
        if (this._edgeMat) {
            this._edgeMat.color.setHex(edgeColor);
            this._edgeMat.opacity = 0.45 + 0.5 * pulse;
        }
        if (this._haloMat) {
            this._haloMat.color.setHex(fillColor);
            this._haloMat.opacity = 0.2 + 0.35 * pulse;
        }
    }

    _isValidPosition(x, z) {
        const fp = this._footprint;
        const halfW = fp.w * 0.5;
        const halfD = fp.d * 0.5;
        // Shrink the probe slightly (-0.05m) so ghosts that touch walls flush aren't
        // rejected by floating-point jitter, but leave the height at the full value.
        const pad = 0.05;
        this._tmpMin.set(x - halfW + pad, fp.y + 0.05, z - halfD + pad);
        this._tmpMax.set(x + halfW - pad, fp.y + fp.h - 0.05, z + halfD - pad);
        this._tmpBox.min.copy(this._tmpMin);
        this._tmpBox.max.copy(this._tmpMax);

        const b = this._bounds;
        if (
            x - halfW < b.minX ||
            x + halfW > b.maxX ||
            z - halfD < b.minZ ||
            z + halfD > b.maxZ
        ) {
            return false;
        }

        // Block placement on the player themselves so the ghost can't swallow them.
        if (this.player?.avatarPos) {
            const p = this.player.avatarPos;
            const PLAYER_R = 0.55;
            const expandedMinX = this._tmpMin.x - PLAYER_R;
            const expandedMaxX = this._tmpMax.x + PLAYER_R;
            const expandedMinZ = this._tmpMin.z - PLAYER_R;
            const expandedMaxZ = this._tmpMax.z + PLAYER_R;
            if (
                p.x > expandedMinX &&
                p.x < expandedMaxX &&
                p.z > expandedMinZ &&
                p.z < expandedMaxZ
            ) {
                return false;
            }
        }

        const colliders = this.world?.colliders || [];
        for (let i = 0; i < colliders.length; i++) {
            const c = colliders[i];
            const box = c?.box;
            if (!box) continue;
            if (this._tmpBox.intersectsBox(box)) return false;
        }
        return true;
    }

    _buildGhost() {
        const fp = this._footprint;
        const ghost = new THREE.Group();
        ghost.name = 'placement-ghost';

        const boxGeom = new THREE.BoxGeometry(fp.w, fp.h, fp.d);
        this._fillMat = new THREE.MeshStandardMaterial({
            color: 0x40c8ff,
            emissive: 0x103a60,
            emissiveIntensity: 0.8,
            metalness: 0.2,
            roughness: 0.5,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
        });
        const box = new THREE.Mesh(boxGeom, this._fillMat);
        box.position.y = fp.h * 0.5;
        box.renderOrder = 2;
        ghost.add(box);

        const edgeGeom = new THREE.EdgesGeometry(boxGeom);
        this._edgeMat = new THREE.LineBasicMaterial({
            color: 0xc0eaff,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
        });
        const edges = new THREE.LineSegments(edgeGeom, this._edgeMat);
        edges.position.y = fp.h * 0.5;
        edges.renderOrder = 3;
        ghost.add(edges);

        const haloGeom = new THREE.CircleGeometry(Math.max(fp.w, fp.d) * 0.75, 28);
        this._haloMat = new THREE.MeshBasicMaterial({
            color: 0x40c8ff,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
        });
        const halo = new THREE.Mesh(haloGeom, this._haloMat);
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = fp.y + 0.025;
        halo.renderOrder = 1;
        ghost.add(halo);

        this._ghost = ghost;
        this.scene.add(ghost);
    }

    _teardownGhost() {
        this._active = false;
        this._onConfirm = null;
        this._onCancel = null;
        if (this._ghost) {
            this.scene.remove(this._ghost);
            this._ghost.traverse((o) => {
                o.geometry?.dispose?.();
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach((m) => m?.dispose?.());
            });
        }
        this._ghost = null;
        this._fillMat = null;
        this._edgeMat = null;
        this._haloMat = null;
    }
}
