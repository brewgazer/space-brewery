import * as THREE from 'three';

// Slot definitions: positions and costs for upgradeable equipment
const BREW_SLOTS = [
    { x: -7, z: -19, unlocked: true, cost: 0 },
    { x: 7, z: -19, unlocked: false, cost: 100 },
    { x: -7, z: -15, unlocked: false, cost: 250 },
    { x: 7, z: -15, unlocked: false, cost: 500 },
];
const FERM_SLOTS = [
    { x: -9, z: -9, unlocked: true, cost: 0 },
    { x: 0, z: -9, unlocked: false, cost: 100 },
    { x: 9, z: -9, unlocked: false, cost: 200 },
    { x: -4.5, z: -5, unlocked: false, cost: 350 },
    { x: 4.5, z: -5, unlocked: false, cost: 500 },
];
const TAP_SLOTS = [
    { x: -10, unlocked: true, cost: 0 },
    { x: -6, unlocked: true, cost: 0 },
    { x: -2, unlocked: false, cost: 75 },
    { x: 2, unlocked: false, cost: 150 },
    { x: 6, unlocked: false, cost: 250 },
    { x: 10, unlocked: false, cost: 400 },
];

export class World {
    constructor(scene, assets = null) {
        this.scene = scene;
        this.assets = assets || {};
        this.colliders = [];
        this.interactables = [];
        this.brewStations = [];
        this.fermenters = [];
        this.kegStation = null;
        this.taps = [];
        this.customerSpots = [];

        this._kettleGeo = World._createKettleLatheGeometry();

        this._buildEnvironment();
        this._buildBrewStations();
        this._buildFermenters();
        this._buildKegStation();
        this._buildBar();
        this._buildTaps();
        this._buildCustomerSpots();
        this._buildTaproomFurniture();
        this._buildLighting();
        this._buildDecorations();
    }

    // ─── helpers ────────────────────────────────────────────
    _addCollider(mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        this.colliders.push({ mesh, box });
    }

    _mat(color, opts = {}) {
        return new THREE.MeshStandardMaterial({
            color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0.1,
            emissive: opts.emissive ?? 0x000000,
            envMapIntensity: opts.envMapIntensity ?? 0.75,
            ...opts.extra
        });
    }

    static _createKettleLatheGeometry() {
        const pts = [
            new THREE.Vector2(0.02, 0),
            new THREE.Vector2(0.5, 0.02),
            new THREE.Vector2(0.63, 0.18),
            new THREE.Vector2(0.71, 0.38),
            new THREE.Vector2(0.69, 0.58),
            new THREE.Vector2(0.6, 0.78),
            new THREE.Vector2(0.54, 0.98),
            new THREE.Vector2(0.4, 1.12),
            new THREE.Vector2(0.36, 1.28),
            new THREE.Vector2(0.4, 1.38),
            new THREE.Vector2(0.22, 1.45),
            new THREE.Vector2(0.06, 1.49),
        ];
        return new THREE.LatheGeometry(pts, 26);
    }

    _copperKettleMaterial() {
        const t = this.assets.textures?.metal;
        if (t) {
            return new THREE.MeshStandardMaterial({
                map: t,
                color: 0xd8a85c,
                metalness: 0.58,
                roughness: 0.36,
                envMapIntensity: 1.05,
            });
        }
        return new THREE.MeshStandardMaterial({
            color: 0xb87333,
            metalness: 0.86,
            roughness: 0.26,
            envMapIntensity: 0.9,
        });
    }

    _stainlessMaterial() {
        const t = this.assets.textures?.metal;
        if (t) {
            return new THREE.MeshStandardMaterial({
                map: t,
                color: 0xe8e8ea,
                metalness: 0.68,
                roughness: 0.34,
                envMapIntensity: 1.1,
            });
        }
        return new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.74,
            roughness: 0.32,
            envMapIntensity: 0.95,
        });
    }

    _woodTableMaterial() {
        const t = this.assets.textures?.woodFloor;
        if (t) {
            return new THREE.MeshStandardMaterial({
                map: t,
                color: 0xddc9a8,
                roughness: 0.58,
                metalness: 0.04,
                envMapIntensity: 0.4,
            });
        }
        return this._mat(0x5c3317, { rough: 0.6 });
    }

    _textSprite(text, color = 0xffffff, scale = 1) {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 64;
        const ctx = c.getContext('2d');
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const hex = '#' + new THREE.Color(color).getHexString();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.strokeText(text, 128, 32);
        ctx.fillStyle = hex; ctx.fillText(text, 128, 32);
        const tex = new THREE.CanvasTexture(c);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const s = new THREE.Sprite(mat);
        s.scale.set(2 * scale, 0.5 * scale, 1);
        return s;
    }

    _addLockOverlay(group, w, h, d, yCenter, cost) {
        const overlay = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.15, h + 0.15, d + 0.15),
            new THREE.MeshStandardMaterial({
                color: 0x181818, transparent: true, opacity: 0.55, depthWrite: false
            })
        );
        overlay.position.y = yCenter;
        overlay.renderOrder = 1;
        group.add(overlay);
        const lockLabel = this._textSprite(`LOCKED  $${cost}`, 0xff6644, 0.8);
        lockLabel.position.y = yCenter + h / 2 + 0.35;
        group.add(lockLabel);
        return { overlay, lockLabel };
    }

    // ─── environment ────────────────────────────────────────
    _buildEnvironment() {
        const RW = 34, RD = 46; // room width / depth
        const HW = RW / 2, HD = RD / 2;

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(RW, RD),
            new THREE.MeshStandardMaterial({
                color: 0x4a3220,
                roughness: 0.9,
                metalness: 0.02,
                envMapIntensity: 0.3,
            })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        const ceil = new THREE.Mesh(
            new THREE.PlaneGeometry(RW, RD),
            new THREE.MeshStandardMaterial({
                color: 0x2a1e16,
                roughness: 0.94,
                emissive: 0x1a1008,
                emissiveIntensity: 0.14,
                envMapIntensity: 0.2,
            })
        );
        ceil.rotation.x = Math.PI / 2;
        ceil.position.y = 3.5;
        this.scene.add(ceil);

        const wm = this._mat(0x8b7355);

        // Walls (thin boxes)
        const wallH = 3.5;
        const makeWall = (cx, cz, w, d) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wm);
            m.position.set(cx, wallH / 2, cz);
            m.castShadow = false;
            m.receiveShadow = true;
            this.scene.add(m); this._addCollider(m);
        };
        // North
        makeWall(0, -HD, RW, 0.3);
        // South – left / right of entrance gap
        makeWall(-HW / 2 - 1.5, HD, HW - 3, 0.3);
        makeWall(HW / 2 + 1.5, HD, HW - 3, 0.3);
        // East & West
        makeWall(HW, 0, 0.3, RD);
        makeWall(-HW, 0, 0.3, RD);

        const brewTex = this.assets.textures?.breweryFloor;
        const bfMat = brewTex
            ? new THREE.MeshStandardMaterial({
                map: brewTex,
                color: 0xcccccc,
                roughness: 0.78,
                metalness: 0.04,
                envMapIntensity: 0.45,
            })
            : new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.82, envMapIntensity: 0.35 });
        const bf = new THREE.Mesh(new THREE.PlaneGeometry(RW - 1, 20), bfMat);
        bf.rotation.x = -Math.PI / 2;
        bf.position.set(0, 0.005, -12);
        bf.receiveShadow = true;
        this.scene.add(bf);

        const woodTex = this.assets.textures?.woodFloor;
        const tfMat = woodTex
            ? new THREE.MeshStandardMaterial({
                map: woodTex,
                color: 0xcfb69a,
                roughness: 0.72,
                metalness: 0.03,
                envMapIntensity: 0.38,
            })
            : new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.82, envMapIntensity: 0.35 });
        const tf = new THREE.Mesh(new THREE.PlaneGeometry(RW - 1, 20), tfMat);
        tf.rotation.x = -Math.PI / 2;
        tf.position.set(0, 0.005, 12);
        tf.receiveShadow = true;
        this.scene.add(tf);
    }

    // ─── brew stations ──────────────────────────────────────
    _buildBrewStations() {
        BREW_SLOTS.forEach((slot, index) => {
            const pos = new THREE.Vector3(slot.x, 0, slot.z);
            const group = new THREE.Group();
            group.position.copy(pos);

            const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1, 2), this._mat(0x555555));
            base.position.y = 0.5; group.add(base);

            const copper = this._copperKettleMaterial();
            const kettle = new THREE.Mesh(this._kettleGeo, copper);
            kettle.position.y = 1.02;
            kettle.castShadow = true;
            kettle.geometry.userData.shared = true;
            group.add(kettle);

            const lid = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.65, 0.14, 12),
                copper
            );
            lid.position.y = 2.52;
            group.add(lid);

            const label = this._textSprite(`Brew Station ${index + 1}`, 0xffffff);
            label.position.y = 2.8; group.add(label);

            const progressBg = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 0.15), this._mat(0x333333));
            progressBg.position.set(0, 2.6, 0.5); group.add(progressBg);

            const progressFill = new THREE.Mesh(
                new THREE.BoxGeometry(2, 0.12, 0.12),
                new THREE.MeshStandardMaterial({ color: 0x44aa44, emissive: 0x224422 })
            );
            progressFill.position.set(0, 2.6, 0.5);
            progressFill.scale.x = 0; progressFill.visible = false; group.add(progressFill);

            const liquid = new THREE.Mesh(
                new THREE.CylinderGeometry(0.48, 0.58, 0.75, 14),
                new THREE.MeshStandardMaterial({
                    color: 0xd4a017,
                    transparent: true,
                    opacity: 0.72,
                    roughness: 0.15,
                    metalness: 0.1,
                    envMapIntensity: 0.5,
                })
            );
            liquid.position.y = 1.48;
            liquid.visible = false;
            group.add(liquid);

            // Lock overlay for locked stations
            let lockOverlay = null, lockLabel = null;
            if (!slot.unlocked) {
                ({ overlay: lockOverlay, lockLabel } = this._addLockOverlay(group, 2.5, 2.4, 2, 1.2, slot.cost));
            }

            this.scene.add(group);

            const hitbox = new THREE.Mesh(
                new THREE.BoxGeometry(2.5, 2.5, 2),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            hitbox.position.copy(pos); hitbox.position.y = 1.25;
            hitbox.userData = { type: 'brewStation', index };
            this.scene.add(hitbox);
            this.interactables.push(hitbox);
            this._addCollider(hitbox);

            this.brewStations.push({
                group, kettle, liquid, progressFill, progressBg, label,
                lockOverlay, lockLabel,
                position: pos, state: 'empty', recipe: null,
                progress: 0, duration: 0,
                unlocked: slot.unlocked, cost: slot.cost
            });
        });
    }

    // ─── fermenters ─────────────────────────────────────────
    _buildFermenters() {
        FERM_SLOTS.forEach((slot, index) => {
            const pos = new THREE.Vector3(slot.x, 0, slot.z);
            const group = new THREE.Group();
            group.position.copy(pos);

            const steel = this._stainlessMaterial();
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.5, 20), steel);
            tank.position.y = 1.75;
            group.add(tank);

            [0.55, 1.35, 2.15].forEach((y) => {
                const ring = new THREE.Mesh(
                    new THREE.TorusGeometry(0.62, 0.028, 6, 28),
                    steel
                );
                ring.rotation.x = Math.PI / 2;
                ring.position.set(0, y, 0);
                group.add(ring);
            });

            const cone = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.5, 12), steel);
            cone.position.y = 0.25;
            cone.rotation.x = Math.PI;
            group.add(cone);

            const dome = new THREE.Mesh(
                new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
                this._stainlessMaterial()
            );
            dome.position.y = 3;
            group.add(dome);

            const gauge = new THREE.Mesh(
                new THREE.SphereGeometry(0.12, 8, 8),
                new THREE.MeshStandardMaterial({ color: 0x44aa44, emissive: 0x113311 })
            );
            gauge.position.set(0.65, 2, 0); group.add(gauge);

            const label = this._textSprite(`Fermenter ${index + 1}`, 0xffffff);
            label.position.y = 3.5; group.add(label);

            const progressBg = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), this._mat(0x333333));
            progressBg.position.set(0, 3.3, 0.5); group.add(progressBg);

            const progressFill = new THREE.Mesh(
                new THREE.BoxGeometry(1.5, 0.1, 0.1),
                new THREE.MeshStandardMaterial({ color: 0xdd8800, emissive: 0x442200 })
            );
            progressFill.position.set(0, 3.3, 0.5);
            progressFill.scale.x = 0; progressFill.visible = false; group.add(progressFill);

            const liquid = new THREE.Mesh(
                new THREE.CylinderGeometry(0.55, 0.55, 2, 12),
                new THREE.MeshStandardMaterial({ color: 0xd4a017, transparent: true, opacity: 0.5 })
            );
            liquid.position.y = 1.5; liquid.visible = false; group.add(liquid);

            let lockOverlay = null, lockLabel = null;
            if (!slot.unlocked) {
                ({ overlay: lockOverlay, lockLabel } = this._addLockOverlay(group, 1.4, 3.4, 1.4, 1.7, slot.cost));
            }

            this.scene.add(group);

            const hitbox = new THREE.Mesh(
                new THREE.BoxGeometry(1.5, 3.5, 1.5),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            hitbox.position.copy(pos); hitbox.position.y = 1.75;
            hitbox.userData = { type: 'fermenter', index };
            this.scene.add(hitbox); this.interactables.push(hitbox);
            this._addCollider(hitbox);

            this.fermenters.push({
                group, tank, liquid, gauge, progressFill, progressBg, label,
                lockOverlay, lockLabel,
                position: pos, state: 'empty', recipe: null,
                progress: 0, duration: 0, speed: 1.0, bubbles: [],
                unlocked: slot.unlocked, cost: slot.cost
            });
        });
    }

    // ─── keg station ────────────────────────────────────────
    _buildKegStation() {
        const pos = new THREE.Vector3(13, 0, -4);
        const group = new THREE.Group();
        group.position.copy(pos);

        const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 2), this._mat(0x555555));
        table.position.y = 0.45; group.add(table);

        const keg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.3, 0.7, 12),
            new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.6, roughness: 0.4 })
        );
        keg.position.set(0, 1.3, 0); keg.rotation.x = Math.PI / 2; group.add(keg);

        const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8), this._mat(0x333333));
        hose.position.set(-0.8, 1.2, 0); hose.rotation.z = Math.PI / 4; group.add(hose);

        const label = this._textSprite('Keg Station', 0xffffff);
        label.position.y = 2.2; group.add(label);

        this.scene.add(group);

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(3, 2, 2), new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.copy(pos); hitbox.position.y = 1;
        hitbox.userData = { type: 'kegStation' };
        this.scene.add(hitbox); this.interactables.push(hitbox);
        this._addCollider(hitbox);

        // Keg rack
        const rack = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 1), this._mat(0x444444));
        rack.position.set(13, 0.6, -1);
        this.scene.add(rack); this._addCollider(rack);

        this.kegStation = { group, position: pos, kegMeshes: [] };
    }

    // ─── bar ────────────────────────────────────────────────
    _buildBar() {
        const barW = 28;
        const barZ = 1.5;

        const topWood = this.assets.textures?.woodFloor
            ? new THREE.MeshStandardMaterial({
                map: this.assets.textures.woodFloor,
                color: 0xc4a882,
                roughness: 0.52,
                metalness: 0.06,
                envMapIntensity: 0.55,
            })
            : new THREE.MeshStandardMaterial({ color: 0x3d1f0a, roughness: 0.42, envMapIntensity: 0.45 });
        const top = new THREE.Mesh(new THREE.BoxGeometry(barW, 0.15, 1.8), topWood);
        top.position.set(0, 1.1, barZ);
        top.castShadow = true;
        top.receiveShadow = true;
        this.scene.add(top);

        const front = new THREE.Mesh(new THREE.BoxGeometry(barW, 1.1, 0.15), this._mat(0x5c3317));
        front.position.set(0, 0.55, barZ + 0.9); front.castShadow = true;
        this.scene.add(front);

        const back = new THREE.Mesh(new THREE.BoxGeometry(barW, 1.1, 0.15), this._mat(0x5c3317));
        back.position.set(0, 0.55, barZ - 0.9); this.scene.add(back);

        const col = new THREE.Mesh(
            new THREE.BoxGeometry(barW, 1.15, 1.8), new THREE.MeshBasicMaterial({ visible: false })
        );
        col.position.set(0, 0.575, barZ); this._addCollider(col);

        // Stools
        for (let x = -12; x <= 12; x += 3) {
            const stool = new THREE.Mesh(
                new THREE.CylinderGeometry(0.25, 0.2, 0.8, 8), this._mat(0x4a3520)
            );
            stool.position.set(x, 0.4, barZ + 1.6);
            this.scene.add(stool);
        }
    }

    // ─── taps ───────────────────────────────────────────────
    _buildTaps() {
        const tapZ = 0.8;

        TAP_SLOTS.forEach((slot, index) => {
            const group = new THREE.Group();
            group.position.set(slot.x, 1.15, tapZ);

            const handle = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8),
                new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8, roughness: 0.2 })
            );
            handle.position.y = 0.35; group.add(handle);

            const knob = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                new THREE.MeshStandardMaterial({ color: 0xff0000, metalness: 0.3, roughness: 0.4 })
            );
            knob.position.y = 0.65; group.add(knob);

            const tapBase = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.1, 0.1, 8),
                new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 })
            );
            tapBase.position.y = 0.05; group.add(tapBase);

            const label = this._textSprite(`Tap ${index + 1}`, 0xcccccc);
            label.position.y = 1.0; group.add(label);

            let lockOverlay = null, lockLabel = null;
            if (!slot.unlocked) {
                ({ overlay: lockOverlay, lockLabel } = this._addLockOverlay(group, 1, 1, 0.6, 0.5, slot.cost));
            }

            this.scene.add(group);

            const hitbox = new THREE.Mesh(
                new THREE.BoxGeometry(1.2, 1.2, 0.8), new THREE.MeshBasicMaterial({ visible: false })
            );
            hitbox.position.set(slot.x, 1.6, tapZ);
            hitbox.userData = { type: 'tap', index };
            this.scene.add(hitbox); this.interactables.push(hitbox);

            this.taps.push({
                group, handle, knob, label,
                lockOverlay, lockLabel,
                position: new THREE.Vector3(slot.x, 1.15, tapZ),
                keg: null,
                unlocked: slot.unlocked, cost: slot.cost
            });
        });
    }

    // ─── customer spots ─────────────────────────────────────
    _buildCustomerSpots() {
        [-10, -5, 0, 5, 10].forEach((x, index) => {
            this.customerSpots.push({
                position: new THREE.Vector3(x, 0, 4),
                occupied: false, index
            });
        });
    }

    // ─── taproom furniture (aesthetic only) ──────────────────
    _buildTaproomFurniture() {
        const tableMat = this._woodTableMaterial();
        const chairMat = this._mat(0x4a3520, { rough: 0.7 });
        const cushionMat = this._mat(0x8b2500, { rough: 0.9 });
        const boothMat = this._mat(0x6b2a1a, { rough: 0.8 });
        const boothCushion = this._mat(0x993311, { rough: 0.9 });

        // ── round tables with chairs ──
        const tableConfigs = [
            { x: -9, z: 8, chairs: 4 },
            { x: 0, z: 9, chairs: 4 },
            { x: 9, z: 8, chairs: 4 },
            { x: -5, z: 15, chairs: 2 },
            { x: 5, z: 15, chairs: 2 },
            { x: 0, z: 19, chairs: 4 },
        ];
        tableConfigs.forEach(cfg => {
            // Table top
            const top = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 12), tableMat);
            top.position.set(cfg.x, 0.75, cfg.z);
            this.scene.add(top);
            // Table leg
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.75, 6), tableMat);
            leg.position.set(cfg.x, 0.375, cfg.z);
            this.scene.add(leg);
            // Table base
            const tbase = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 8), tableMat);
            tbase.position.set(cfg.x, 0.02, cfg.z);
            this.scene.add(tbase);
            // Collider
            const tcol = new THREE.Mesh(
                new THREE.CylinderGeometry(0.7, 0.7, 0.8, 8),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            tcol.position.set(cfg.x, 0.4, cfg.z);
            this._addCollider(tcol);

            // Chairs around the table
            for (let i = 0; i < cfg.chairs; i++) {
                const angle = (i / cfg.chairs) * Math.PI * 2;
                const cx = cfg.x + Math.cos(angle) * 1.2;
                const cz = cfg.z + Math.sin(angle) * 1.2;

                // Seat
                const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.4), chairMat);
                seat.position.set(cx, 0.19, cz);
                this.scene.add(seat);
                // Cushion on seat
                const cush = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.35), cushionMat);
                cush.position.set(cx, 0.4, cz);
                this.scene.add(cush);
                // Chair back
                const backX = cx + Math.cos(angle) * 0.18;
                const backZ = cz + Math.sin(angle) * 0.18;
                const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.06), chairMat);
                chairBack.position.set(backX, 0.6, backZ);
                chairBack.rotation.y = -angle + Math.PI;
                this.scene.add(chairBack);
            }
        });

        // ── booth seating along east wall ──
        [8, 14].forEach(z => {
            // Bench seat
            const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.45, 0.7), boothMat);
            bench.position.set(15.5, 0.225, z);
            this.scene.add(bench);
            // Cushion
            const bcush = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.06, 0.6), boothCushion);
            bcush.position.set(15.5, 0.48, z);
            this.scene.add(bcush);
            // Back rest
            const bback = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 0.12), boothMat);
            bback.position.set(16.4, 0.65, z);
            this.scene.add(bback);
            // Table in front of booth
            const btop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.8), tableMat);
            btop.position.set(14, 0.75, z);
            this.scene.add(btop);
            const bleg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.6), tableMat);
            bleg.position.set(14, 0.375, z);
            this.scene.add(bleg);
            const btcol = new THREE.Mesh(
                new THREE.BoxGeometry(2.6, 0.8, 1), new THREE.MeshBasicMaterial({ visible: false })
            );
            btcol.position.set(14.8, 0.4, z); this._addCollider(btcol);
        });

        // ── booth seating along west wall ──
        [8, 14].forEach(z => {
            const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.45, 0.7), boothMat);
            bench.position.set(-15.5, 0.225, z);
            this.scene.add(bench);
            const bcush = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.06, 0.6), boothCushion);
            bcush.position.set(-15.5, 0.48, z);
            this.scene.add(bcush);
            const bback = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 0.12), boothMat);
            bback.position.set(-16.4, 0.65, z);
            this.scene.add(bback);
            const btop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.8), tableMat);
            btop.position.set(-14, 0.75, z);
            this.scene.add(btop);
            const bleg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.6), tableMat);
            bleg.position.set(-14, 0.375, z);
            this.scene.add(bleg);
            const btcol = new THREE.Mesh(
                new THREE.BoxGeometry(2.6, 0.8, 1), new THREE.MeshBasicMaterial({ visible: false })
            );
            btcol.position.set(-14.8, 0.4, z); this._addCollider(btcol);
        });

        // ── dartboard on south wall ──
        const board = new THREE.Mesh(
            new THREE.CylinderGeometry(0.45, 0.45, 0.06, 24),
            this._mat(0x2a5e1a, { rough: 0.9 })
        );
        board.rotation.x = Math.PI / 2;
        board.position.set(-8, 1.6, 22.7);
        this.scene.add(board);
        // Outer ring
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.45, 0.04, 8, 24),
            this._mat(0x222222, { metal: 0.5 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(-8, 1.6, 22.65);
        this.scene.add(ring);
        // Dartboard label
        const dlabel = this._textSprite('DARTS', 0xccaa66, 0.6);
        dlabel.position.set(-8, 2.3, 22.7);
        this.scene.add(dlabel);

        // ── chalkboard menu on west wall ──
        const chalk = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 1.2, 2.4),
            this._mat(0x1a2a1a, { rough: 0.95 })
        );
        chalk.position.set(-16.7, 1.8, 11);
        this.scene.add(chalk);
        const chalkFrame = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 1.35, 2.55),
            this._mat(0x3d2b1f)
        );
        chalkFrame.position.set(-16.73, 1.8, 11);
        this.scene.add(chalkFrame);
        const menuLabel = this._textSprite('TODAYS BREWS', 0x88cc88, 0.7);
        menuLabel.position.set(-16.5, 1.8, 11);
        this.scene.add(menuLabel);

        // ── hanging pendant lights over taproom tables ──
        tableConfigs.forEach(cfg => {
            const cord = new THREE.Mesh(
                new THREE.CylinderGeometry(0.01, 0.01, 1.2, 4),
                this._mat(0x222222)
            );
            cord.position.set(cfg.x, 2.9, cfg.z);
            this.scene.add(cord);
            const shade = new THREE.Mesh(
                new THREE.ConeGeometry(0.25, 0.2, 8, 1, true),
                this._mat(0x8b4513, { metal: 0.3 })
            );
            shade.position.set(cfg.x, 2.35, cfg.z);
            shade.rotation.x = Math.PI;
            this.scene.add(shade);
        });

        // ── a few potted plants ──
        [[-13, 0, 5.5], [13, 0, 5.5], [0, 0, 21]].forEach(([px, py, pz]) => {
            const pot = new THREE.Mesh(
                new THREE.CylinderGeometry(0.2, 0.15, 0.35, 8),
                this._mat(0x8b4513, { rough: 0.9 })
            );
            pot.position.set(px, 0.175, pz); this.scene.add(pot);
            const plant = new THREE.Mesh(
                new THREE.SphereGeometry(0.3, 8, 6),
                this._mat(0x2d6b2d, { rough: 0.95 })
            );
            plant.position.set(px, 0.55, pz);
            this.scene.add(plant);
        });
    }

    // ─── lighting ───────────────────────────────────────────
    _buildLighting() {
        const ambient = new THREE.AmbientLight(0xffecd4, 0.82);
        this.scene.add(ambient);

        const hemi = new THREE.HemisphereLight(0xfff5ee, 0x7a5c42, 0.52);
        this.scene.add(hemi);

        // One directional key light + single shadow map (far cheaper than many point shadows)
        const sun = new THREE.DirectionalLight(0xffebd4, 1.05);
        sun.position.set(10, 16, 8);
        sun.target.position.set(0, 0, 2);
        this.scene.add(sun);
        this.scene.add(sun.target);

        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 48;
        sun.shadow.camera.left = -19;
        sun.shadow.camera.right = 19;
        sun.shadow.camera.top = 19;
        sun.shadow.camera.bottom = -25;
        sun.shadow.bias = -0.0004;

        // Soft warm fills (no shadows — cheap)
        const fillBrew = new THREE.PointLight(0xffe8c8, 0.42, 38);
        fillBrew.position.set(-6, 3.2, -12);
        this.scene.add(fillBrew);

        const fillTap = new THREE.PointLight(0xffdeb8, 0.38, 36);
        fillTap.position.set(4, 3.2, 12);
        this.scene.add(fillTap);

        // Gentle fog far back
        this.scene.fog = new THREE.Fog(0x2a1a0e, 34, 58);
    }

    // ─── decorations ────────────────────────────────────────
    _buildDecorations() {
        // Barrels along west wall in brewery
        for (let z = -20; z <= -8; z += 3) {
            const barrel = new THREE.Mesh(
                new THREE.CylinderGeometry(0.45, 0.4, 0.9, 12),
                new THREE.MeshStandardMaterial({ color: 0x6b3a1f, roughness: 0.8 })
            );
            barrel.position.set(-15, 0.45, z);
            this.scene.add(barrel); this._addCollider(barrel);
        }

        // TAPROOM sign above bar
        const sign = new THREE.Mesh(
            new THREE.BoxGeometry(8, 0.8, 0.1), this._mat(0x2c1810)
        );
        sign.position.set(0, 2.8, 2.8); this.scene.add(sign);
        const signText = this._textSprite('TAPROOM', 0xffd700, 1.5);
        signText.position.set(0, 2.8, 2.9); this.scene.add(signText);

        // BREWERY sign on north side
        const bsign = new THREE.Mesh(
            new THREE.BoxGeometry(6, 0.6, 0.1), this._mat(0x2c1810)
        );
        bsign.position.set(0, 2.8, -1); this.scene.add(bsign);
        const bsignText = this._textSprite('BREWERY', 0xccaa66, 1.2);
        bsignText.position.set(0, 2.8, -1.1); this.scene.add(bsignText);

        // Shelves on east wall in brewery
        for (let y = 1.5; y <= 2.5; y += 1) {
            const shelf = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.08, 3), this._mat(0x5c3317)
            );
            shelf.position.set(16.6, y, -15); this.scene.add(shelf);
        }

        // Welcome mat at entrance
        const mat = new THREE.Mesh(
            new THREE.BoxGeometry(4, 0.02, 1.5),
            this._mat(0x3d2b1f, { rough: 0.95 })
        );
        mat.position.set(0, 0.01, 22.5); this.scene.add(mat);
    }
}
