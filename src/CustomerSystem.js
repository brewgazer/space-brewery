import * as THREE from 'three';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';

export class CustomerSystem {
    /**
     * @param {object|null} patronTemplate — from AssetLoader: { scene, clips, animations }
     */
    constructor(scene, customerSpots, gameState, audioSystem, patronTemplate = null) {
        this.scene = scene;
        this.spots = customerSpots;
        this.gameState = gameState;
        this.audio = audioSystem;
        this.patronTemplate = patronTemplate;
        this.customers = [];
        this.time = 0;
        this._vDir = new THREE.Vector3();
        this._vExit = new THREE.Vector3();

        this.bodyColors = [0x3366cc, 0xcc3333, 0x33aa33, 0xcc9933, 0x9933cc, 0x33cccc, 0xcc6699];
    }

    spawnCustomer(recipe, patience) {
        const freeSpot = this.spots.find(s => !s.occupied);
        if (!freeSpot) return false;

        freeSpot.occupied = true;

        const group = new THREE.Group();
        const entrance = new THREE.Vector3(0, 0, 22);
        group.position.copy(entrance);

        let body = null;
        let skinnedMaterials = [];
        let mixer = null;
        let clips = {};
        let modelRoot = null;

        if (this.patronTemplate?.scene) {
            modelRoot = SkeletonUtils.clone(this.patronTemplate.scene);
            const tint = new THREE.Color(
                this.bodyColors[Math.floor(Math.random() * this.bodyColors.length)]
            );

            modelRoot.traverse((ch) => {
                if (ch.isMesh && ch.material) {
                    ch.castShadow = true;
                    ch.receiveShadow = true;
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
            const src = this.patronTemplate.clips || {};
            clips = {
                idle: src.idle || null,
                walk: src.walk || src.run || src.idle || null,
            };

            group.add(modelRoot);
            body = modelRoot;
        } else {
            const bodyColor = this.bodyColors[Math.floor(Math.random() * this.bodyColors.length)];
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
        bubble.position.set(0, 2.05, 0);
        group.add(bubble);

        const pBarBg = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.08, 0.08),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        pBarBg.position.set(0, 1.92, 0);
        group.add(pBarBg);

        const pBarFill = new THREE.Mesh(
            new THREE.BoxGeometry(0.78, 0.06, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x44dd44, emissive: 0x114411 })
        );
        pBarFill.position.set(0, 1.92, 0);
        group.add(pBarFill);

        group.userData.patronHeight = this.patronTemplate ? 1.74 : 1.7;
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
        };

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
        next.loop = THREE.LoopRepeat;
        next.fadeIn(fade).play();
        if (customer._curAction && customer._curAction !== next) {
            customer._curAction.fadeOut(fade);
        }
        customer._curAction = next;
    }

    serveCustomer(recipe) {
        const customer = this.customers.find(
            (c) => c.state === 'waiting' && c.recipe.id === recipe.id
        );
        if (!customer) return false;

        customer.state = 'served';
        customer.serveAnim = 0;
        this.gameState.player.money += customer.recipe.price;
        this.gameState.player.score += 10;

        customer.bubble.visible = false;
        customer.pBarFill.material.color.setHex(0x44ff44);
        if (customer.body?.isMesh && customer.body.material?.emissive) {
            customer.body.material.emissive.setHex(0x112211);
        }
        for (const m of customer.skinnedMaterials) {
            if (m.emissive) m.emissive.setHex(0x1a331a);
        }

        this.audio.playCashRegister();
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
                    c.group.rotation.y = Math.PI;
                    this._crossfadeTo(c, c.clips.idle);
                } else {
                    dir.normalize().multiplyScalar(c.walkSpeed * delta);
                    c.group.position.add(dir);
                    if (!c._useSkinned) {
                        c.group.position.y = Math.abs(Math.sin(this.time * 8)) * 0.05;
                    }
                    c.group.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
                    if (c._useSkinned && c.clips.walk) {
                        const cur = c._curAction?.getClip?.();
                        if (cur !== c.clips.walk) this._crossfadeTo(c, c.clips.walk, 0.12);
                    }
                }
            }

            if (c.state === 'waiting') {
                c.patience -= delta;

                const ratio = Math.max(0, c.patience / c.maxPatience);
                c.pBarFill.scale.x = Math.max(0.001, ratio);
                c.pBarFill.position.x = -(0.78 * (1 - ratio)) / 2;

                if (ratio > 0.5) {
                    c.pBarFill.material.color.setHex(0x44dd44);
                } else if (ratio > 0.25) {
                    c.pBarFill.material.color.setHex(0xdddd22);
                } else {
                    c.pBarFill.material.color.setHex(0xdd3322);
                }

                if (ratio < 0.3) {
                    c.group.position.x = c.targetPos.x + Math.sin(this.time * 10) * 0.05;
                }
                c.group.position.y = 0;

                c.bubble.position.y = 2.05 + Math.sin(this.time * 2) * 0.05;

                if (c.patience <= 0) {
                    c.state = 'angry';
                    c.bubble.visible = false;
                    c.pBarFill.visible = false;
                    for (const m of c.skinnedMaterials) {
                        if (m.color) m.color.setHex(0x661111);
                        if (m.emissive) m.emissive.setHex(0x220000);
                    }
                    if (c.body?.material?.color) c.body.material.color.setHex(0x880000);
                    this.audio.playCustomerAngry();
                    this.gameState.player.score = Math.max(0, this.gameState.player.score - 5);
                }
            }

            if (c.state === 'served') {
                c.serveAnim += delta;
                c.group.position.y = Math.abs(Math.sin(c.serveAnim * 6)) * 0.18;
                if (c.serveAnim > 1) {
                    c.state = 'leaving';
                    this._crossfadeTo(c, c.clips.walk, 0.12);
                }
            }

            if (c.state === 'angry') {
                c.serveAnim = (c.serveAnim || 0) + delta;
                c.group.position.y = 0;
                if (c.serveAnim > 0.8) {
                    c.state = 'leaving';
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
                    c.group.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
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

    _disposeCustomer(c) {
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
