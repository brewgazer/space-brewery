import * as THREE from 'three';
import { clone as cloneSkinnedHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import { PATRON_TINT_COLORS } from './PatronColors.js';

/** Max drinks one patron may order in a single visit (first + reorders). */
const MAX_ORDERS_PER_VISIT = 3;
/** After each successful serve, chance they stay for another round (if under cap). */
const REORDER_AFTER_SERVE_CHANCE = 0.42;
/** At table: seconds before they may head back to the bar or leave. */
const SEATED_MIN = 5;
const SEATED_EXTRA = 10;
/** Patience ratio below this while waiting at bar → rowdy “!!!” bubble. */
const ROWDY_PATIENCE_RATIO = 0.42;
/** Max horizontal distance (m) — must span bar depth + tap ↔ patron X offset. */
const CONVINCE_RADIUS_M = 9.5;
/**
 * When not in “bar service” mode, patron must be in view cone: dot(forward, toPatron) ≥ this.
 */
const CONVINCE_MIN_FACING_DOT = 0.32;
/** Brewer side of bar (tap rail); patrons wait at higher Z — no strict facing needed here. */
const CONVINCE_BAR_PLAYER_MAX_Z = 2.95;
/** Patron must be on customer side / past the rail toward the room. */
const CONVINCE_BAR_PATRON_MIN_Z = 1.55;
/** Max |Δx| between brewer and patron while pitching across the bar (tap lanes). */
const CONVINCE_BAR_MAX_LANE_X = 12;

export class CustomerSystem {
    /**
     * @param {object|null} assetBucket — mutable { patronTemplate } filled when GLB loads
     * @param {Array<{position:THREE.Vector3, rotationY:number, occupied:boolean}>|null} tableSeats
     */
    constructor(scene, customerSpots, gameState, audioSystem, assetBucket = null, tableSeats = null) {
        this.scene = scene;
        this.spots = customerSpots;
        this.gameState = gameState;
        this.audio = audioSystem;
        this.assetBucket = assetBucket;
        this.tableSeats = tableSeats;
        this.customers = [];
        this.time = 0;
        this._vDir = new THREE.Vector3();
        this._vExit = new THREE.Vector3();
        this._convForward = new THREE.Vector3();
        this._convToPatron = new THREE.Vector3();
    }

    _takeFreeTableSeat() {
        if (!this.tableSeats?.length) return null;
        const s = this.tableSeats.find((x) => !x.occupied);
        if (!s) return null;
        s.occupied = true;
        return s;
    }

    _releaseTableSeat(seat) {
        if (seat) seat.occupied = false;
    }

    /** Y rotation so skinned patrons face their travel direction (Robot: atan2 only; Soldier: +π). */
    _walkYawForPatron(dirX, dirZ, customer) {
        const base = Math.atan2(dirX, dirZ);
        if (!customer._useSkinned) return base + Math.PI;
        const off = this.assetBucket?.patronTemplate?.walkYawOffset ?? 0;
        return base + off;
    }

    spawnCustomer(recipe, patience) {
        const freeSpot = this.spots.find(s => !s.occupied);
        if (!freeSpot) return false;

        freeSpot.occupied = true;
        const homeSeat = this._takeFreeTableSeat();

        const group = new THREE.Group();
        const entrance = new THREE.Vector3(0, 0, 22);
        group.position.copy(entrance);

        let body = null;
        let skinnedMaterials = [];
        let mixer = null;
        let clips = {};
        let modelRoot = null;

        const patronTemplate = this.assetBucket?.patronTemplate;
        const bubbleBaseY = patronTemplate?.bubbleY ?? 2.05;
        if (patronTemplate?.scene) {
            modelRoot = cloneSkinnedHierarchy(patronTemplate.scene);
            const tint = new THREE.Color(
                PATRON_TINT_COLORS[Math.floor(Math.random() * PATRON_TINT_COLORS.length)]
            );

            modelRoot.traverse((ch) => {
                if (ch.isMesh && ch.material) {
                    ch.castShadow = false;
                    ch.receiveShadow = false;
                    const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                    const cloned = mats.map((m) => {
                        const mat = m.clone();
                        if (mat.map) mat.map = mat.map.clone();
                        if (mat.color) mat.color.multiply(tint);
                        mat.envMapIntensity = (mat.envMapIntensity ?? 1) * 0.85;
                        skinnedMaterials.push(mat);
                        return mat;
                    });
                    ch.material = cloned.length === 1 ? cloned[0] : cloned;
                }
            });

            mixer = new THREE.AnimationMixer(modelRoot);
            const src = patronTemplate.clips || {};
            clips = {
                idle: src.idle || null,
                walk: src.walk || src.run || src.idle || null,
                drink: src.drink || null,
                happy: src.happy || src.idle || null,
                angry: src.angry || src.idle || null,
            };

            group.add(modelRoot);
            body = modelRoot;
        } else {
            const bodyColor =
                PATRON_TINT_COLORS[Math.floor(Math.random() * PATRON_TINT_COLORS.length)];
            body = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.9, 0.35),
                new THREE.MeshStandardMaterial({ color: bodyColor })
            );
            body.position.y = 0.85;
            group.add(body);

            const head = new THREE.Mesh(
                new THREE.SphereGeometry(0.2, 6, 6),
                new THREE.MeshStandardMaterial({ color: 0xffccaa })
            );
            head.position.y = 1.5;
            group.add(head);

            [-0.35, 0.35].forEach((x) => {
                const arm = new THREE.Mesh(
                    new THREE.BoxGeometry(0.15, 0.6, 0.15),
                    new THREE.MeshStandardMaterial({ color: bodyColor })
                );
                arm.position.set(x, 0.8, 0);
                group.add(arm);
            });

            [-0.12, 0.12].forEach((x) => {
                const leg = new THREE.Mesh(
                    new THREE.BoxGeometry(0.18, 0.4, 0.2),
                    new THREE.MeshStandardMaterial({ color: 0x333355 })
                );
                leg.position.set(x, 0.2, 0);
                group.add(leg);
            });
            skinnedMaterials = [body.material];
        }

        const bubble = this._createBubble(recipe.name);
        bubble.position.set(0, bubbleBaseY, 0);
        group.add(bubble);

        const pBarY = bubbleBaseY - 0.13;
        const pBarBg = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.08, 0.08),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        pBarBg.position.set(0, pBarY, 0);
        group.add(pBarBg);

        const pBarFill = new THREE.Mesh(
            new THREE.BoxGeometry(0.78, 0.06, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x44dd44, emissive: 0x114411 })
        );
        pBarFill.position.set(0, pBarY, 0);
        group.add(pBarFill);

        group.userData.patronHeight = patronTemplate ? 1.74 : 1.7;
        this.scene.add(group);

        const customer = {
            group,
            body,
            modelRoot,
            mixer,
            clips,
            skinnedMaterials,
            bubble,
            pBarFill,
            recipe,
            spot: freeSpot,
            targetPos: freeSpot.position.clone(),
            state: 'entering',
            patience,
            maxPatience: patience,
            walkSpeed: 2.6 + Math.random() * 0.9,
            serveAnim: 0,
            _curAction: null,
            _useSkinned: !!mixer,
            bubbleBaseY,
            _nextDrinkAt: this.time + 2 + Math.random() * 2.5,
            ordersServedCount: 0,
            _playedHurryVoice: false,
            _pBarBand: -1,
            homeSeat,
            rowdy: false,
            _seatedUntil: 0,
        };

        if (mixer) {
            customer._onAnimFinished = (e) => this._handlePatronAnimFinished(customer, e);
            mixer.addEventListener('finished', customer._onAnimFinished);
        }

        if (mixer && clips.walk) {
            const a = mixer.clipAction(clips.walk);
            a.loop = THREE.LoopRepeat;
            a.play();
            customer._curAction = a;
        }

        this.customers.push(customer);
        return true;
    }

    _crossfadeTo(customer, clip, fade = 0.18) {
        if (!customer?.mixer || !clip) return;
        const next = customer.mixer.clipAction(clip);
        next.reset();
        next.setLoop(THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = false;
        next.fadeIn(fade).play();
        if (customer._curAction && customer._curAction !== next) {
            customer._curAction.fadeOut(fade);
        }
        customer._curAction = next;
    }

    _playOneShot(customer, clip, fade = 0.2) {
        if (!customer?.mixer || !clip) return;
        const next = customer.mixer.clipAction(clip);
        next.reset();
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
        next.fadeIn(fade).play();
        if (customer._curAction && customer._curAction !== next) {
            customer._curAction.fadeOut(fade);
        }
        customer._curAction = next;
    }

    _handlePatronAnimFinished(customer, e) {
        if (!this.customers.includes(customer)) return;
        const clip = e.action?.getClip?.();
        if (!clip) return;
        if (customer.state === 'waiting' && customer.clips.drink && clip === customer.clips.drink) {
            this._crossfadeTo(customer, customer.clips.idle, 0.22);
        } else if (customer.state === 'angry' && customer.clips.angry && clip === customer.clips.angry) {
            this._crossfadeTo(customer, customer.clips.idle, 0.14);
        } else if (customer.state === 'served' && customer.clips.happy && clip === customer.clips.happy) {
            this._crossfadeTo(customer, customer.clips.idle, 0.14);
        } else if (
            customer.state === 'seated' &&
            customer.clips.drink &&
            clip === customer.clips.drink
        ) {
            this._crossfadeTo(customer, customer.clips.idle, 0.22);
        }
    }

    serveCustomer(recipe, batchValid = true, premiumLager = false) {
        const customer = this.customers.find(
            (c) => c.state === 'waiting' && c.recipe.id === recipe.id
        );
        if (!customer) return false;

        const priceMult =
            premiumLager && recipe.id === 'lager' ? 1.38 : 1;
        const payout = Math.round(customer.recipe.price * priceMult);

        if (!batchValid) {
            if (Math.random() < 0.32) {
                this.audio.playError();
                return false;
            }
            const partial = Math.max(1, Math.floor(customer.recipe.price * 0.38));
            customer.ordersServedCount = (customer.ordersServedCount || 0) + 1;
            customer.state = 'served';
            customer.serveAnim = 0;
            this.gameState.player.money += partial;
            this.gameState.player.score += 4;
            customer.bubble.visible = false;
            customer.pBarFill.material.color.setHex(0xccaa44);
            if (customer.body?.isMesh && customer.body.material?.emissive) {
                customer.body.material.emissive.setHex(0x221a08);
            }
            for (const m of customer.skinnedMaterials) {
                if (m.emissive) m.emissive.setHex(0x332208);
            }
            if (customer.mixer && customer.clips.happy) {
                this._playOneShot(customer, customer.clips.happy, 0.16);
            }
            this.audio.playCashRegister();
            this.audio.playCustomerVoiceThankYou();
            return true;
        }

        customer.ordersServedCount = (customer.ordersServedCount || 0) + 1;
        customer.state = 'served';
        customer.serveAnim = 0;
        this.gameState.player.money += payout;
        this.gameState.player.score += premiumLager && recipe.id === 'lager' ? 14 : 10;

        customer.bubble.visible = false;
        customer.pBarFill.material.color.setHex(0x44ff44);
        if (customer.body?.isMesh && customer.body.material?.emissive) {
            customer.body.material.emissive.setHex(0x112211);
        }
        for (const m of customer.skinnedMaterials) {
            if (m.emissive) m.emissive.setHex(0x1a331a);
        }

        if (customer.mixer && customer.clips.happy) {
            this._playOneShot(customer, customer.clips.happy, 0.16);
        }

        this.audio.playCashRegister();
        if (customer._playedHurryVoice) {
            this.audio.playCustomerVoiceFinally();
        } else {
            this.audio.playCustomerVoiceThankYou();
        }
        return true;
    }

    update(delta) {
        this.time += delta;

        for (let i = this.customers.length - 1; i >= 0; i--) {
            const c = this.customers[i];
            if (c.mixer) c.mixer.update(delta);

            if (c.state === 'entering') {
                const dir = this._vDir.subVectors(c.targetPos, c.group.position);
                const dist = dir.length();
                if (dist < 0.22) {
                    c.group.position.copy(c.targetPos);
                    c.state = 'waiting';
                    c.group.rotation.y = c.spot?.rotationY ?? Math.PI;
                    this._crossfadeTo(c, c.clips.idle);
                } else {
                    dir.normalize().multiplyScalar(c.walkSpeed * delta);
                    c.group.position.add(dir);
                    if (!c._useSkinned) {
                        c.group.position.y = Math.abs(Math.sin(this.time * 8)) * 0.05;
                    }
                    c.group.rotation.y = this._walkYawForPatron(dir.x, dir.z, c);
                    if (c._useSkinned && c.clips.walk) {
                        const cur = c._curAction?.getClip?.();
                        if (cur !== c.clips.walk) this._crossfadeTo(c, c.clips.walk, 0.12);
                    }
                }
            }

            if (c.state === 'waiting') {
                c.patience -= delta;

                const ratio = c.maxPatience > 0 ? Math.max(0, c.patience / c.maxPatience) : 0;
                if (!c._playedHurryVoice && ratio > 0 && ratio < 0.35) {
                    c._playedHurryVoice = true;
                    this.audio.playCustomerVoiceHurry();
                }

                c.pBarFill.scale.x = Math.max(0.001, ratio);
                c.pBarFill.position.x = -(0.78 * (1 - ratio)) / 2;

                const band = ratio > 0.5 ? 0 : ratio > 0.25 ? 1 : 2;
                if (band !== c._pBarBand) {
                    c._pBarBand = band;
                    c.pBarFill.material.color.setHex(
                        band === 0 ? 0x44dd44 : band === 1 ? 0xdddd22 : 0xdd3322
                    );
                }

                if (
                    !c.rowdy &&
                    ratio < ROWDY_PATIENCE_RATIO &&
                    ratio > 0.04 &&
                    c.patience > 0.25
                ) {
                    c.rowdy = true;
                    this._redrawBubbleRowdy(c.bubble);
                }

                if (ratio < 0.3) {
                    c.group.position.x = c.targetPos.x + Math.sin(this.time * 10) * 0.05;
                }
                c.group.position.y = 0;

                c.bubble.position.y = c.bubbleBaseY + Math.sin(this.time * 2) * 0.05;

                if (c.patience <= 0) {
                    c.state = 'angry';
                    this._releaseTableSeat(c.homeSeat);
                    c.homeSeat = null;
                    c.bubble.visible = false;
                    c.pBarFill.visible = false;
                    for (const m of c.skinnedMaterials) {
                        if (m.color) m.color.setHex(0x661111);
                        if (m.emissive) m.emissive.setHex(0x220000);
                    }
                    if (c.body?.material?.color) c.body.material.color.setHex(0x880000);
                    if (c.mixer && c.clips.angry) {
                        this._playOneShot(c, c.clips.angry, 0.12);
                    }
                    this.audio.playCustomerAngry();
                    this.gameState.player.score = Math.max(0, this.gameState.player.score - 5);
                }

                if (c.clips.drink && this.time >= c._nextDrinkAt) {
                    const cur = c._curAction?.getClip?.();
                    const drinking = cur === c.clips.drink;
                    if (!drinking && cur === c.clips.idle) {
                        this._playOneShot(c, c.clips.drink, 0.2);
                        c._nextDrinkAt = this.time + 3.2 + Math.random() * 4;
                    } else if (!drinking) {
                        c._nextDrinkAt = this.time + 0.6;
                    }
                }
            }

            if (c.state === 'served') {
                c.serveAnim += delta;
                if (c.homeSeat) {
                    c.group.position.y = Math.abs(Math.sin(c.serveAnim * 5)) * 0.1;
                    if (c.serveAnim > 0.75) {
                        c.state = 'walk_to_table';
                        c.serveAnim = 0;
                        c.bubble.visible = false;
                        c.pBarFill.visible = false;
                        c.group.position.y = 0;
                        this._crossfadeTo(c, c.clips.walk, 0.12);
                    }
                } else {
                    c.group.position.y = Math.abs(Math.sin(c.serveAnim * 6)) * 0.18;
                    if (c.serveAnim > 1) {
                        const served = c.ordersServedCount || 0;
                        const roomForMore = served < MAX_ORDERS_PER_VISIT;
                        const wantsAnother = roomForMore && Math.random() < REORDER_AFTER_SERVE_CHANCE;
                        if (wantsAnother) {
                            this._requeueForAnotherRound(c);
                        } else {
                            c.state = 'leaving';
                            this.audio.playCustomerVoiceLeavingHappy();
                            this._crossfadeTo(c, c.clips.walk, 0.12);
                        }
                    }
                }
            }

            if (c.state === 'walk_to_table') {
                if (!c.homeSeat) {
                    c.state = 'leaving';
                    this._crossfadeTo(c, c.clips.walk, 0.12);
                } else {
                const tp = c.homeSeat.position;
                const dir = this._vDir.subVectors(tp, c.group.position);
                const dist = dir.length();
                if (dist < 0.28) {
                    c.group.position.copy(tp);
                    c.group.rotation.y = c.homeSeat.rotationY;
                    c.state = 'seated';
                    c.rowdy = false;
                    c._seatedUntil = this.time + SEATED_MIN + Math.random() * SEATED_EXTRA;
                    this._crossfadeTo(c, c.clips.idle, 0.15);
                } else {
                    dir.normalize().multiplyScalar(c.walkSpeed * delta);
                    c.group.position.add(dir);
                    c.group.rotation.y = this._walkYawForPatron(dir.x, dir.z, c);
                    if (c._useSkinned && c.clips.walk) {
                        const cur = c._curAction?.getClip?.();
                        if (cur !== c.clips.walk) this._crossfadeTo(c, c.clips.walk, 0.1);
                    }
                }
                }
            }

            if (c.state === 'walk_to_bar_from_seat') {
                const tp = c.spot.position;
                const dir = this._vDir.subVectors(tp, c.group.position);
                const dist = dir.length();
                if (dist < 0.28) {
                    c.group.position.copy(tp);
                    c.state = 'waiting';
                    c.group.rotation.y = c.spot?.rotationY ?? Math.PI;
                    c.patience = c.maxPatience * (0.85 + Math.random() * 0.25);
                    c.maxPatience = c.patience;
                    c.bubble.visible = true;
                    this._redrawBubbleNormal(c.bubble, c.recipe.name);
                    c.pBarFill.visible = true;
                    c.pBarFill.scale.x = 1;
                    c.pBarFill.position.x = 0;
                    c.pBarFill.material.color.setHex(0x44dd44);
                    c._playedHurryVoice = false;
                    c._pBarBand = -1;
                    this._crossfadeTo(c, c.clips.idle, 0.14);
                } else {
                    dir.normalize().multiplyScalar(c.walkSpeed * delta);
                    c.group.position.add(dir);
                    c.group.rotation.y = this._walkYawForPatron(dir.x, dir.z, c);
                    if (c._useSkinned && c.clips.walk) {
                        const cur = c._curAction?.getClip?.();
                        if (cur !== c.clips.walk) this._crossfadeTo(c, c.clips.walk, 0.1);
                    }
                }
            }

            if (c.state === 'seated') {
                if (!c.homeSeat) {
                    c.state = 'leaving';
                    this._crossfadeTo(c, c.clips.walk, 0.12);
                } else {
                c.group.position.copy(c.homeSeat.position);
                c.group.rotation.y = c.homeSeat.rotationY;
                c.group.position.y = 0;
                if (c.clips.drink && this.time >= c._nextDrinkAt) {
                    const cur = c._curAction?.getClip?.();
                    const drinking = cur === c.clips.drink;
                    if (!drinking && cur === c.clips.idle) {
                        this._playOneShot(c, c.clips.drink, 0.2);
                        c._nextDrinkAt = this.time + 3.5 + Math.random() * 4;
                    } else if (!drinking) {
                        c._nextDrinkAt = this.time + 0.6;
                    }
                }
                if (this.time >= c._seatedUntil) {
                    const served = c.ordersServedCount || 0;
                    const roomForMore = served < MAX_ORDERS_PER_VISIT;
                    const wantsBar = roomForMore && Math.random() < REORDER_AFTER_SERVE_CHANCE;
                    if (wantsBar) {
                        c.state = 'walk_to_bar_from_seat';
                        this._crossfadeTo(c, c.clips.walk, 0.12);
                    } else {
                        this._releaseTableSeat(c.homeSeat);
                        c.homeSeat = null;
                        c.state = 'leaving';
                        this.audio.playCustomerVoiceLeavingHappy();
                        this._crossfadeTo(c, c.clips.walk, 0.12);
                    }
                }
                }
            }

            if (c.state === 'angry') {
                c.serveAnim = (c.serveAnim || 0) + delta;
                c.group.position.y = 0;
                if (c.serveAnim > 0.8) {
                    c.state = 'leaving';
                    this.audio.playCustomerVoiceLeavingAngry();
                    this._crossfadeTo(c, c.clips.walk, 0.12);
                }
            }

            if (c.state === 'leaving') {
                const dir = this._vDir.subVectors(this._vExit.set(0, 0, 24), c.group.position);
                const dist = dir.length();
                if (dist < 0.5) {
                    this._disposeCustomer(c);
                    c.spot.occupied = false;
                    this.customers.splice(i, 1);
                } else {
                    dir.normalize().multiplyScalar(c.walkSpeed * 1.3 * delta);
                    c.group.position.add(dir);
                    c.group.rotation.y = this._walkYawForPatron(dir.x, dir.z, c);
                    if (!c._useSkinned) {
                        c.group.position.y = Math.abs(Math.sin(this.time * 8)) * 0.05;
                    } else if (c.clips.walk) {
                        const cur = c._curAction?.getClip?.();
                        if (cur !== c.clips.walk) this._crossfadeTo(c, c.clips.walk, 0.1);
                    }
                }
            }
        }
    }

    tryKickRowdyAfterPointing(player) {
        if (!player?.avatarPos || !player.getFacingXZ) return false;
        const px = player.avatarPos.x;
        const pz = player.avatarPos.z;
        const forward = this._vExit;
        player.getFacingXZ(forward);
        if (forward.lengthSq() < 1e-6) return false;
        forward.normalize();
        let best = null;
        let bestD = 1e9;
        for (const c of this.customers) {
            if (!c.rowdy || c.state !== 'waiting') continue;
            const dx = c.group.position.x - px;
            const dz = c.group.position.z - pz;
            const d = Math.hypot(dx, dz);
            if (d > 5.5 || d < 0.15) continue;
            const fx = dx / d;
            const fz = dz / d;
            const dot = forward.x * fx + forward.z * fz;
            if (dot < 0.42) continue;
            if (d < bestD) {
                bestD = d;
                best = c;
            }
        }
        if (!best) return false;
        this._kickOutCustomer(best);
        return true;
    }

    _kickOutCustomer(c) {
        c.rowdy = false;
        c.bubble.visible = false;
        c.pBarFill.visible = false;
        this._releaseTableSeat(c.homeSeat);
        c.homeSeat = null;
        c.state = 'leaving';
        this.audio.playCustomerVoiceLeavingAngry();
        this._crossfadeTo(c, c.clips.walk, 0.1);
        this.gameState.player.score += 4;
    }

    _disposeCustomer(c) {
        this._releaseTableSeat(c.homeSeat);
        if (c.mixer && c._onAnimFinished) {
            c.mixer.removeEventListener('finished', c._onAnimFinished);
        }
        c.mixer?.stopAllAction();
        this.scene.remove(c.group);
        c.group.traverse((obj) => {
            if (obj.geometry && !obj.geometry.userData?.shared) {
                obj.geometry.dispose?.();
            }
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) {
                if (m && m.map) m.map.dispose?.();
                m?.dispose?.();
            }
        });
    }

    getWaitingCustomers() {
        return this.customers.filter((c) => c.state === 'waiting');
    }

    /**
     * Waiting patron in range. Behind the bar, skip the camera cone so tap-aim / bar
     * colliders don’t force you to walk around — still requires patron “across” from you.
     * @param {import('./Player.js').Player} player
     */
    getConvinceTargetPatron(player) {
        if (!player?.getFacingXZ || !player.avatarPos) return null;
        const px = player.avatarPos.x;
        const pz = player.avatarPos.z;
        let best = null;
        let bestD2 = Infinity;
        const radius2 = CONVINCE_RADIUS_M * CONVINCE_RADIUS_M;

        let cachedForward = false;
        const custs = this.customers;
        for (let i = 0, n = custs.length; i < n; i++) {
            const c = custs[i];
            if (c.state !== 'waiting') continue;
            const cx = c.group.position.x;
            const cz = c.group.position.z;
            const dx = cx - px;
            const dz = cz - pz;
            const dist2 = dx * dx + dz * dz;
            if (dist2 < 1e-8 || dist2 > radius2) continue;
            if (dist2 >= bestD2) continue;

            const acrossBarService =
                pz < CONVINCE_BAR_PLAYER_MAX_Z &&
                cz > CONVINCE_BAR_PATRON_MIN_Z &&
                cz > pz + 0.12 &&
                Math.abs(dx) <= CONVINCE_BAR_MAX_LANE_X;

            if (!acrossBarService) {
                if (!cachedForward) {
                    player.getFacingXZ(this._convForward);
                    cachedForward = true;
                }
                const invDist = 1 / Math.sqrt(dist2);
                const dot =
                    this._convForward.x * dx * invDist + this._convForward.z * dz * invDist;
                if (dot < CONVINCE_MIN_FACING_DOT) continue;
            }

            bestD2 = dist2;
            best = c;
        }
        return best;
    }

    /**
     * True if a patron in front of you can be pitched, and at least one other beer is on tap.
     * @param {import('./Player.js').Player} player
     */
    canTryConvince(taps, player) {
        const customer = this.getConvinceTargetPatron(player);
        if (!customer) return false;
        const wantId = customer.recipe.id;
        // Previously allocated a Set each call; we just scan for any on-tap beer whose id
        // differs from the patron's order — 1 pass, 0 allocations.
        for (let i = 0, n = taps.length; i < n; i++) {
            const t = taps[i];
            if (t?.unlocked && t.keg?.recipe && t.keg.recipe.id !== wantId) return true;
        }
        return false;
    }

    /**
     * 50% chance the targeted (in-range, in-view) patron switches to another beer on tap.
     * @param {import('./Player.js').Player} player
     * @returns {'no_patron'|'no_patron_in_view'|'no_alternative'|'fail'|'success'}
     */
    tryConvinceWaitingCustomer(taps, recipeSystem, player) {
        const customer = this.getConvinceTargetPatron(player);
        if (!customer) {
            return this.getWaitingCustomers().length ? 'no_patron_in_view' : 'no_patron';
        }

        const wantId = customer.recipe.id;

        const alternatives = [];
        const seen = new Set();
        for (const tap of taps) {
            if (!tap?.unlocked || !tap.keg?.recipe) continue;
            const id = tap.keg.recipe.id;
            if (id === wantId || seen.has(id)) continue;
            seen.add(id);
            alternatives.push(tap.keg.recipe);
        }

        if (alternatives.length === 0) return 'no_alternative';

        if (Math.random() < 0.5) {
            this.audio.playError();
            return 'fail';
        }

        const newRecipe =
            alternatives[Math.floor(Math.random() * alternatives.length)];
        customer.recipe = recipeSystem.getRecipeById(newRecipe.id) || newRecipe;
        this._redrawBubble(customer.bubble, customer.recipe.name);
        this.audio.playCustomerVoiceThankYou();
        return 'success';
    }

    clearAllCustomers() {
        const list = [...this.customers];
        for (const c of list) {
            if (c.spot) c.spot.occupied = false;
            this._disposeCustomer(c);
        }
        this.customers.length = 0;
    }

    _pickReorderRecipe() {
        const cr = this.gameState.dailyCravings;
        if (cr?.length) return cr[Math.floor(Math.random() * cr.length)];
        return null;
    }

    _requeueForAnotherRound(c) {
        const nextRecipe = this._pickReorderRecipe() || c.recipe;
        c.recipe = nextRecipe;
        c.state = 'waiting';
        c.serveAnim = 0;
        const pMul = 0.75 + Math.random() * 0.35;
        c.patience = Math.max(12, c.maxPatience * pMul);
        c.maxPatience = c.patience;

        c.group.position.y = 0;
        c.group.position.x = c.targetPos.x;
        c.group.position.z = c.targetPos.z;
        c.group.rotation.y = c.spot?.rotationY ?? Math.PI;

        c.bubble.visible = true;
        this._redrawBubble(c.bubble, c.recipe.name);

        c.pBarFill.visible = true;
        c.pBarFill.scale.x = 1;
        c.pBarFill.position.x = 0;
        c.pBarFill.material.color.setHex(0x44dd44);
        if (c.pBarFill.material.emissive) c.pBarFill.material.emissive.setHex(0x114411);

        for (const m of c.skinnedMaterials) {
            if (m.emissive) m.emissive.setHex(0x000000);
        }
        if (c.body?.isMesh && c.body.material?.emissive) {
            c.body.material.emissive.setHex(0x000000);
        }

        c._nextDrinkAt = this.time + 1.2 + Math.random() * 1.8;
        c._playedHurryVoice = false;
        c._pBarBand = -1;
        if (c.mixer && c.clips.idle) this._crossfadeTo(c, c.clips.idle, 0.2);
    }

    _redrawBubbleNormal(sprite, recipeName) {
        this._redrawBubble(sprite, recipeName);
    }

    _redrawBubbleRowdy(sprite) {
        const tex = sprite.material.map;
        if (!tex?.image?.getContext) return;
        const canvas = tex.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(180,30,30,0.95)';
        ctx.beginPath();
        ctx.roundRect(10, 10, 236, 90, 15);
        ctx.fill();
        ctx.strokeStyle = '#4a0000';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = 'rgba(180,30,30,0.95)';
        ctx.beginPath();
        ctx.moveTo(120, 100);
        ctx.lineTo(128, 120);
        ctx.lineTo(136, 100);
        ctx.fill();
        ctx.font = 'bold 42px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('!!!', 128, 62);
        tex.needsUpdate = true;
    }

    _redrawBubble(sprite, recipeName) {
        const tex = sprite.material.map;
        if (!tex?.image?.getContext) return;
        const canvas = tex.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.roundRect(10, 10, 236, 90, 15);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.moveTo(120, 100);
        ctx.lineTo(128, 120);
        ctx.lineTo(136, 100);
        ctx.fill();
        ctx.font = '32px Arial';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.fillText('🍺 ' + recipeName, 128, 58);
        tex.needsUpdate = true;
    }

    _createBubble(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.roundRect(10, 10, 236, 90, 15);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.moveTo(120, 100);
        ctx.lineTo(128, 120);
        ctx.lineTo(136, 100);
        ctx.fill();

        ctx.font = '32px Arial';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.fillText('🍺 ' + text, 128, 58);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.4, 0.7, 1);
        return sprite;
    }
}
