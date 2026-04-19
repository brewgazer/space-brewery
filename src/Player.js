import * as THREE from 'three';
import { clone as cloneSkinnedHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import { PATRON_TINT_COLORS, BLUE_SUIT_COLOR_INDEX } from './PatronColors.js';

export class Player {
    constructor(camera, scene, colliders, lockTarget = document.body) {
        this.camera = camera;
        this.scene = scene;
        this.colliders = colliders;
        this._lockTarget = lockTarget;

        this.height = 1.6;
        this.radius = 0.35;
        this.speed = 5.0;
        this.stamina = 1;
        this.staminaMax = 1;
        this.sprintSpeedMultiplier = 1.62;
        this.sprintStaminaDrainPerSec = 0.48;
        this.staminaRegenPerSec = 0.2;
        this._sprintActive = false;
        this.sprintKey = false;

        /** Feet XZ; camera / avatar pivot for third-person. Spawns inside the brewery (north of the dividing wall). */
        this.avatarPos = new THREE.Vector3(0, 0, -6);
        this._thirdPerson = false;
        this.patronRoot = null;
        this.mixer = null;
        this._clips = null;
        this._curAnimAction = null;
        this._walkYawOffset = 0;

        this._camDistance = 3.8;
        /** GTA-style over-the-shoulder: positive = camera shifts right (character reads left-of-center). */
        this._shoulderOffset = 0.42;
        this._lookHeight = 1.75;
        /** Extra Y on the lens only (look-at stays at _lookHeight) so the view sits slightly higher. */
        this._thirdPersonCameraYLift = 0.25;
        /** Floor is y≈0; orbit pitch can push the lens under the plane without this clamp. */
        this._minThirdPersonCamY = 1.3;
        /** Orbit angles used for the camera rig (smoothed toward `euler` so look stays fluid). */
        this._camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
        /** While holding forward (W), yaw eases toward walk direction so the camera stays behind you. */
        this._forwardCamFollowSpeed = 2.15;

        this.camera.position.set(this.avatarPos.x, this.height, this.avatarPos.z);
        this.camera.rotation.order = 'YXZ';

        this.velocity = new THREE.Vector3();
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;

        this.isLocked = false;
        /**
         * Baseline mouse sensitivity (radians per device-pixel of movement).
         *
         * `sensitivityMultiplier` is the raw *slider position* (1…10), not a
         * direct multiplier. Runtime look-speed is
         * `sensitivity * 0.2 * sensitivityMultiplier`, which puts the
         * slider's midpoint (5) at the original feel (1.0×), lets players
         * slow the camera down to 0.2× at position 1, and speeds it up to
         * 2.0× at position 10. That asymmetry around the midpoint is
         * deliberate — people who want slower aim have a much wider range
         * to dial in than people who want faster aim, which matches the
         * request.
         */
        this.sensitivity = 0.002;
        this.sensitivityMultiplier = 5;
        try {
            const raw = localStorage.getItem('brewery_mouse_sensitivity');
            if (raw != null) {
                const v = parseFloat(raw);
                if (!Number.isNaN(v)) {
                    this.sensitivityMultiplier = Math.max(1, Math.min(10, v));
                }
            }
        } catch (_) { /* ignore */ }
        /**
         * Third-person vertical look: most orbit-cam games feel natural when moving the
         * mouse up tilts the camera down behind the player (revealing more of the sky).
         * Keep first-person on standard non-inverted so WASD-aim feels like every FPS.
         */
        this.invertThirdPersonPitch = true;

        this._direction = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._newPos = new THREE.Vector3();
        this._up = new THREE.Vector3(0, 1, 0);
        this._dragLookActive = false;
        this._colClosest = new THREE.Vector3();
        this._tmpV = new THREE.Vector3();
        /** Third-person: ray from chest → ideal lens; clip to wall colliders so the lens stays inside. */
        this._camRay = new THREE.Ray();
        this._camRayDir = new THREE.Vector3();
        this._camRayHit = new THREE.Vector3();
        this._camRayOrigin = new THREE.Vector3();
        this._camIdealPos = new THREE.Vector3();
        this._camClippedPos = new THREE.Vector3();
        this._suppressLocoAnim = false;
        this._lastYellTime = -1e9;

        /**
         * Vertical hop (space bar). `_jumpY` is additive height above the ground,
         * applied to the avatar root each frame. `_basePatronY` captures the
         * brewer template's foot-aligned Y offset so we can return to it after
         * landing without drifting.
         */
        this._jumpY = 0;
        this._jumpVel = 0;
        this._isJumping = false;
        this._basePatronY = 0;
        this._jumpSpeed = 5.2;
        this._jumpGravity = 14.0;

        /**
         * Punch combo state. LMB plays `punch1` to completion; a second LMB
         * during that window *queues* `punch2`, which then plays back-to-back
         * once the first swing finishes (no interruption → no choppiness).
         * Only the finisher (`punch2`) invokes `onPunchLanded`, which flings
         * the victim backward if the hit connects.
         *
         *   0 = idle, not swinging
         *   1 = punch1 currently playing
         *   2 = punch2 currently playing
         */
        this._punchStage = 0;
        this._punchQueued = false;       // true if LMB pressed during punch1
        this._punchLockUntil = 0;        // while <= now, movement anims suppressed
        this.onPunchLanded = null;       // main.js installs hit-detection callback

        this._setupPointerLock();
        this._setupKeyboard();
    }

    _removePatron() {
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }
        if (this.patronRoot) {
            this.scene.remove(this.patronRoot);
            this.patronRoot.traverse((ch) => {
                if (ch.geometry && !ch.geometry.userData?.shared) ch.geometry.dispose?.();
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                for (const m of mats) {
                    // Textures flagged `shared` are owned by the asset
                    // template (e.g. the blue-suit atlas) and re-used by
                    // every subsequent spawn. Disposing them here would
                    // invalidate the template for future color picks.
                    if (m?.map && !m.map.userData?.shared) m.map.dispose?.();
                    m?.dispose?.();
                }
            });
            this.patronRoot = null;
        }
        this._clips = null;
        this._curAnimAction = null;
        this._camDistance = 3.8;
        this._shoulderOffset = 0.42;
        this._minThirdPersonCamY = 1.3;
        this._lookHeight = 1.75;
        this._thirdPersonCameraYLift = 0.25;
    }

    /**
     * Third-person avatar: prefers brewer FBX, else patron GLB. Falls back to first-person if neither.
     */
    setPatronAvatar(assetBucket, colorIndex = 0) {
        this._removePatron();
        const brew = assetBucket?.brewerTemplate;
        const patron = assetBucket?.patronTemplate;
        const tpl = brew?.scene ? brew : patron;
        if (!tpl?.scene) {
            this._thirdPerson = false;
            this.avatarPos.set(this.camera.position.x, 0, this.camera.position.z);
            return;
        }

        this._thirdPerson = true;
        this._walkYawOffset = tpl.walkYawOffset ?? 0;
        if (tpl.viewChestY != null) {
            this._lookHeight = tpl.viewChestY;
        } else {
            this._lookHeight = 1.75;
        }
        if (tpl.thirdPersonCamDistance != null) {
            this._camDistance = tpl.thirdPersonCamDistance;
            this._shoulderOffset = tpl.thirdPersonShoulderOffset ?? 0.42;
            this._minThirdPersonCamY = tpl.thirdPersonMinCamY ?? 1.3;
        } else {
            this._camDistance = 3.8;
            this._shoulderOffset = 0.42;
            this._minThirdPersonCamY = 1.3;
        }
        this.avatarPos.set(this.camera.position.x, 0, this.camera.position.z);

        const root = cloneSkinnedHierarchy(tpl.scene);
        const useBrewer = !!brew?.scene;

        const fixAvatarMaterial = (mat, envMul) => {
            if (!mat) return mat;
            const m = mat.clone();
            if (m.map) m.map = m.map.clone();
            m.envMapIntensity = (m.envMapIntensity ?? 1) * envMul;
            // GLTF often uses DoubleSide / transmission / odd transparency — causes self
            // overlap sorting (arms “through” torso) on skinned meshes.
            m.depthWrite = true;
            m.depthTest = true;
            m.side = THREE.FrontSide;
            if (m.transmission != null) m.transmission = 0;
            if (m.thickness != null) m.thickness = 0;
            if (!m.transparent || (m.opacity ?? 1) >= 0.998) {
                m.transparent = false;
                m.opacity = 1;
            }
            m.needsUpdate = true;
            return m;
        };

        if (useBrewer) {
            // The blue colour slot has a bespoke diffuse atlas; swap the map
            // per-material rather than multiplying the default diffuse by a
            // blue tint (which doubled up the blue and read muddy). Every
            // other slot keeps the default texture untinted — we don't have
            // atlases for those yet.
            const blueSuitTex =
                colorIndex === BLUE_SUIT_COLOR_INDEX
                    ? brew?.diffuseVariants?.blueSuit || null
                    : null;
            if (colorIndex === BLUE_SUIT_COLOR_INDEX) {
                console.info('[Player] blue outfit picked — blueSuitTex?', !!blueSuitTex,
                    'variants:', brew?.diffuseVariants ? Object.keys(brew.diffuseVariants) : 'none');
            }
            let bluesuitAppliedCount = 0;
            root.traverse((ch) => {
                if (ch.isMesh && ch.material) {
                    ch.castShadow = false;
                    ch.receiveShadow = false;
                    const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                    ch.material = mats.map((m) => {
                        const mat = fixAvatarMaterial(m, 0.9);
                        if (blueSuitTex) {
                            // Apply regardless of whether the cloned material
                            // already had a `.map` — some brewer sub-meshes
                            // ship with only a colour (no texture) and should
                            // still adopt the blue atlas so they read as part
                            // of the same outfit. Dispose the cloned default
                            // map if present so we don't leak GPU memory.
                            if (mat.map && mat.map !== blueSuitTex) {
                                mat.map.dispose?.();
                            }
                            mat.map = blueSuitTex;
                            mat.color?.setHex?.(0xffffff);
                            mat.needsUpdate = true;
                            bluesuitAppliedCount++;
                        }
                        return mat;
                    });
                    ch.material = ch.material.length === 1 ? ch.material[0] : ch.material;
                }
            });
            if (blueSuitTex) {
                console.info(`[Player] blue suit applied to ${bluesuitAppliedCount} material(s)`);
            }
        } else {
            const tint = new THREE.Color(
                PATRON_TINT_COLORS[colorIndex % PATRON_TINT_COLORS.length]
            );
            root.traverse((ch) => {
                if (ch.isMesh && ch.material) {
                    ch.castShadow = false;
                    ch.receiveShadow = false;
                    const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                    ch.material = mats.map((m) => {
                        const mat = fixAvatarMaterial(m, 0.85);
                        if (mat.color) mat.color.multiply(tint);
                        return mat;
                    });
                    ch.material = ch.material.length === 1 ? ch.material[0] : ch.material;
                }
            });
        }

        // Brewer template sets position.y so mesh feet sit on y=0; never overwrite with 0 (was sinking the model).
        root.position.set(this.avatarPos.x, root.position.y, this.avatarPos.z);
        this.scene.add(root);
        this.patronRoot = root;

        this.euler.setFromQuaternion(this.camera.quaternion);
        this._camEuler.copy(this.euler);
        this._updateThirdPersonCamera();

        this.mixer = new THREE.AnimationMixer(root);
        this._clips = {
            idle: tpl.clips?.idle || null,
            walk: tpl.clips?.walk || tpl.clips?.idle || null,
            yell: useBrewer ? brew.clips?.yell || null : null,
            point: useBrewer ? brew.clips?.point || null : null,
            pour: useBrewer ? brew.clips?.pour || null : null,
            grabMix: useBrewer ? brew.clips?.grabMix || null : null,
            grabWort: useBrewer ? brew.clips?.grabWort || null : null,
            jump: useBrewer ? brew.clips?.jump || null : null,
            punch1: useBrewer ? brew.clips?.punch1 || null : null,
            punch2: useBrewer ? brew.clips?.punch2 || null : null,
        };
        this._basePatronY = root.position.y;
        this._jumpY = 0;
        this._jumpVel = 0;
        this._isJumping = false;
        this._suppressLocoAnim = false;

        if (this._clips.idle) {
            const a = this.mixer.clipAction(this._clips.idle);
            a.loop = THREE.LoopRepeat;
            a.play();
            this._curAnimAction = a;
        }
    }

    /**
     * One-shot brewer clip (pour, grabs, taunts). Returns false if missing or not third-person.
     * @param {'pour'|'grabMix'|'grabWort'|'point'|'yell'} kind
     */
    playBrewerGesture(kind) {
        const clip = this._clips?.[kind];
        return this._playBrewerOneShotClip(clip);
    }

    /** @param {THREE.AnimationClip|null|undefined} clip */
    _playBrewerOneShotClip(clip) {
        if (!this._thirdPerson || !this.mixer || !clip) return false;
        // If a punch combo was running when an unrelated gesture kicks in
        // (pour, grab, taunt, etc.), let the punch state machine quietly
        // bail so the next click starts a fresh combo rather than queueing
        // a ghost finisher.
        this._punchStage = 0;
        this._punchQueued = false;
        this._suppressLocoAnim = true;
        const next = this.mixer.clipAction(clip);
        next.reset();
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
        const grabMix = clip.name === 'grabMix';
        if (grabMix) next.timeScale = 1.12;
        next.fadeIn(grabMix ? 0.09 : 0.14).play();
        if (this._curAnimAction && this._curAnimAction !== next) {
            this._curAnimAction.fadeOut(grabMix ? 0.07 : 0.12);
        }
        this._curAnimAction = next;
        const onFinished = (e) => {
            if (e.action !== next) return;
            this.mixer.removeEventListener('finished', onFinished);
            this._suppressLocoAnim = false;
            if (this._clips?.idle) {
                const idle = this.mixer.clipAction(this._clips.idle);
                idle.reset();
                idle.setLoop(THREE.LoopRepeat, Infinity);
                idle.fadeIn(grabMix ? 0.12 : 0.18).play();
                this._curAnimAction = idle;
            }
        };
        this.mixer.addEventListener('finished', onFinished);
        return true;
    }

    /** Taunt clips from brewer (keys 1 & 2). Returns true if played. */
    playBrewerTaunt(kind) {
        const clip = kind === 'point' ? this._clips?.point : this._clips?.yell;
        const ok = this._playBrewerOneShotClip(clip);
        if (ok && kind === 'yell') {
            this._lastYellTime = performance.now() * 0.001;
        }
        return ok;
    }

    getLastYellTime() {
        return this._lastYellTime;
    }

    /**
     * Begin a vertical hop. Ignored if already airborne or if the patron hasn't
     * been spawned yet (menus / first-person selection). Plays the `jump` clip
     * as a one-shot while the physics runs in `update()`.
     */
    jump() {
        if (!this._thirdPerson || !this.patronRoot) return false;
        if (this._isJumping) return false;
        this._isJumping = true;
        this._jumpVel = this._jumpSpeed;
        // Play the jump clip as a transient overlay; crucially we do NOT set
        // `_suppressLocoAnim` here, because the player should still be able to
        // run-jump. The update loop will naturally flip back to walk/idle
        // when the clip ends (crossfades handle blending).
        const clip = this._clips?.jump;
        if (clip && this.mixer) {
            const next = this.mixer.clipAction(clip);
            next.reset();
            next.setLoop(THREE.LoopOnce, 1);
            next.clampWhenFinished = false;
            next.fadeIn(0.08).play();
            if (this._curAnimAction && this._curAnimAction !== next) {
                this._curAnimAction.fadeOut(0.08);
            }
            this._curAnimAction = next;
        }
        return true;
    }

    /**
     * Trigger a punch. A single LMB plays `punch1` to completion. If the
     * player LMBs again while `punch1` is still swinging, `punch2` is queued
     * and starts the moment `punch1` finishes — the two clips run
     * back-to-back with no interrupt cut. `onPunchLanded` fires during
     * `punch2` so the finisher can send the victim flying.
     */
    punch() {
        if (!this._thirdPerson || !this.patronRoot || !this.mixer) return false;

        if (this._punchStage === 0) {
            const clip = this._clips?.punch1;
            if (!clip) return false;
            this._punchQueued = false;
            this._startPunchClip('punch1', clip);
            return true;
        }
        if (this._punchStage === 1) {
            // Second click during the first swing → queue the finisher.
            if (this._clips?.punch2) this._punchQueued = true;
            return true;
        }
        // Already mid-finisher; extra clicks do nothing.
        return false;
    }

    /**
     * Play one of the two punch clips as a one-shot. On finish, either chain
     * into the queued `punch2` or fall back to idle / walk. Keeps
     * `_suppressLocoAnim` on for the whole combo so the walk clip doesn't
     * bleed through between swings.
     */
    _startPunchClip(kind, clip) {
        const mixer = this.mixer;
        if (!mixer || !clip) return;

        this._punchStage = kind === 'punch1' ? 1 : 2;
        this._suppressLocoAnim = true;
        this._punchLockUntil = performance.now() * 0.001 + Math.max(0.22, clip.duration);

        const next = mixer.clipAction(clip);
        next.reset();
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
        // Slightly snappier crossfade for the first swing; punch2 comes in
        // tighter so the two reads as a single combo.
        const fade = kind === 'punch2' ? 0.05 : 0.1;
        next.fadeIn(fade).play();
        if (this._curAnimAction && this._curAnimAction !== next) {
            this._curAnimAction.fadeOut(fade);
        }
        this._curAnimAction = next;

        // Finisher: fire the scene callback ~40% through the swing, so the
        // animation reads as impacting before the victim flies.
        if (kind === 'punch2' && typeof this.onPunchLanded === 'function') {
            const delayMs = Math.max(60, clip.duration * 400);
            const cb = this.onPunchLanded;
            setTimeout(() => {
                try { cb(this); } catch (err) { console.warn('punch-landed cb', err); }
            }, delayMs);
        }

        const onFinished = (e) => {
            if (e.action !== next) return;
            mixer.removeEventListener('finished', onFinished);

            if (kind === 'punch1' && this._punchQueued && this._clips?.punch2) {
                this._punchQueued = false;
                this._startPunchClip('punch2', this._clips.punch2);
                return;
            }

            this._punchStage = 0;
            this._punchQueued = false;
            this._suppressLocoAnim = false;
            if (this._clips?.idle) {
                const idle = mixer.clipAction(this._clips.idle);
                idle.reset();
                idle.setLoop(THREE.LoopRepeat, Infinity);
                idle.fadeIn(0.14).play();
                this._curAnimAction = idle;
            }
        };
        mixer.addEventListener('finished', onFinished);
    }

    isPunching() {
        return performance.now() * 0.001 < this._punchLockUntil;
    }

    /**
     * Settings slider writes here (1 … 10, default 5 = baseline feel).
     * The effective look multiplier is `0.2 * value`, so the slider spans
     * 0.2× (barely moving) through 1.0× (original feel, at 5) up to 2.0×
     * (snappy). Persisted to localStorage.
     */
    setSensitivityMultiplier(v) {
        const clamped = Math.max(1, Math.min(10, Number(v) || 5));
        this.sensitivityMultiplier = clamped;
        try {
            localStorage.setItem('brewery_mouse_sensitivity', String(clamped));
        } catch (_) { /* ignore */ }
    }

    clearAvatarForMenu() {
        const x = this.avatarPos.x;
        const z = this.avatarPos.z;
        this._removePatron();
        this._thirdPerson = false;
        this.camera.position.set(x, this.height, z);
    }

    resetWorldPosition(x, z) {
        this.avatarPos.set(x, 0, z);
        if (!this._thirdPerson) {
            this.camera.position.set(x, this.height, z);
        } else {
            this._camEuler.copy(this.euler);
            this._updateThirdPersonCamera();
        }
        if (this.patronRoot) {
            this.patronRoot.position.set(x, this.patronRoot.position.y, z);
        }
    }

    _crossfadeTo(clip, fade = 0.12) {
        if (!this.mixer || !clip) return;
        const next = this.mixer.clipAction(clip);
        next.reset();
        next.setLoop(THREE.LoopRepeat, Infinity);
        next.fadeIn(fade).play();
        if (this._curAnimAction && this._curAnimAction !== next) {
            this._curAnimAction.fadeOut(fade);
        }
        this._curAnimAction = next;
    }

    /** Shortest delta for lerping yaw toward target (radians). */
    _yawDelta(from, to) {
        let d = to - from;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
    }

    /** Third-person only: keep camera orbit locked to mouse aim (no eased lag). */
    _smoothCamOrbit() {
        this._camEuler.copy(this.euler);
    }

    /**
     * Pull the lens toward the avatar if the segment to the ideal position hits level geometry
     * (same Box3 colliders as movement). Prevents the camera from poking through walls.
     *
     * Broadphase: we reject colliders whose AABB doesn't overlap the segment's AABB before
     * running the ray test. With ~60 scene colliders + kegs, this skips most per frame.
     */
    _clipThirdPersonCamera(origin, idealCam, out) {
        const dir = this._camRayDir.subVectors(idealCam, origin);
        const fullLen = dir.length();
        if (fullLen < 1e-5) {
            return out.copy(idealCam);
        }
        dir.multiplyScalar(1 / fullLen);
        this._camRay.set(origin, dir);

        // Segment AABB in world space (inclusive of both endpoints plus a small bloat).
        const PAD = 0.05;
        const segMinX = Math.min(origin.x, idealCam.x) - PAD;
        const segMaxX = Math.max(origin.x, idealCam.x) + PAD;
        const segMinY = Math.min(origin.y, idealCam.y) - PAD;
        const segMaxY = Math.max(origin.y, idealCam.y) + PAD;
        const segMinZ = Math.min(origin.z, idealCam.z) - PAD;
        const segMaxZ = Math.max(origin.z, idealCam.z) + PAD;

        let minDist = fullLen;
        const cols = this.colliders;
        for (let i = 0, n = cols.length; i < n; i++) {
            const box = cols[i].box;
            // Broadphase — AABB overlap check before the (costlier) ray vs box test.
            if (
                box.max.x < segMinX || box.min.x > segMaxX ||
                box.max.y < segMinY || box.min.y > segMaxY ||
                box.max.z < segMinZ || box.min.z > segMaxZ
            ) {
                continue;
            }
            const hit = this._camRay.intersectBox(box, this._camRayHit);
            if (hit) {
                const dx = this._camRayHit.x - origin.x;
                const dy = this._camRayHit.y - origin.y;
                const dz = this._camRayHit.z - origin.z;
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d > 0.02 && d < minDist) {
                    minDist = d;
                }
            }
        }

        const margin = 0.16;
        const minCamDist = 0.38;
        const finalDist = Math.min(fullLen, Math.max(minCamDist, minDist - margin));
        return out.copy(origin).addScaledVector(dir, finalDist);
    }

    _updateThirdPersonCamera() {
        const yaw = this._camEuler.y;
        const pitch = this._camEuler.x;
        const flat = this._camDistance * Math.cos(pitch);
        const yLift = this._camDistance * Math.sin(pitch);
        let cx = this.avatarPos.x - Math.sin(yaw) * flat;
        let cz = this.avatarPos.z - Math.cos(yaw) * flat;
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        cx += rx * this._shoulderOffset;
        cz += rz * this._shoulderOffset;
        let cy = this._lookHeight + yLift + this._thirdPersonCameraYLift;
        if (cy < this._minThirdPersonCamY + this._thirdPersonCameraYLift * 0.35) {
            cy = this._minThirdPersonCamY + this._thirdPersonCameraYLift * 0.35;
        }
        this._camIdealPos.set(cx, cy, cz);
        this._camRayOrigin.set(this.avatarPos.x, this._lookHeight, this.avatarPos.z);
        this._clipThirdPersonCamera(this._camRayOrigin, this._camIdealPos, this._camClippedPos);
        this.camera.position.copy(this._camClippedPos);
        this._tmpV.set(this.avatarPos.x, this._lookHeight, this.avatarPos.z);
        this.camera.lookAt(this._tmpV);
    }

    /**
     * First-person only: ray from lens along view. Third-person targeting uses proximity in
     * `InteractionSystem` instead of this ray.
     */
    getInteractionRay(origin, direction) {
        this.camera.getWorldDirection(direction);
        direction.normalize();
        origin.copy(this.camera.position);
    }

    /** Horizontal forward for dropping items (camera view in FP, aim yaw in TP). */
    getFacingXZ(out) {
        if (this._thirdPerson) {
            out.set(Math.sin(this.euler.y), 0, Math.cos(this.euler.y));
        } else {
            this.camera.getWorldDirection(out);
            out.y = 0;
            if (out.lengthSq() < 1e-6) {
                out.set(-Math.sin(this.euler.y), 0, -Math.cos(this.euler.y));
            } else {
                out.normalize();
            }
        }
    }

    _setupPointerLock() {
        document.addEventListener('pointerlockchange', () => {
            this.isLocked = !!document.pointerLockElement;
            const gs = window.gameState;
            if (!gs) return;
            if (this.isLocked) {
                gs._pointerLockFailed = false;
            }
            if (gs._pointerLockFailed) {
                gs.paused = false;
                return;
            }
            if (gs.recipeShopOpen) {
                gs.paused = false;
                if (this.isLocked) {
                    gs.recipeShopOpen = false;
                }
                return;
            }
            gs.paused = !this.isLocked && gs.started;
        });

        document.addEventListener('pointerlockerror', () => {
            const gs = window.gameState;
            if (!gs?.started) return;
            gs._pointerLockFailed = true;
            gs.paused = false;
        });

        document.addEventListener('mousemove', (e) => {
            const gs = window.gameState;
            const canLook =
                this.isLocked || (this._dragLookActive && gs?._pointerLockFailed && gs?.started);
            if (!canLook) return;

            const look = this.sensitivity * 0.2 * this.sensitivityMultiplier;
            if (this._thirdPerson) {
                this.euler.y -= e.movementX * look;
                const pitchSign = this.invertThirdPersonPitch ? 1 : -1;
                this.euler.x += pitchSign * e.movementY * look;
                this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
                return;
            }

            this.euler.setFromQuaternion(this.camera.quaternion);
            this.euler.y -= e.movementX * look;
            this.euler.x -= e.movementY * look;
            this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
            this.camera.quaternion.setFromEuler(this.euler);
        });

        const lt = this._lockTarget;
        if (lt?.addEventListener) {
            lt.addEventListener('mousedown', () => {
                const gs = window.gameState;
                if (gs?._pointerLockFailed && gs?.started) {
                    this._dragLookActive = true;
                }
            });
        }
        document.addEventListener('mouseup', () => {
            this._dragLookActive = false;
        });

        // Left-click = punch. Only while pointer is locked (actively playing),
        // so clicking menu buttons or the canvas to re-acquire lock doesn't
        // fire a phantom swing.
        document.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (!this.isLocked) return;
            const gs = window.gameState;
            if (!gs?.started || gs.paused) return;
            if (gs.recipeShopOpen) return;
            // Don't swing while mid-gesture (pour, grab, taunt, etc.) —
            // those one-shots also set `_suppressLocoAnim`. During an active
            // punch combo we *do* want clicks to pass through so the second
            // swing can queue, which is what `_punchStage > 0` covers.
            if (this._suppressLocoAnim && this._punchStage === 0) return;
            this.punch();
        });
    }

    _setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            switch (e.code) {
                case 'KeyW': this.moveForward = true; break;
                case 'KeyS': this.moveBackward = true; break;
                case 'KeyA': this.moveLeft = true; break;
                case 'KeyD': this.moveRight = true; break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.sprintKey = true;
                    break;
                case 'Space': {
                    if (e.repeat) break;
                    const gs = window.gameState;
                    // Don't hijack space while a modal UI is open (recipe / keg
                    // pickers use it occasionally in some browsers) — the
                    // moveForward etc. guards already block movement when
                    // pointer isn't locked, so check for gameplay focus here.
                    if (!gs?.started) break;
                    if (gs.recipeShopOpen) break;
                    if (this.jump()) e.preventDefault();
                    break;
                }
            }
        });
        document.addEventListener('keyup', (e) => {
            switch (e.code) {
                case 'KeyW': this.moveForward = false; break;
                case 'KeyS': this.moveBackward = false; break;
                case 'KeyA': this.moveLeft = false; break;
                case 'KeyD': this.moveRight = false; break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.sprintKey = false;
                    break;
            }
        });
    }

    lock() {
        const el = this._lockTarget || document.body;
        const gs = window.gameState;
        if (!el.requestPointerLock) {
            if (gs) {
                gs._pointerLockFailed = true;
                gs.paused = false;
            }
            return;
        }
        el.requestPointerLock();
    }

    update(delta) {
        const gs = window.gameState;
        const canMove = this.isLocked || gs?._pointerLockFailed;
        if (!canMove) return;

        const direction = this._direction;
        const forward = this._forward;
        const right = this._right;

        if (this._thirdPerson) {
            // Must match _updateThirdPersonCamera orbit: camera sits at avatar - (sin, cos)*dist,
            // so walk "into" the view uses +(sin, cos), not the opposite (which walks toward the lens).
            forward.set(Math.sin(this.euler.y), 0, Math.cos(this.euler.y));
        } else {
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            if (forward.lengthSq() < 1e-6) {
                forward.set(-Math.sin(this.euler.y), 0, -Math.cos(this.euler.y));
            } else {
                forward.normalize();
            }
        }
        right.crossVectors(forward, this._up).normalize();

        direction.set(0, 0, 0);
        if (this.moveForward) direction.add(forward);
        if (this.moveBackward) direction.sub(forward);
        if (this.moveLeft) direction.sub(right);
        if (this.moveRight) direction.add(right);

        if (direction.lengthSq() > 0) direction.normalize();

        // Brewer pour / grab / taunt clips — no translation until the gesture finishes.
        if (this._suppressLocoAnim) direction.set(0, 0, 0);

        const wantsSprint = this.sprintKey && direction.lengthSq() > 0;
        const fullEnough = this.stamina >= 0.995;

        if (this._sprintActive) {
            if (!wantsSprint || this.stamina <= 0) this._sprintActive = false;
        } else if (wantsSprint && fullEnough) {
            this._sprintActive = true;
        }

        let moveSpeed = this.speed;
        if (this._sprintActive) {
            moveSpeed *= this.sprintSpeedMultiplier;
            this.stamina = Math.max(0, this.stamina - this.sprintStaminaDrainPerSec * delta);
        } else {
            this.stamina = Math.min(
                this.staminaMax,
                this.stamina + this.staminaRegenPerSec * delta
            );
        }

        const moveX = direction.x * moveSpeed * delta;
        const moveZ = direction.z * moveSpeed * delta;

        const newPos = this._newPos;
        newPos.copy(this.avatarPos);
        newPos.y = this.height;
        newPos.x += moveX;
        newPos.z += moveZ;

        if (!this._checkCollision(newPos)) {
            this.avatarPos.x = newPos.x;
            this.avatarPos.z = newPos.z;
        } else {
            newPos.copy(this.avatarPos);
            newPos.y = this.height;
            newPos.x += moveX;
            if (!this._checkCollision(newPos)) {
                this.avatarPos.x = newPos.x;
            }
            newPos.copy(this.avatarPos);
            newPos.y = this.height;
            newPos.z += moveZ;
            if (!this._checkCollision(newPos)) {
                this.avatarPos.z = newPos.z;
            }
        }

        if (this._isJumping) {
            this._jumpVel -= this._jumpGravity * delta;
            this._jumpY += this._jumpVel * delta;
            if (this._jumpY <= 0) {
                this._jumpY = 0;
                this._jumpVel = 0;
                this._isJumping = false;
            }
        }

        if (this._thirdPerson && this.patronRoot) {
            this.patronRoot.position.set(
                this.avatarPos.x,
                this._basePatronY + this._jumpY,
                this.avatarPos.z
            );
            const moving = direction.lengthSq() > 0.001;
            if (moving) {
                // Same convention as CustomerSystem._walkYawForPatron (Robot: atan2 only; Soldier: +π via template).
                const yaw = Math.atan2(direction.x, direction.z) + this._walkYawOffset;
                this.patronRoot.rotation.y = yaw;
            } else {
                this.patronRoot.rotation.y = this.euler.y + this._walkYawOffset;
            }

            if (this.mixer) {
                this.mixer.update(delta);
                if (!this._suppressLocoAnim) {
                    if (
                        moving &&
                        this._clips?.walk &&
                        this._clips.walk !== this._clips.idle
                    ) {
                        const cur = this._curAnimAction?.getClip?.();
                        if (cur !== this._clips.walk) {
                            this._crossfadeTo(this._clips.walk, 0.1);
                        }
                    } else if (!moving && this._clips?.idle) {
                        const cur = this._curAnimAction?.getClip?.();
                        if (cur !== this._clips.idle) {
                            this._crossfadeTo(this._clips.idle, 0.12);
                        }
                    }
                }
            }

            if (this.moveForward && !this.moveBackward && direction.lengthSq() > 0.01) {
                const moveYaw = Math.atan2(direction.x, direction.z);
                const pull = this._forwardCamFollowSpeed * delta;
                const dy = this._yawDelta(this.euler.y, moveYaw);
                if (Math.abs(dy) <= pull) {
                    this.euler.y = moveYaw;
                } else {
                    this.euler.y += Math.sign(dy) * pull;
                }
            }

            this._smoothCamOrbit();
            this._updateThirdPersonCamera();
        } else {
            this.camera.position.set(this.avatarPos.x, this.height, this.avatarPos.z);
        }
    }

    _checkCollision(pos) {
        const r2 = this.radius * this.radius;
        const c = this._colClosest;
        for (const col of this.colliders) {
            const box = col.box;
            c.set(
                Math.max(box.min.x, Math.min(pos.x, box.max.x)),
                pos.y,
                Math.max(box.min.z, Math.min(pos.z, box.max.z))
            );
            const dx = pos.x - c.x;
            const dz = pos.z - c.z;
            if (dx * dx + dz * dz < r2) return true;
        }
        return false;
    }
}
