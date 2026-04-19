import * as THREE from 'three';

export class InteractionSystem {
    constructor(camera, interactables) {
        this.camera = camera;
        this.interactables = interactables;
        this.raycaster = new THREE.Raycaster();
        /** Reach from character/camera along view; slightly past station spacing. */
        this.raycaster.far = 9;
        this.currentTarget = null;
        this._ndc = new THREE.Vector2(0, 0);
        this._rayOrigin = new THREE.Vector3();
        this._rayDir = new THREE.Vector3();
        this._rayAcc = 0;

        /** Third person: max horizontal reach from torso to hitbox pivot (meters). */
        this.thirdPersonInteractRadius = 3.55;
        this._tpOrigin = new THREE.Vector3();
        this._tpObjPos = new THREE.Vector3();
        this._tpForward = new THREE.Vector3();
        /** Cached world positions: for static hitboxes, lifted once to skip matrix-walk. */
        this._tpPosCache = new WeakMap();

        this.crosshair = document.getElementById('crosshair');
    }

    /**
     * Interactable hitboxes never move after spawn, so cache their world position on first lookup.
     * Removed/replaced hitboxes drop out of `this.interactables` so the WeakMap self-cleans.
     */
    _getInteractableWorldPosXZ(obj, out) {
        const cached = this._tpPosCache.get(obj);
        if (cached) {
            out.copy(cached);
            return;
        }
        obj.getWorldPosition(out);
        this._tpPosCache.set(obj, out.clone());
    }

    /** Call if a hitbox has been moved in the world (rare — currently never). */
    invalidateInteractableCache() {
        this._tpPosCache = new WeakMap();
    }

    /**
     * Closest interactable near the avatar, biased to the character's facing (not camera center).
     */
    _pickThirdPersonInteractable(player) {
        const reach = this.thirdPersonInteractRadius;
        const reach2 = reach * reach;
        this._tpOrigin.set(player.avatarPos.x, player._lookHeight, player.avatarPos.z);
        const fy = player.patronRoot.rotation.y;
        const fwdX = Math.sin(fy);
        const fwdZ = Math.cos(fy);
        this._tpForward.set(fwdX, 0, fwdZ);

        let best = null;
        let bestHoriz2 = Infinity;
        const ox = this._tpOrigin.x;
        const oz = this._tpOrigin.z;
        for (let i = 0, n = this.interactables.length; i < n; i++) {
            const obj = this.interactables[i];
            this._getInteractableWorldPosXZ(obj, this._tpObjPos);
            const dx = this._tpObjPos.x - ox;
            const dz = this._tpObjPos.z - oz;
            const horiz2 = dx * dx + dz * dz;
            if (horiz2 > reach2) continue;
            if (horiz2 >= bestHoriz2) continue;
            // Facing cone — skip sqrt for the common early-out via sign of dot numerator:
            // dot = (dx*fwdX + dz*fwdZ) / sqrt(horiz2); reject when scaled dot < -0.38 * sqrt(horiz2).
            const dotN = dx * fwdX + dz * fwdZ;
            if (dotN < 0) {
                if (dotN * dotN > 0.1444 * horiz2) continue; // 0.38^2
            }
            bestHoriz2 = horiz2;
            best = obj;
        }

        this.currentTarget = best;
        if (this.crosshair) {
            if (best) this.crosshair.classList.add('active');
            else this.crosshair.classList.remove('active');
        }
    }

    update(player) {
        // Raycast every other frame — halves CPU work.
        this._rayAcc++;
        if ((this._rayAcc & 1) === 0) return;

        if (player?._thirdPerson && player.patronRoot) {
            this._pickThirdPersonInteractable(player);
            return;
        }

        if (player?.getInteractionRay) {
            player.getInteractionRay(this._rayOrigin, this._rayDir);
            this.raycaster.set(this._rayOrigin, this._rayDir);
        } else {
            this.raycaster.setFromCamera(this._ndc, this.camera);
        }
        const hits = this.raycaster.intersectObjects(this.interactables, false);

        if (hits.length > 0) {
            this.currentTarget = hits[0].object;
            if (this.crosshair) this.crosshair.classList.add('active');
        } else {
            this.currentTarget = null;
            if (this.crosshair) this.crosshair.classList.remove('active');
        }
    }
}
