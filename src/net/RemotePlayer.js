/**
 * RemotePlayer — visual stand-in for another connected player.
 *
 * Clones the same brewer/patron asset the local Player uses, tints it with the
 * owner's outfit color, and smoothly tracks incoming network state. Idle and
 * walk clips are cross-faded when the `walking` flag changes.
 *
 * This intentionally does NOT run physics, collision, or interactions — those
 * live on the owning tab. This class is a passive avatar so tabs can see each
 * other moving around.
 */

import * as THREE from 'three';
import { clone as cloneSkinnedHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import { PATRON_TINT_COLORS } from '../PatronColors.js';

const LERP_POS = 14;      // higher = snappier catch-up
const LERP_YAW = 12;
const WALK_FADE_SEC = 0.18;

/**
 * Clone and tint every material on a skinned hierarchy so multiple remote
 * brewers stay visually distinct without their diffuse texture washing out.
 * `tintStrength` is 0..1 — 0 leaves the texture alone (local look), 1 applies
 * the full PATRON_TINT_COLORS value (same mode patrons use).
 */
function tintMaterials(root, tint, tintStrength = 1) {
    const tintMul = tint && tintStrength > 0
        ? new THREE.Color().copy(tint).lerp(new THREE.Color(1, 1, 1), 1 - tintStrength)
        : null;
    root.traverse((ch) => {
        if (!ch.isMesh || !ch.material) return;
        ch.castShadow = false;
        ch.receiveShadow = false;
        const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
        const cloned = mats.map((m) => {
            const mat = m.clone();
            if (mat.map) mat.map = mat.map.clone();
            mat.envMapIntensity = (mat.envMapIntensity ?? 1) * 0.9;
            mat.depthWrite = true;
            mat.depthTest = true;
            mat.side = THREE.FrontSide;
            if (mat.transmission != null) mat.transmission = 0;
            if (mat.thickness != null) mat.thickness = 0;
            if (!mat.transparent || (mat.opacity ?? 1) >= 0.998) {
                mat.transparent = false;
                mat.opacity = 1;
            }
            if (tintMul && mat.color) mat.color.multiply(tintMul);
            mat.needsUpdate = true;
            return mat;
        });
        ch.material = cloned.length === 1 ? cloned[0] : cloned;
    });
}

export class RemotePlayer {
    /**
     * @param {THREE.Scene} scene
     * @param {object} assetBucket asset bucket (needs patronTemplate; brewer template not used so each
     *   remote avatar is visually distinct from the local brewer).
     * @param {{ name:string, colorIndex:number, x:number, z:number, yaw:number }} initial
     */
    constructor(scene, assetBucket, initial) {
        this.scene = scene;
        this.peerName = initial?.name || 'Brewer';
        this.colorIndex = initial?.colorIndex || 0;

        /** Visual position the avatar is interpolating toward from the network. */
        this.targetPos = new THREE.Vector3(initial?.x || 0, 0, initial?.z || 0);
        this.targetYaw = initial?.yaw || 0;
        this.walking = false;

        this._currentPos = this.targetPos.clone();
        this._currentYaw = this.targetYaw;

        this.root = null;
        this.mixer = null;
        this._clips = null;
        this._curAction = null;
        this._walkYawOffset = 0;
        this._nameSprite = null;

        // Use the brewer template so remote players look like brewers (not
        // patrons) — matches the local avatar and removes confusion with NPC
        // customers. We still tint each remote brewer by their outfit color
        // index so multiple players in the same room are distinguishable; the
        // tint is softened (0.55) because the brewer diffuse texture is
        // pre-coloured and a full-strength multiply looks muddy.
        const useBrewer = !!assetBucket?.brewerTemplate?.scene;
        const tpl = useBrewer ? assetBucket.brewerTemplate : assetBucket?.patronTemplate;
        if (!tpl?.scene) return;

        this._walkYawOffset = tpl.walkYawOffset ?? 0;
        const root = cloneSkinnedHierarchy(tpl.scene);
        const tint = new THREE.Color(
            PATRON_TINT_COLORS[this.colorIndex % PATRON_TINT_COLORS.length] || 0xffffff
        );
        tintMaterials(root, tint, useBrewer ? 0.55 : 1.0);
        // Brewer template sets a specific position.y so the mesh's feet sit at
        // y=0; preserve that or the avatar sinks into the floor.
        root.position.set(this.targetPos.x, root.position.y, this.targetPos.z);
        root.rotation.y = this.targetYaw + this._walkYawOffset;
        scene.add(root);
        this.root = root;

        this.mixer = new THREE.AnimationMixer(root);
        this._clips = {
            idle: tpl.clips?.idle || null,
            walk: tpl.clips?.walk || tpl.clips?.idle || null,
        };
        if (this._clips.idle) {
            const a = this.mixer.clipAction(this._clips.idle);
            a.loop = THREE.LoopRepeat;
            a.play();
            this._curAction = a;
        }

        // Name tag rides just above the head. bubbleY is authored per template
        // (feet→top + a small gap); fall back to a reasonable default if
        // missing so the sprite never clips into the model.
        this._nameTagY = typeof tpl.bubbleY === 'number' ? tpl.bubbleY : 2.05;
        this._nameSprite = this._buildNameSprite(this.peerName);
        if (this._nameSprite) scene.add(this._nameSprite);
    }

    applyState(state) {
        if (!state) return;
        if (typeof state.x === 'number') this.targetPos.x = state.x;
        if (typeof state.z === 'number') this.targetPos.z = state.z;
        if (typeof state.yaw === 'number') this.targetYaw = state.yaw;
        if (state.name && state.name !== this.peerName) {
            this.peerName = state.name;
            this._refreshNameSprite();
        }
        if (typeof state.colorIndex === 'number' && state.colorIndex !== this.colorIndex) {
            this.colorIndex = state.colorIndex;
            // Re-tinting a skinned mesh cheaply is messy; skip for now. Color stays
            // at the value present when the peer first joined.
        }
        const walking = !!state.walking;
        if (walking !== this.walking) {
            this.walking = walking;
            this._crossfadeTo(walking ? this._clips?.walk : this._clips?.idle);
        }
    }

    _crossfadeTo(clip) {
        if (!this.mixer || !clip) return;
        const next = this.mixer.clipAction(clip);
        if (next === this._curAction) return;
        next.reset();
        next.setLoop(THREE.LoopRepeat, Infinity);
        next.fadeIn(WALK_FADE_SEC).play();
        if (this._curAction && this._curAction !== next) {
            this._curAction.fadeOut(WALK_FADE_SEC);
        }
        this._curAction = next;
    }

    update(delta) {
        if (!this.root) return;
        const t = 1 - Math.exp(-LERP_POS * delta);
        this._currentPos.x += (this.targetPos.x - this._currentPos.x) * t;
        this._currentPos.z += (this.targetPos.z - this._currentPos.z) * t;

        let dy = this.targetYaw - this._currentYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        const ty = 1 - Math.exp(-LERP_YAW * delta);
        this._currentYaw += dy * ty;

        this.root.position.set(this._currentPos.x, this.root.position.y, this._currentPos.z);
        this.root.rotation.y = this._currentYaw + this._walkYawOffset;
        this.mixer?.update(delta);

        if (this._nameSprite) {
            this._nameSprite.position.set(
                this._currentPos.x,
                this._nameTagY,
                this._currentPos.z
            );
        }
    }

    dispose() {
        if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
        if (this.root) {
            this.scene.remove(this.root);
            this.root.traverse((ch) => {
                if (ch.geometry && !ch.geometry.userData?.shared) ch.geometry.dispose?.();
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                for (const m of mats) {
                    if (m?.map) m.map.dispose?.();
                    m?.dispose?.();
                }
            });
            this.root = null;
        }
        if (this._nameSprite) {
            this.scene.remove(this._nameSprite);
            this._nameSprite.material?.map?.dispose?.();
            this._nameSprite.material?.dispose?.();
            this._nameSprite = null;
        }
    }

    // -- name tag ---------------------------------------------------------

    _buildNameSprite(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        this._drawNameCanvas(canvas, text);
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 4;
        const mat = new THREE.SpriteMaterial({
            map: tex, depthTest: false, transparent: true,
        });
        const sp = new THREE.Sprite(mat);
        sp.scale.set(1.25, 0.3125, 1);
        sp.renderOrder = 9999;
        sp.userData._canvas = canvas;
        return sp;
    }

    _drawNameCanvas(canvas, text) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(10,20,36,0.76)';
        const x = 4, y = 10, w = canvas.width - 8, h = canvas.height - 20, r = 12;
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, r);
            ctx.fill();
        } else {
            ctx.fillRect(x, y, w, h);
        }
        ctx.fillStyle = '#cdecff';
        ctx.font = 'bold 30px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(text || 'Brewer').slice(0, 18), canvas.width / 2, canvas.height / 2);
    }

    _refreshNameSprite() {
        if (!this._nameSprite) return;
        const canvas = this._nameSprite.userData._canvas;
        if (!canvas) return;
        this._drawNameCanvas(canvas, this.peerName);
        this._nameSprite.material.map.needsUpdate = true;
    }
}
