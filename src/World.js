import * as THREE from 'three';
import { getFurnitureGeometries } from './FurnitureKit.js';
import { INGREDIENTS, getIngredientById } from './Ingredient.js';
import { createIngredientFloorVisual, createMilledGristFloorVisual } from './IngredientVisuals.js';
import { applyBucketGristFill } from './BucketFillVisual.js';
import { LAGER_TANK_STORE_ID } from './StoreObjects.js';

// ───────────────────────────────────────────────────────────
//  Horseshoe-bar geometry (shared by bar build, tap slots, customer spots)
// ───────────────────────────────────────────────────────────
/** Bar-zone layout is a horseshoe opening north (−z) toward the brewery. */
export const BAR = {
    /** Bar arc center (world XZ). */
    cx: 0,
    cz: 5,
    /** Inner edge radius (bartender side) / outer edge radius (customer side). */
    innerR: 3.15,
    outerR: 4.25,
    /** Bar-top height (its top surface sits at y = topY). */
    topY: 1.1,
    frontH: 1.1,
    /** Ends of the horseshoe arc (angles in radians, measured from +X going CCW toward +Z). */
    angleStart: Math.PI / 6,      // 30° (east end)
    angleEnd: (5 * Math.PI) / 6,  // 150° (west end)
};
BAR.centerR = (BAR.innerR + BAR.outerR) * 0.5;
BAR.angleSpan = BAR.angleEnd - BAR.angleStart;

/** Position on the bar top centerline at angle θ (radians, measured CCW from +X). */
function _barCenterlineXZ(theta) {
    return [BAR.cx + BAR.centerR * Math.cos(theta), BAR.cz + BAR.centerR * Math.sin(theta)];
}
/** Yaw (three.js rotation.y) so an object's default `-Z` forward points radially outward. */
function _barOutwardYaw(theta) {
    return Math.atan2(-Math.cos(theta), -Math.sin(theta));
}
/** Yaw so an object's default `-Z` forward points radially inward (customer facing bar). */
function _barInwardYaw(theta) {
    return Math.atan2(Math.cos(theta), Math.sin(theta));
}

/** 6 taps spread evenly around the horseshoe arc (always inside the span). */
const _TAP_ANGLES = Array.from({ length: 6 }, (_, i) =>
    BAR.angleStart + ((i + 0.5) / 6) * BAR.angleSpan
);

// Slot definitions: positions and costs for upgradeable equipment
export const BREW_SLOTS = [
    { x: -7, z: -19, unlocked: true, cost: 0 },
];
export const FERM_SLOTS = [
    { x: -9, z: -9, starter: true, unlocked: true, cost: 0 },
    { x: 0, z: -9, storeId: 'fermenter_slot_1', unlocked: false, cost: 100 },
    { x: 9, z: -9, storeId: 'fermenter_slot_2', unlocked: false, cost: 200 },
    { x: -4.5, z: -5, storeId: 'fermenter_slot_3', unlocked: false, cost: 350 },
    { x: 4.5, z: -5, storeId: 'fermenter_slot_4', unlocked: false, cost: 500 },
];
/** Taps sit on the bar-top centerline, tap models face radially outward (toward the customer). */
export const TAP_SLOTS = _TAP_ANGLES.map((theta, i) => {
    const [x, z] = _barCenterlineXZ(theta);
    const rotationY = _barOutwardYaw(theta);
    const common = { x, z, rotationY, angle: theta };
    if (i === 0) return { ...common, starter: true, unlocked: true, cost: 0 };
    if (i === 1) return { ...common, starter: true, unlocked: true, cost: 0 };
    if (i === 2) return { ...common, storeId: 'tap_slot_2', unlocked: false, cost: 75 };
    if (i === 3) return { ...common, storeId: 'tap_slot_3', unlocked: false, cost: 150 };
    if (i === 4) return { ...common, storeId: 'tap_slot_4', unlocked: false, cost: 250 };
    return { ...common, storeId: 'tap_slot_5', unlocked: false, cost: 400 };
});

/** Interior ceiling / wall top (m). Lighting & neon use derived offsets. */
export const ROOM_CEILING_Y = 4.9;
const CEILING_NEON_Y = ROOM_CEILING_Y - 0.22;
/** Scale vs original 3.5 m room (fermenter size, procedural bio-tanks). */
const CEILING_SCALE = ROOM_CEILING_Y / 3.5;

export class World {
    constructor(scene, assets = null) {
        this.scene = scene;
        this.assets = assets || {};
        this.colliders = [];
        this.interactables = [];
        this.brewStations = [];
        /** Dedicated lager conditioning tank (premium lager only). */
        this.lagerTank = null;
        this.fermenters = Array(FERM_SLOTS.length).fill(null);
        this.kegStation = null;
        this.taps = Array(TAP_SLOTS.length).fill(null);
        /** @type {{ group: THREE.Group, t: number, duration: number }[]} */
        this._popInAnimations = [];
        this.customerSpots = [];
        /** Logical chair spots for patron AI (matches taproom table layout). */
        this.tableSeats = [];
        /** @type {{ group: THREE.Group, progressFill: THREE.Mesh, progressBg: THREE.Mesh, hopper: THREE.Object3D | null, hitbox: THREE.Mesh, position: THREE.Vector3, milledDropPosition: THREE.Vector3, millBucketRestPosition: THREE.Vector3, waitingBucket: { hitbox: THREE.Mesh, mesh: THREE.Object3D } | null } | null} */
        this.grainMillStation = null;
        /** Loose floor pickups — { hitbox, ingredientId? , ingredients? } */
        this.loosePickups = [];
        /** Milled-batch lockers — { group, slots, slotVisuals, hitboxes, index, position } */
        this.dryStorageRacks = [];
        /** Room shell meshes (floor/walls/ceil) — matrices frozen after build for fewer updates per frame. */
        this._staticEnvMeshes = [];

        this._kettleGeo = World._createKettleLatheGeometry();
        this._fg = getFurnitureGeometries();
        /** @type {THREE.MeshStandardMaterial[]|null} */
        this._neonMaterials = null;

        this._buildEnvironment();
        this._buildBrewStations();
        this._buildWortDrain();
        this._buildRecipeKiosk();
        this._buildIngredientBins();
        this._buildGrainMill();
        this._buildFermenters();
        this._buildKegStation();
        this._buildBar();
        this._buildTaps();
        this._buildCustomerSpots();
        this._buildTaproomFurniture();
        this._buildTableSeats();
        this._buildLighting();
        this._buildDecorations();

        // After all scenery is built: freeze matrices on objects tagged `_staticScenery=true`.
        // Tables, chairs, bin cabinets, decor, dry-rack bodies, etc. never move, so three.js
        // no longer needs to walk & rebuild their matrices every frame.
        this._freezeStaticScenery();
    }

    /**
     * Recursively set `matrixAutoUpdate = false` on every descendant of every group under
     * `scene.children` that is tagged `_staticScenery=true`. Build-time code tags groups
     * (and individual meshes) it knows are static. Safer than a blanket freeze — leaves
     * fermenters, progress bars, bubbles, patrons, lights, etc. untouched.
     */
    _freezeStaticScenery() {
        this.scene.updateMatrixWorld(true);
        const freeze = (obj) => {
            obj.matrixAutoUpdate = false;
            obj.updateMatrix();
            for (let i = 0, c = obj.children; i < c.length; i++) freeze(c[i]);
        };
        this.scene.traverse((o) => {
            if (o.userData && o.userData._staticScenery === true) {
                freeze(o);
            }
        });
    }

    // ─── helpers ────────────────────────────────────────────
    _addCollider(mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        this.colliders.push({ mesh, box });
    }

    _addGlbChair(template, x, z, lookAtX, lookAtZ) {
        const g = template.clone(true);
        g.position.set(x, 0, z);
        const dx = lookAtX - x;
        const dz = lookAtZ - z;
        const extra = template.userData?.chairYawExtra ?? 0;
        // glTF chairs (e.g. SheenChair) face +Z; look toward table center in XZ.
        g.rotation.y = Math.atan2(dx, dz) + extra;
        g.userData._staticScenery = true;
        this.scene.add(g);
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
        return new THREE.LatheGeometry(pts, 16);
    }

    _reactorShellMaterial() {
        const t = this.assets.textures?.metal;
        if (t) {
            return new THREE.MeshStandardMaterial({
                map: t,
                color: 0xa8b4c0,
                metalness: 0.82,
                roughness: 0.26,
                envMapIntensity: 1.2,
                emissive: 0x2a1828,
                emissiveIntensity: 0.16,
            });
        }
        return new THREE.MeshStandardMaterial({
            color: 0x8a9aaa,
            metalness: 0.88,
            roughness: 0.2,
            envMapIntensity: 1.08,
            emissive: 0x221820,
            emissiveIntensity: 0.18,
        });
    }

    _hullPanelMaterial() {
        return new THREE.MeshStandardMaterial({
            color: 0x3a3448,
            metalness: 0.38,
            roughness: 0.74,
            envMapIntensity: 0.62,
            emissive: 0x1a1028,
            emissiveIntensity: 0.1,
        });
    }

    /** Electric mint / teal accent (less cold blue than before). */
    _cyanGlowMat(intensity = 0.85) {
        return new THREE.MeshStandardMaterial({
            color: 0x5effd4,
            emissive: 0x18c9a8,
            emissiveIntensity: intensity * 1.05,
            metalness: 0.2,
            roughness: 0.4,
            toneMapped: true,
        });
    }

    _getNeonMaterials() {
        if (this._neonMaterials) return this._neonMaterials;
        const specs = [
            [0xff5eb8, 0xff0099, 1.18],
            [0xe0ff52, 0xb8e600, 1.08],
            [0xffc45c, 0xff7711, 1.05],
            [0x5dfff0, 0x00ddcc, 0.95],
        ];
        this._neonMaterials = specs.map(([c, e, i]) =>
            new THREE.MeshStandardMaterial({
                color: c,
                emissive: e,
                emissiveIntensity: i,
                metalness: 0.16,
                roughness: 0.24,
                toneMapped: true,
            })
        );
        return this._neonMaterials;
    }

    _neonAt(i) {
        const a = this._getNeonMaterials();
        return a[((i % a.length) + a.length) % a.length];
    }

    _alloyTableMaterial() {
        return new THREE.MeshStandardMaterial({
            color: 0x4a5a6e,
            metalness: 0.72,
            roughness: 0.38,
            envMapIntensity: 0.95,
            emissive: 0x081018,
            emissiveIntensity: 0.05,
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
        return this._alloyTableMaterial();
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
        this._getNeonMaterials();

        const RW = 34, RD = 46; // bounding box (brewery side rectangular, taproom side rounded)
        const HW = RW / 2, HD = RD / 2;

        /**
         * Dividing wall sits at z = DIVIDER_Z; brewery is north of it (−z), taproom south (+z).
         * The horseshoe bar (see `BAR`) opens north, so the bartender walks
         * brewery → pass-through in divider → into the horseshoe opening.
         */
        const DIVIDER_Z = 0;
        /** Half-ellipse taproom wall: x = rx·cos t, z = DIVIDER_Z + rz·sin t, t ∈ [0, π]. */
        const TAP_RX = HW - 1.0;        // 16 m (fits inside RW bounds)
        const TAP_RZ = HD - 1.0;        // 22 m (apex reaches south entrance)
        /** Cached for runtime queries (fog / lighting placements). */
        this._taproom = {
            dividerZ: DIVIDER_Z,
            ellipseCx: 0,
            ellipseCz: DIVIDER_Z,
            ellipseRx: TAP_RX,
            ellipseRz: TAP_RZ,
        };

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(RW, RD),
            new THREE.MeshStandardMaterial({
                color: 0x2a2834,
                roughness: 0.82,
                metalness: 0.42,
                envMapIntensity: 0.72,
                emissive: 0x120818,
                emissiveIntensity: 0.07,
            })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);
        this._staticEnvMeshes.push(floor);

        const ceil = new THREE.Mesh(
            new THREE.PlaneGeometry(RW, RD),
            new THREE.MeshBasicMaterial({ color: 0x2a2438 })
        );
        ceil.rotation.x = Math.PI / 2;
        ceil.position.y = ROOM_CEILING_Y;
        this.scene.add(ceil);
        this._staticEnvMeshes.push(ceil);

        const wm = this._hullPanelMaterial();

        // Walls (thin boxes) + ability to rotate around Y.
        const wallH = ROOM_CEILING_Y;
        /**
         * @param {number} cx @param {number} cz @param {number} w @param {number} d
         * @param {number} [yaw] @param {boolean} [addCollider]
         */
        const makeWall = (cx, cz, w, d, yaw = 0, addCollider = true) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wm);
            m.position.set(cx, wallH / 2, cz);
            m.rotation.y = yaw;
            m.castShadow = false;
            m.receiveShadow = true;
            this.scene.add(m);
            this._staticEnvMeshes.push(m);
            if (addCollider) this._addCollider(m);
        };

        // North wall (back of brewery).
        makeWall(0, -HD, RW, 0.3);

        // Brewery-side east / west walls (only cover north half, z ∈ [-HD, DIVIDER_Z]).
        const brewWallLen = DIVIDER_Z - (-HD);
        const brewWallCz = (-HD + DIVIDER_Z) * 0.5;
        makeWall(HW, brewWallCz, 0.3, brewWallLen);
        makeWall(-HW, brewWallCz, 0.3, brewWallLen);

        // Dividing wall — splits brewery from taproom (pass-through in middle for the bartender).
        const DIV_GAP = 5.6; // clear opening, aligns with horseshoe inner opening
        const divHalfW = (RW - DIV_GAP) * 0.5;
        makeWall(-(DIV_GAP * 0.5 + divHalfW * 0.5), DIVIDER_Z, divHalfW, 0.3);
        makeWall(+(DIV_GAP * 0.5 + divHalfW * 0.5), DIVIDER_Z, divHalfW, 0.3);

        // Door-frame accents on the pass-through.
        const frameMat = new THREE.MeshStandardMaterial({
            color: 0x2a2030,
            emissive: 0x5effd4,
            emissiveIntensity: 0.22,
            metalness: 0.6,
            roughness: 0.4,
        });
        const makeFrame = (x, z) => {
            const f = new THREE.Mesh(new THREE.BoxGeometry(0.22, wallH - 0.4, 0.22), frameMat);
            f.position.set(x, (wallH - 0.4) * 0.5, z);
            f.userData._staticScenery = true;
            this.scene.add(f);
        };
        makeFrame(-DIV_GAP * 0.5 + 0.12, DIVIDER_Z);
        makeFrame(+DIV_GAP * 0.5 - 0.12, DIVIDER_Z);
        const lintel = new THREE.Mesh(
            new THREE.BoxGeometry(DIV_GAP + 0.4, 0.22, 0.22),
            frameMat
        );
        lintel.position.set(0, wallH - 0.35, DIVIDER_Z);
        lintel.userData._staticScenery = true;
        this.scene.add(lintel);

        // Curved taproom outer wall — half-ellipse arc with an entrance gap at the south apex.
        const ARC_SEGMENTS = 46;
        /** Gap around t = π/2 (apex) for the main south entrance. */
        const ENTRANCE_GAP_HALF = 0.06; // ±6% of arc (~ the original 3 m opening)
        for (let i = 0; i < ARC_SEGMENTS; i++) {
            const t0 = Math.PI * (i / ARC_SEGMENTS);
            const t1 = Math.PI * ((i + 1) / ARC_SEGMENTS);
            const tMid = (t0 + t1) * 0.5;
            const tFrac = tMid / Math.PI;
            if (Math.abs(tFrac - 0.5) < ENTRANCE_GAP_HALF) continue;
            const x0 = TAP_RX * Math.cos(t0);
            const z0 = DIVIDER_Z + TAP_RZ * Math.sin(t0);
            const x1 = TAP_RX * Math.cos(t1);
            const z1 = DIVIDER_Z + TAP_RZ * Math.sin(t1);
            const cx = (x0 + x1) * 0.5;
            const cz = (z0 + z1) * 0.5;
            const dx = x1 - x0;
            const dz = z1 - z0;
            const len = Math.hypot(dx, dz);
            const yaw = Math.atan2(-dz, dx); // align local +X with segment direction
            makeWall(cx, cz, len + 0.04, 0.3, yaw);
        }

        // Short return walls on either side of the south entrance — mask the curved gap
        // from behind & give the doorway a "wall thickness" feel.
        const entranceFrameMat = wm;
        const entreturnW = 0.35;
        const entreturnD = 1.6;
        const entreturnX = 1.9;
        const entreturnCz = DIVIDER_Z + TAP_RZ - 0.2;
        const eFrameL = new THREE.Mesh(new THREE.BoxGeometry(entreturnW, wallH, entreturnD), entranceFrameMat);
        eFrameL.position.set(-entreturnX, wallH / 2, entreturnCz);
        this.scene.add(eFrameL);
        this._staticEnvMeshes.push(eFrameL);
        this._addCollider(eFrameL);
        const eFrameR = new THREE.Mesh(new THREE.BoxGeometry(entreturnW, wallH, entreturnD), entranceFrameMat);
        eFrameR.position.set(entreturnX, wallH / 2, entreturnCz);
        this.scene.add(eFrameR);
        this._staticEnvMeshes.push(eFrameR);
        this._addCollider(eFrameR);

        const brewTex = this.assets.textures?.breweryFloor;
        const bfMat = brewTex
            ? new THREE.MeshStandardMaterial({
                map: brewTex,
                color: 0x8a9e98,
                roughness: 0.55,
                metalness: 0.26,
                envMapIntensity: 0.82,
                emissive: 0x081820,
                emissiveIntensity: 0.08,
            })
            : new THREE.MeshStandardMaterial({
                color: 0x3a4548,
                roughness: 0.5,
                metalness: 0.48,
                envMapIntensity: 0.68,
                emissive: 0x0a1820,
                emissiveIntensity: 0.09,
            });
        // Brewery floor runs from the north wall (z = −HD) up to the dividing wall (z = DIVIDER_Z).
        const brewFloorD = DIVIDER_Z - (-HD) - 0.3;
        const brewFloorCz = (-HD + DIVIDER_Z) * 0.5;
        const bf = new THREE.Mesh(new THREE.PlaneGeometry(RW - 1, brewFloorD), bfMat);
        bf.rotation.x = -Math.PI / 2;
        bf.position.set(0, 0.005, brewFloorCz);
        bf.receiveShadow = true;
        this.scene.add(bf);
        this._staticEnvMeshes.push(bf);

        const woodTex = this.assets.textures?.woodFloor;
        const tfMat = woodTex
            ? new THREE.MeshStandardMaterial({
                map: woodTex,
                color: 0x7a7568,
                roughness: 0.62,
                metalness: 0.2,
                envMapIntensity: 0.62,
                emissive: 0x10100a,
                emissiveIntensity: 0.06,
            })
            : new THREE.MeshStandardMaterial({
                color: 0x38342e,
                roughness: 0.66,
                metalness: 0.32,
                envMapIntensity: 0.55,
                emissive: 0x121008,
                emissiveIntensity: 0.07,
            });
        // Half-ellipse taproom floor — one fan-of-triangles plane, so the wood texture
        // actually matches the taproom's footprint (rectangular plane used to hang past
        // the curved wall visually).
        const tf = this._buildHalfEllipseFloor(TAP_RX - 0.05, TAP_RZ - 0.05, DIVIDER_Z, tfMat);
        tf.receiveShadow = true;
        this.scene.add(tf);
        this._staticEnvMeshes.push(tf);

        for (const m of this._staticEnvMeshes) {
            m.updateMatrix();
            m.matrixAutoUpdate = false;
        }
    }

    /**
     * Fan-triangulate a half ellipse (centered at `cz`, on +Z half) into a single flat mesh.
     * Positioned at y = 0.005 so it overlays the neutral floor without z-fighting the walls.
     */
    _buildHalfEllipseFloor(rx, rz, cz, material) {
        const SEG = 48;
        const positions = [];
        const uvs = [];
        const indices = [];

        // Center vertex (at the straight edge midpoint).
        positions.push(0, 0, cz);
        uvs.push(0.5, 0.0);

        for (let i = 0; i <= SEG; i++) {
            const t = Math.PI * (i / SEG);
            const x = rx * Math.cos(t);
            const z = cz + rz * Math.sin(t);
            positions.push(x, 0, z);
            // UV: tile at 1/2 m per unit so wood grain keeps its scale on the large floor.
            uvs.push((x + rx) / (rx * 2), (z - cz) / rz);
        }
        for (let i = 1; i <= SEG; i++) {
            indices.push(0, i, i + 1);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.position.y = 0.005;
        return mesh;
    }

    // ─── brew stations ──────────────────────────────────────
    _buildBrewStations() {
        BREW_SLOTS.forEach((slot, index) => {
            const pos = new THREE.Vector3(slot.x, 0, slot.z);
            const group = new THREE.Group();
            group.position.copy(pos);

            const mashTpl = this.assets?.mashTunTemplate;
            /** @type {THREE.Object3D} */
            let kettle;
            if (mashTpl) {
                const mash = mashTpl.clone(true);
                mash.traverse((o) => {
                    if (o.isMesh) {
                        o.castShadow = false;
                        o.receiveShadow = true;
                    }
                });
                mash.updateMatrixWorld(true);
                const b0 = new THREE.Box3().setFromObject(mash);
                const h0 = b0.max.y - b0.min.y;
                const targetH = 2.48;
                const sc = targetH / Math.max(0.001, h0);
                mash.scale.setScalar(sc);
                mash.updateMatrixWorld(true);
                const b1 = new THREE.Box3().setFromObject(mash);
                mash.position.set(
                    -(b1.min.x + b1.max.x) * 0.5,
                    -b1.min.y,
                    -(b1.min.z + b1.max.z) * 0.5
                );
                group.add(mash);
                kettle = mash;
            } else {
                const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1, 2), this._hullPanelMaterial());
                base.position.y = 0.5;
                group.add(base);

                const reactor = this._reactorShellMaterial();
                const k = new THREE.Mesh(this._kettleGeo, reactor);
                k.position.y = 1.02;
                k.castShadow = false;
                k.geometry.userData.shared = true;
                group.add(k);

                const ringGlow = new THREE.Mesh(
                    new THREE.TorusGeometry(0.72, 0.04, 8, 32),
                    this._neonAt(index)
                );
                ringGlow.rotation.x = Math.PI / 2;
                ringGlow.position.y = 1.35;
                group.add(ringGlow);

                const lid = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.3, 0.65, 0.14, 12),
                    reactor
                );
                lid.position.y = 2.52;
                group.add(lid);

                const lidRing = new THREE.Mesh(
                    new THREE.TorusGeometry(0.5, 0.03, 6, 24),
                    this._cyanGlowMat(0.52)
                );
                lidRing.rotation.x = Math.PI / 2;
                lidRing.position.y = 2.52;
                group.add(lidRing);
                kettle = k;
            }

            const label = this._textSprite('Mash Tun', 0xffc8f0);
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
                    color: 0x7dffe8,
                    transparent: true,
                    opacity: 0.7,
                    roughness: 0.1,
                    metalness: 0.12,
                    envMapIntensity: 0.72,
                    emissive: 0x20aa88,
                    emissiveIntensity: 0.42,
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
                milledIngredients: null,
                batchValid: true,
                unlocked: slot.unlocked, cost: slot.cost
            });
        });
    }

    /** Floor drain in the brewery zone — dump unwanted wort (E). */
    _buildWortDrain() {
        const x = 0;
        const z = -17;
        const y = 0.018;

        const group = new THREE.Group();
        group.position.set(x, y, z);

        const rim = new THREE.Mesh(
            new THREE.TorusGeometry(0.52, 0.055, 10, 28),
            this._stainlessMaterial()
        );
        rim.rotation.x = Math.PI / 2;
        group.add(rim);

        const pit = new THREE.Mesh(
            new THREE.CircleGeometry(0.4, 28),
            new THREE.MeshStandardMaterial({
                color: 0x06090e,
                roughness: 0.92,
                metalness: 0.35,
                emissive: 0x020305,
                emissiveIntensity: 0.06,
            })
        );
        pit.rotation.x = -Math.PI / 2;
        pit.position.y = -0.004;
        group.add(pit);

        const barMat = this._stainlessMaterial();
        for (let i = 0; i < 3; i++) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.88), barMat);
            bar.position.y = 0.012;
            bar.rotation.y = (i / 3) * Math.PI;
            group.add(bar);
        }

        const label = this._textSprite('WORT DRAIN', 0xffcc88, 0.42);
        label.position.set(0, 0.55, 0);
        group.add(label);

        this.scene.add(group);

        const hitbox = new THREE.Mesh(
            new THREE.CylinderGeometry(0.7, 0.75, 0.45, 12),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.set(x, 0.28, z);
        hitbox.userData = { type: 'wortDrain' };
        this.scene.add(hitbox);
        this.interactables.push(hitbox);
        this._addCollider(hitbox);
    }

    /** Buy beer recipe unlocks — cravings only pull from owned recipes. */
    _buildRecipeKiosk() {
        // Open floor near north wall (z ≈ -23); back faces the wall, front toward the brewery.
        const pos = new THREE.Vector3(9.35, 0, -21.05);
        const group = new THREE.Group();
        group.position.copy(pos);

        const tmpl = this.assets?.recipeTerminalTemplate;
        let hitCx = pos.x;
        let hitCy = pos.y + 1.1;
        let hitCz = pos.z;
        let hitW = 1.8;
        let hitH = 2.2;
        let hitD = 1.1;

        if (tmpl) {
            const term = tmpl.clone(true);
            term.traverse((o) => {
                if (o.isMesh) {
                    o.castShadow = false;
                    o.receiveShadow = true;
                }
            });
            // Terminal native front faces +X; rotate −π/2 so the screen looks toward the player
            // spawn south of it (world +Z).
            term.rotation.y = -Math.PI / 2;
            term.updateMatrixWorld(true);
            const b0 = new THREE.Box3().setFromObject(term);
            const h0 = b0.max.y - b0.min.y;
            const targetH = 2.08 * (5 / 8);
            const s = targetH / Math.max(0.001, h0);
            term.scale.setScalar(s);
            term.updateMatrixWorld(true);
            const b1 = new THREE.Box3().setFromObject(term);
            term.position.set(
                -(b1.min.x + b1.max.x) * 0.5,
                -b1.min.y,
                -(b1.min.z + b1.max.z) * 0.5
            );
            group.add(term);

            group.updateMatrixWorld(true);
            const bb = new THREE.Box3().setFromObject(term);
            const title = this._textSprite('STORE', 0x66eecc, 0.46);
            const wp = new THREE.Vector3(
                (bb.min.x + bb.max.x) * 0.5,
                bb.max.y + 0.2,
                (bb.min.z + bb.max.z) * 0.5
            );
            const lp = wp.clone();
            group.worldToLocal(lp);
            title.position.copy(lp);
            group.add(title);

            const pad = 0.12;
            hitW = Math.max(1.05, bb.max.x - bb.min.x + pad);
            hitH = Math.max(1.75, bb.max.y - bb.min.y + pad);
            hitD = Math.max(0.75, bb.max.z - bb.min.z + pad);
            hitCx = (bb.min.x + bb.max.x) * 0.5;
            hitCy = (bb.min.y + bb.max.y) * 0.5;
            hitCz = (bb.min.z + bb.max.z) * 0.5;
        } else {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(1.15, 1.2, 0.7),
                this._mat(0x2a3848, { rough: 0.78, metal: 0.35 })
            );
            body.position.y = 0.6;
            group.add(body);

            const screen = new THREE.Mesh(
                new THREE.PlaneGeometry(0.85, 0.55),
                new THREE.MeshStandardMaterial({
                    color: 0x0a1628,
                    emissive: 0x113322,
                    emissiveIntensity: 0.35,
                    roughness: 0.4,
                    metalness: 0.2,
                })
            );
            screen.position.set(0, 1.05, 0.36);
            group.add(screen);

            const title = this._textSprite('STORE', 0x66eecc, 0.5);
            title.position.set(0, 1.62, 0.38);
            group.add(title);
        }

        this.scene.add(group);

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(hitW, hitH, hitD),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.set(hitCx, hitCy, hitCz);
        hitbox.userData = { type: 'recipeShop' };
        this.scene.add(hitbox);
        this.interactables.push(hitbox);
        this._addCollider(hitbox);
    }

    _buildIngredientBins() {
        // Along east wall (+X), like the storage row by the old mill — keeps the brew aisle clear.
        const wallInsetX = 15.15;
        const zStart = -21;
        const zStep = 2;
        const y = 0.35;
        INGREDIENTS.forEach((ing, i) => {
            const x = wallInsetX;
            const z = zStart + i * zStep;
            const group = new THREE.Group();
            group.position.set(x, 0, z);

            const bin = new THREE.Mesh(
                new THREE.BoxGeometry(1.15, 0.55, 1.15),
                this._mat(ing.color, { rough: 0.75, metal: 0.2 })
            );
            bin.position.y = 0.28;
            group.add(bin);

            const rim = new THREE.Mesh(
                new THREE.BoxGeometry(1.25, 0.08, 1.25),
                this._stainlessMaterial()
            );
            rim.position.y = 0.58;
            group.add(rim);

            const label = this._textSprite(ing.name.split(' ')[0], 0xffffff, 0.55);
            label.position.y = 1.05;
            group.add(label);

            this.scene.add(group);

            const hitbox = new THREE.Mesh(
                new THREE.BoxGeometry(1.4, 1.2, 1.4),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            hitbox.position.set(x, y, z);
            hitbox.userData = { type: 'ingredientBin', ingredientId: ing.id };
            this.scene.add(hitbox);
            this.interactables.push(hitbox);
            this._addCollider(hitbox);
        });

        // Purchased bucket spawns here — open floor west of the first bin (Pale malt row).
        this.grainBucketFloorPosition = new THREE.Vector3(wallInsetX - 2.85, 0, zStart);
    }

    _buildGrainMill() {
        // Brewery zone: north of the wort drain (z = -17), near Reactor 1 (-7,-19).
        const pos = new THREE.Vector3(0, 0, -21);
        const group = new THREE.Group();
        group.position.copy(pos);
        // Arcade cabinet native front is along +X; rotate −π/2 so the screen faces the player
        // spawn south of it (world +Z).
        group.rotation.y = -Math.PI / 2;

        const millTpl = this.assets?.grainMillTemplate;
        /** @type {THREE.Object3D | null} */
        let hopper = null;

        if (millTpl) {
            const model = millTpl.clone(true);
            group.add(model);
            model.traverse((o) => {
                if (o.isMesh && typeof o.name === 'string') {
                    const n = o.name.toLowerCase();
                    if (/hopper|drum|roller|wheel/.test(n) && !hopper) {
                        hopper = o;
                    }
                }
            });
            if (!hopper) {
                model.traverse((o) => {
                    if (o.isMesh && !hopper) hopper = o;
                });
            }
        } else {
            const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 1.6), this._hullPanelMaterial());
            base.position.y = 0.42;
            group.add(base);

            const hopperMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.55, 0.75, 1.1, 12),
                this._stainlessMaterial()
            );
            hopperMesh.position.y = 1.35;
            group.add(hopperMesh);
            hopper = hopperMesh;

            const chute = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.35, 0.6),
                this._mat(0x555566, { metal: 0.5 })
            );
            chute.position.set(0.9, 0.55, 0);
            group.add(chute);
        }

        const title = this._textSprite('GRAIN MILL', 0xffe8a8, 0.65);
        title.position.y = millTpl ? 1.85 : 2.15;
        group.add(title);

        const progressBg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), this._mat(0x333333));
        progressBg.position.set(0, millTpl ? 1.68 : 1.95, 0.95);
        group.add(progressBg);

        const progressFill = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.09, 0.09),
            new THREE.MeshStandardMaterial({ color: 0x44aa88, emissive: 0x224422 })
        );
        progressFill.position.copy(progressBg.position);
        progressFill.scale.x = 0;
        progressFill.visible = false;
        group.add(progressFill);

        this.scene.add(group);

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(2.4, 2.2, 1.8),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.set(pos.x, 1.1, pos.z);
        hitbox.userData = { type: 'grainMill' };
        this.scene.add(hitbox);
        this.interactables.push(hitbox);
        this._addCollider(hitbox);

        /** Floor spot in front of the chute where finished grist appears (world space). */
        const milledDropPosition = new THREE.Vector3(pos.x + 1.65, 0, pos.z);
        /** Bucket sits here while the mill runs after a full-bucket dump. */
        const millBucketRestPosition = new THREE.Vector3(pos.x + 1.12, 0, pos.z + 0.62);

        this.grainMillStation = {
            group,
            hopper,
            progressFill,
            progressBg,
            hitbox,
            position: pos.clone(),
            milledDropPosition,
            millBucketRestPosition,
            waitingBucket: null,
        };
    }

    /**
     * Places an empty bucket in front of the mill while milling (locked until the batch finishes).
     * @param {THREE.Object3D | null} template
     */
    placeGrainMillBucketForMilling(template) {
        const st = this.grainMillStation;
        if (!st?.millBucketRestPosition) return;
        this.clearGrainMillWaitingBucket();
        const rec = this.spawnGrainBucketLoose(
            template,
            st.millBucketRestPosition.clone(),
            [null, null, null],
            { millLocked: true, milled: false }
        );
        st.waitingBucket = rec;
    }

    /** Removes the mill’s “waiting” bucket (e.g. reset / new game). */
    clearGrainMillWaitingBucket() {
        const st = this.grainMillStation;
        const wb = st?.waitingBucket;
        if (wb?.hitbox) {
            this.removeLoosePickup(wb.hitbox);
        }
        if (st) st.waitingBucket = null;
    }

    /**
     * Fills the bucket that was placed at the mill with milled grist; returns false if there was no waiting bucket.
     * @param {string[]} ingredients
     */
    completeGrainMillBucketFill(ingredients) {
        const st = this.grainMillStation;
        const wb = st?.waitingBucket;
        if (!wb?.mesh || !wb.hitbox) return false;
        applyBucketGristFill(wb.mesh, ingredients);
        wb.hitbox.userData.ingredientIds = [...ingredients];
        wb.hitbox.userData.millLocked = false;
        wb.hitbox.userData.milled = true;
        st.waitingBucket = null;
        return true;
    }

    /**
     * Spawn purchased bucket on the floor (pick up with [E]). Pass ingredient state for [Q] drops.
     * @param {THREE.Object3D | null} template
     * @param {{ x: number, z: number }} position
     * @param {[string|null, string|null, string|null] | null} ingredientIds
     */
    /**
     * @param {{ millLocked?: boolean, milled?: boolean }} [opts]
     */
    spawnGrainBucketLoose(template, position, ingredientIds = null, opts = {}) {
        const { millLocked = false, milled = false } = opts;
        const ids =
            ingredientIds?.length === 3
                ? [ingredientIds[0] ?? null, ingredientIds[1] ?? null, ingredientIds[2] ?? null]
                : [null, null, null];

        let visual;
        if (template) {
            visual = template.clone(true);
        } else {
            const g = new THREE.Group();
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.2, 0.34, 12),
                this._mat(0x6a8a6a, { rough: 0.78, metal: 0.15 })
            );
            body.position.y = 0.17;
            g.add(body);
            const rim = new THREE.Mesh(
                new THREE.TorusGeometry(0.23, 0.025, 6, 20),
                this._stainlessMaterial()
            );
            rim.rotation.x = Math.PI / 2;
            rim.position.y = 0.34;
            g.add(rim);
            visual = g;
        }

        visual.position.set(position.x, 0, position.z);
        visual.updateMatrixWorld(true);
        applyBucketGristFill(visual, ids);
        this.scene.add(visual);

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.65, 0.7),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.set(position.x, 0.32, position.z);
        hitbox.userData = {
            type: 'looseGrainBucket',
            ingredientIds: ids,
            mesh: visual,
            millLocked,
            milled,
        };
        this.scene.add(hitbox);
        this.interactables.push(hitbox);
        this._addCollider(hitbox);
        const rec = { hitbox, mesh: visual };
        this.loosePickups.push(rec);
        return rec;
    }

    /**
     * After load or purchase: one floor bucket if the player owns it and is not already holding it.
     */
    syncOwnedStorePickups(gameState, assetBucket) {
        const owned = gameState.ownedObjectIds || [];
        if (!owned.includes('grainBucket')) return;

        const carrying = gameState.player.carrying?.type === 'bucket';
        const hasLoose = this.interactables.some((i) => i.userData?.type === 'looseGrainBucket');
        if (carrying || hasLoose) return;

        const pos = this.grainBucketFloorPosition || new THREE.Vector3(12.3, 0, -21);
        this.spawnGrainBucketLoose(assetBucket?.grainBucketTemplate ?? null, pos, [null, null, null]);
    }

    /**
     * Drop a single ingredient on the floor (player Q or mill overflow).
     */
    spawnIngredientLoose(ingredientId, position) {
        const ing = getIngredientById(ingredientId);
        if (!ing) return null;

        const visual = createIngredientFloorVisual(ing.id);
        visual.position.set(position.x, 0, position.z);
        this.scene.add(visual);

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.55, 0.55),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.set(position.x, 0.28, position.z);
        hitbox.userData = { type: 'looseIngredient', ingredientId: ing.id, mesh: visual };
        this.scene.add(hitbox);
        this.interactables.push(hitbox);
        this._addCollider(hitbox);
        const rec = { hitbox, mesh: visual };
        this.loosePickups.push(rec);
        return rec;
    }

    /**
     * Milled batch sack on the floor.
     */
    spawnMilledBatchLoose(ingredients, position) {
        const visual = createMilledGristFloorVisual();
        visual.position.set(position.x, 0, position.z);
        this.scene.add(visual);

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(0.65, 0.55, 0.65),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.set(position.x, 0.28, position.z);
        hitbox.userData = {
            type: 'looseMilledBatch',
            ingredients: [...ingredients],
            mesh: visual,
        };
        this.scene.add(hitbox);
        this.interactables.push(hitbox);
        this._addCollider(hitbox);
        const rec = { hitbox, mesh: visual };
        this.loosePickups.push(rec);
        return rec;
    }

    removeLoosePickup(hitbox) {
        const ud = hitbox.userData;
        const mesh = ud.mesh;
        if (mesh) {
            if (typeof mesh.userData?.disposeIngredientVisual === 'function') {
                mesh.userData.disposeIngredientVisual();
            } else {
                mesh.traverse?.((o) => {
                    o.geometry?.dispose?.();
                    const mats = Array.isArray(o.material) ? o.material : [o.material];
                    for (const m of mats) {
                        if (m?.map) m.map.dispose?.();
                        m?.dispose?.();
                    }
                });
            }
            this.scene.remove(mesh);
        }

        this.scene.remove(hitbox);
        hitbox.geometry?.dispose?.();
        hitbox.material?.dispose?.();

        const ix = this.interactables.indexOf(hitbox);
        if (ix >= 0) this.interactables.splice(ix, 1);
        const lix = this.loosePickups.findIndex((p) => p.hitbox === hitbox);
        if (lix >= 0) this.loosePickups.splice(lix, 1);

        const cix = this.colliders.findIndex((c) => c.mesh === hitbox);
        if (cix >= 0) this.colliders.splice(cix, 1);
    }

    clearLoosePickups() {
        const looseTypes = new Set(['looseIngredient', 'looseMilledBatch', 'looseGrainBucket']);
        const toRemove = this.interactables.filter((o) => looseTypes.has(o.userData?.type));
        toRemove.forEach((hitbox) => this.removeLoosePickup(hitbox));
    }

    /** Keep glTF materials and textures; only mesh flags (and needsUpdate for materials). */
    _prepGltfModelForWorld(root) {
        root.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = false;
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (m) m.needsUpdate = true;
            }
        });
    }

    // ─── fermenters ─────────────────────────────────────────
    _buildFermenters() {
        FERM_SLOTS.forEach((slot, index) => {
            if (!slot.starter) return;
            this._createFermenterAtIndex(index);
        });
    }

    /**
     * Builds a bio-tank at slot index (starter or purchased from supply terminal).
     * If `placement` is supplied (post-PlacementSystem purchases / loaded saves) its
     * (x, z, yaw) override the default slot position so the player can choose where
     * the new tank sits.
     *
     * @param {number} index
     * @param {boolean} [popIn]
     * @param {{x:number,z:number,yaw?:number}|null} [placement]
     */
    _createFermenterAtIndex(index, popIn = false, placement = null) {
        const fermGltfRoot = this.assets?.beerFermenterTemplate;
        const FERM_GLTF_H = 3.08 * CEILING_SCALE;
        const _wtl = (group, wx, wy, wz) => {
            const v = new THREE.Vector3(wx, wy, wz);
            group.worldToLocal(v);
            return v;
        };

        const slot = FERM_SLOTS[index];
            const posX = placement?.x ?? slot.x;
            const posZ = placement?.z ?? slot.z;
            const yaw = placement?.yaw ?? 0;
            const pos = new THREE.Vector3(posX, 0, posZ);
            const group = new THREE.Group();
            group.position.copy(pos);
            group.rotation.y = yaw;

            let tank;
            let liquid;
            let liquidRestY = 1.5;
            let bubbleSpawnWorldY = pos.y + 3.1;
            let hitW = 1.5;
            let hitH = 3.5;
            let hitD = 1.5;
            let hitCx = pos.x;
            let hitCy = pos.y + 1.75;
            let hitCz = pos.z;

            if (fermGltfRoot) {
                const fermModel = fermGltfRoot.clone(true);
                this._prepGltfModelForWorld(fermModel);
                fermModel.updateMatrixWorld(true);
                const b0 = new THREE.Box3().setFromObject(fermModel);
                const h0 = b0.max.y - b0.min.y;
                const s = FERM_GLTF_H / Math.max(0.001, h0);
                fermModel.scale.setScalar(s);
                fermModel.updateMatrixWorld(true);
                const b1 = new THREE.Box3().setFromObject(fermModel);
                fermModel.position.set(
                    -(b1.min.x + b1.max.x) * 0.5,
                    -b1.min.y,
                    -(b1.min.z + b1.max.z) * 0.5
                );
                group.add(fermModel);
                tank = fermModel;

                group.updateMatrixWorld(true);
                const bb = new THREE.Box3().setFromObject(fermModel);
                const spanY = bb.max.y - bb.min.y;
                const spanXZ = Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
                const cylH = spanY * 0.52;
                const cylR = spanXZ * 0.18;
                const liqCy = bb.min.y + spanY * 0.46;
                const liqCx = (bb.min.x + bb.max.x) * 0.5;
                const liqCz = (bb.min.z + bb.max.z) * 0.5;

                liquid = new THREE.Mesh(
                    new THREE.CylinderGeometry(cylR, cylR, cylH, 14),
                    new THREE.MeshStandardMaterial({
                        color: 0x66ffd8,
                        transparent: true,
                        opacity: 0.5,
                        emissive: 0x228866,
                        emissiveIntensity: 0.32,
                    })
                );
                liquid.position.copy(_wtl(group, liqCx, liqCy, liqCz));
                liquid.visible = false;
                group.add(liquid);
                liquidRestY = liquid.position.y;
                bubbleSpawnWorldY = bb.max.y - 0.12;

                const gauge = new THREE.Mesh(
                    new THREE.SphereGeometry(0.12, 8, 8),
                    new THREE.MeshStandardMaterial({
                        color: 0xffee88,
                        emissive: 0xcc8800,
                        emissiveIntensity: 0.72,
                    })
                );
                gauge.position.copy(
                    _wtl(
                        group,
                        bb.max.x + 0.08,
                        bb.min.y + spanY * 0.58,
                        (bb.min.z + bb.max.z) * 0.5
                    )
                );
                group.add(gauge);

                const label = this._textSprite(`Bio-Tank ${index + 1}`, 0xffddff);
                label.position.copy(
                    _wtl(group, (bb.min.x + bb.max.x) * 0.5, bb.max.y + 0.38, (bb.min.z + bb.max.z) * 0.5)
                );
                group.add(label);

                const progressBg = new THREE.Mesh(
                    new THREE.BoxGeometry(1.5, 0.12, 0.12),
                    this._mat(0x333333)
                );
                progressBg.position.copy(
                    _wtl(
                        group,
                        (bb.min.x + bb.max.x) * 0.5,
                        bb.max.y + 0.2,
                        (bb.min.z + bb.max.z) * 0.5 + 0.38
                    )
                );
                group.add(progressBg);

                const progressFill = new THREE.Mesh(
                    new THREE.BoxGeometry(1.5, 0.1, 0.1),
                    new THREE.MeshStandardMaterial({ color: 0xdd8800, emissive: 0x442200 })
                );
                progressFill.position.copy(progressBg.position);
                progressFill.scale.x = 0;
                progressFill.visible = false;
                group.add(progressFill);

                group.updateMatrixWorld(true);
                const bbHit = new THREE.Box3().setFromObject(fermModel);
                hitW = Math.max(1.3, (bbHit.max.x - bbHit.min.x) * 1.1);
                hitH = Math.max(2.35, (bbHit.max.y - bbHit.min.y) * 1.08);
                hitD = Math.max(1.3, (bbHit.max.z - bbHit.min.z) * 1.1);
                hitCx = (bbHit.min.x + bbHit.max.x) * 0.5;
                hitCy = (bbHit.min.y + bbHit.max.y) * 0.5;
                hitCz = (bbHit.min.z + bbHit.max.z) * 0.5;

                const lockOverlay = null;
                const lockLabel = null;

                this.scene.add(group);

                const hitbox = new THREE.Mesh(
                    new THREE.BoxGeometry(hitW, hitH, hitD),
                    new THREE.MeshBasicMaterial({ visible: false })
                );
                hitbox.position.set(hitCx, hitCy, hitCz);
                hitbox.userData = { type: 'fermenter', index };
                this.scene.add(hitbox);
                this.interactables.push(hitbox);
                this._addCollider(hitbox);

                this.fermenters[index] = {
                    group,
                    tank,
                    liquid,
                    gauge,
                    progressFill,
                    progressBg,
                    label,
                    lockOverlay,
                    lockLabel,
                    position: pos,
                    state: 'empty',
                    recipe: null,
                    progress: 0,
                    duration: 0,
                    speed: 1.0,
                    bubbles: [],
                    batchValid: true,
                    unlocked: true,
                    cost: slot.cost,
                    liquidRestY,
                    bubbleSpawnWorldY,
                };
            } else {
                const fs = CEILING_SCALE;
                const steel = this._stainlessMaterial();
                const tankMat = steel.clone();
                tankMat.color?.setHex?.(0x8899aa);
                tankMat.emissive?.setHex?.(0x040810);
                tankMat.emissiveIntensity = 0.08;
                tank = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.6 * fs, 0.6 * fs, 2.5 * fs, 14),
                    tankMat
                );
                tank.position.y = 0.5 + (2.5 * fs) / 2;
                group.add(tank);

                for (let i = 0; i < 4; i++) {
                    const a = (i / 4) * Math.PI * 2;
                    const strip = new THREE.Mesh(
                        new THREE.BoxGeometry(0.06, 2.35 * fs, 0.04),
                        this._neonAt(index + i)
                    );
                    strip.position.set(
                        Math.cos(a) * 0.61 * fs,
                        1.75 * fs,
                        Math.sin(a) * 0.61 * fs
                    );
                    strip.lookAt(
                        new THREE.Vector3(Math.cos(a) * 2, 1.75 * fs, Math.sin(a) * 2)
                    );
                    group.add(strip);
                }

                [0.55, 1.35, 2.15].forEach((y, ri) => {
                    const ring = new THREE.Mesh(
                        new THREE.TorusGeometry(0.62 * fs, 0.028 * fs, 6, 28),
                        this._neonAt(index + ri + 1)
                    );
                    ring.rotation.x = Math.PI / 2;
                    ring.position.set(0, y * fs, 0);
                    group.add(ring);
                });

                const cone = new THREE.Mesh(new THREE.ConeGeometry(0.6 * fs, 0.5 * fs, 12), steel);
                cone.position.y = 0.25 * fs;
                cone.rotation.x = Math.PI;
                group.add(cone);

                const dome = new THREE.Mesh(
                    new THREE.SphereGeometry(0.6 * fs, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
                    this._stainlessMaterial()
                );
                dome.position.y = 3 * fs;
                group.add(dome);

                const gauge = new THREE.Mesh(
                    new THREE.SphereGeometry(0.12 * fs, 8, 8),
                    new THREE.MeshStandardMaterial({
                        color: 0xffee88,
                        emissive: 0xcc8800,
                        emissiveIntensity: 0.72,
                    })
                );
                gauge.position.set(0.65 * fs, 2 * fs, 0);
                group.add(gauge);

                const label = this._textSprite(`Bio-Tank ${index + 1}`, 0xffddff);
                label.position.y = 3.5 * fs;
                group.add(label);

                const progressBg = new THREE.Mesh(
                    new THREE.BoxGeometry(1.5 * fs, 0.12 * fs, 0.12 * fs),
                    this._mat(0x333333)
                );
                progressBg.position.set(0, 3.3 * fs, 0.5 * fs);
                group.add(progressBg);

                const progressFill = new THREE.Mesh(
                    new THREE.BoxGeometry(1.5 * fs, 0.1 * fs, 0.1 * fs),
                    new THREE.MeshStandardMaterial({ color: 0xdd8800, emissive: 0x442200 })
                );
                progressFill.position.set(0, 3.3 * fs, 0.5 * fs);
                progressFill.scale.x = 0;
                progressFill.visible = false;
                group.add(progressFill);

                liquid = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.55 * fs, 0.55 * fs, 2 * fs, 10),
                    new THREE.MeshStandardMaterial({
                        color: 0x66ffd8,
                        transparent: true,
                        opacity: 0.5,
                        emissive: 0x228866,
                        emissiveIntensity: 0.32,
                    })
                );
                liquid.position.y = 1.5 * fs;
                liquid.visible = false;
                group.add(liquid);

                const lockOverlay = null;
                const lockLabel = null;

                hitW = 1.5 * fs;
                hitH = 3.5 * fs;
                hitD = 1.5 * fs;
                hitCx = pos.x;
                hitCy = pos.y + 1.75 * fs;
                hitCz = pos.z;

                liquidRestY = liquid.position.y;
                bubbleSpawnWorldY = pos.y + 3.5 * fs - 0.08;

                this.scene.add(group);

                const hitbox = new THREE.Mesh(
                    new THREE.BoxGeometry(hitW, hitH, hitD),
                    new THREE.MeshBasicMaterial({ visible: false })
                );
                hitbox.position.set(hitCx, hitCy, hitCz);
                hitbox.userData = { type: 'fermenter', index };
                this.scene.add(hitbox);
                this.interactables.push(hitbox);
                this._addCollider(hitbox);

                this.fermenters[index] = {
                    group,
                    tank,
                    liquid,
                    gauge,
                    progressFill,
                    progressBg,
                    label,
                    lockOverlay,
                    lockLabel,
                    position: pos,
                    state: 'empty',
                    recipe: null,
                    progress: 0,
                    duration: 0,
                    speed: 1.0,
                    bubbles: [],
                    batchValid: true,
                    unlocked: true,
                    cost: slot.cost,
                    liquidRestY,
                    bubbleSpawnWorldY,
                };
            }
        if (popIn) {
            const g = this.fermenters[index]?.group;
            if (g) this._schedulePopIn(g);
        }
    }

    /**
     * @param {number} index
     * @param {{ popIn?: boolean, placement?: {x:number,z:number,yaw?:number}|null }} [opts]
     */
    spawnFermenterFromStore(index, { popIn = true, placement = null } = {}) {
        const slot = FERM_SLOTS[index];
        if (!slot || slot.starter || !slot.storeId) return;
        if (this.fermenters[index]) return;
        this._createFermenterAtIndex(index, popIn, placement);
    }

    _removeFermenterAtIndex(index) {
        const ferm = this.fermenters[index];
        if (!ferm) return;
        const hitbox = this.interactables.find(
            (o) => o.userData?.type === 'fermenter' && o.userData?.index === index
        );
        if (hitbox) {
            this.scene.remove(hitbox);
            const ix = this.interactables.indexOf(hitbox);
            if (ix >= 0) this.interactables.splice(ix, 1);
            hitbox.geometry?.dispose?.();
            hitbox.material?.dispose?.();
            const cix = this.colliders.findIndex((c) => c.mesh === hitbox);
            if (cix >= 0) this.colliders.splice(cix, 1);
        }
        if (ferm.group) {
            ferm.group.traverse((o) => {
                if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const m of mats) {
                    if (m?.map) m.map.dispose?.();
                    m?.dispose?.();
                }
            });
            this.scene.remove(ferm.group);
        }
        this.fermenters[index] = null;
    }

    /** Remove purchased fermenters/taps from the scene (new game). Starters stay. */
    despawnPurchasedFermentersAndTaps() {
        FERM_SLOTS.forEach((slot, i) => {
            if (!slot.starter) this._removeFermenterAtIndex(i);
        });
        TAP_SLOTS.forEach((slot, i) => {
            if (!slot.starter) this._removeTapAtIndex(i);
        });
        this.removeLagerTank();
    }

    /**
     * Spawns every fermenter/tap the player owns (call after load or new purchase).
     * @param {{ ownedObjectIds?: string[], equipmentPlacements?: Record<string,{x:number,z:number,yaw?:number}> }} gameState
     */
    syncStoreEquipmentFromOwned(gameState) {
        const owned = new Set(gameState?.ownedObjectIds || []);
        const placements = gameState?.equipmentPlacements || {};
        FERM_SLOTS.forEach((slot, index) => {
            if (slot.starter || !slot.storeId) return;
            if (owned.has(slot.storeId) && !this.fermenters[index]) {
                this._createFermenterAtIndex(index, false, placements[slot.storeId] || null);
            }
        });
        TAP_SLOTS.forEach((slot, index) => {
            if (slot.starter || !slot.storeId) return;
            if (owned.has(slot.storeId) && !this.taps[index]) {
                this._createTapAtIndex(index, false);
            }
        });
        if (owned.has(LAGER_TANK_STORE_ID) && !this.lagerTank) {
            this._buildLagerTank(false, placements[LAGER_TANK_STORE_ID] || null);
        }
    }

    /**
     * Spawns the floor lager tank after purchase from the supply terminal (or load).
     * @param {{ popIn?: boolean, placement?: {x:number,z:number,yaw?:number}|null }} [opts]
     */
    spawnLagerTankFromStore({ popIn = true, placement = null } = {}) {
        if (this.lagerTank) return;
        this._buildLagerTank(popIn, placement);
    }

    /** Remove lager tank mesh/hitbox (new game or before respawn). */
    removeLagerTank() {
        const ferm = this.lagerTank;
        if (!ferm) return;
        const hitbox = this.interactables.find((o) => o.userData?.type === 'lagerTank');
        if (hitbox) {
            this.scene.remove(hitbox);
            const ix = this.interactables.indexOf(hitbox);
            if (ix >= 0) this.interactables.splice(ix, 1);
            hitbox.geometry?.dispose?.();
            hitbox.material?.dispose?.();
            const cix = this.colliders.findIndex((c) => c.mesh === hitbox);
            if (cix >= 0) this.colliders.splice(cix, 1);
        }
        if (ferm.group) {
            ferm.group.traverse((o) => {
                if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const m of mats) {
                    if (m?.map) m.map.dispose?.();
                    m?.dispose?.();
                }
            });
            this.scene.remove(ferm.group);
        }
        this.lagerTank = null;
    }

    _schedulePopIn(group) {
        group.scale.setScalar(0.02);
        this._popInAnimations.push({ group, t: 0, duration: 0.32 });
    }

    updatePopInAnimations(delta) {
        for (let i = this._popInAnimations.length - 1; i >= 0; i--) {
            const a = this._popInAnimations[i];
            a.t += delta;
            const p = Math.min(1, a.t / a.duration);
            const e = 1 - Math.pow(1 - p, 3);
            const s = 0.02 + (1 - 0.02) * e;
            a.group.scale.setScalar(s);
            if (p >= 1) {
                a.group.scale.setScalar(1);
                this._popInAnimations.splice(i, 1);
            }
        }
    }

    /**
     * Large lager conditioning tank — open floor away from the bio-tank grid.
     * Only accepts Lager wort; outputs premium lager (more money at the bar).
     * Spawned when the player owns {@link LAGER_TANK_STORE_ID} (not at scene init).
     * @param {boolean} [popIn]
     * @param {{x:number,z:number,yaw?:number}|null} [placement]
     */
    _buildLagerTank(popIn = false, placement = null) {
        if (this.lagerTank) return;
        const posX = placement?.x ?? -5.5;
        const posZ = placement?.z ?? -14;
        const yaw = placement?.yaw ?? 0;
        const pos = new THREE.Vector3(posX, 0, posZ);
        const group = new THREE.Group();
        group.position.copy(pos);
        group.rotation.y = yaw;

        const FERM_GLTF_H = 3.08 * CEILING_SCALE;
        const _wtl = (g, wx, wy, wz) => {
            const v = new THREE.Vector3(wx, wy, wz);
            g.worldToLocal(v);
            return v;
        };

        let tank;
        let liquid;
        let liquidRestY = 1.5;
        let bubbleSpawnWorldY = pos.y + 3.1;
        let hitW = 2.8;
        let hitH = 2.9;
        let hitD = 2.8;
        let hitCx = pos.x;
        let hitCy = pos.y + 1.45;
        let hitCz = pos.z;

        const lagerTpl = this.assets?.lagerTankTemplate;
        if (lagerTpl) {
            const lagModel = lagerTpl.clone(true);
            this._prepGltfModelForWorld(lagModel);
            lagModel.updateMatrixWorld(true);
            const b0 = new THREE.Box3().setFromObject(lagModel);
            const h0 = b0.max.y - b0.min.y;
            const s = ((FERM_GLTF_H * 1.05) / Math.max(0.001, h0)) * (2 / 3);
            lagModel.scale.setScalar(s);
            lagModel.updateMatrixWorld(true);
            const b1 = new THREE.Box3().setFromObject(lagModel);
            lagModel.position.set(
                -(b1.min.x + b1.max.x) * 0.5,
                -b1.min.y,
                -(b1.min.z + b1.max.z) * 0.5
            );
            group.add(lagModel);
            tank = lagModel;

            group.updateMatrixWorld(true);
            const bb = new THREE.Box3().setFromObject(lagModel);
            const spanY = bb.max.y - bb.min.y;
            const spanXZ = Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
            const cylH = spanY * 0.5;
            const cylR = spanXZ * 0.2;
            const liqCy = bb.min.y + spanY * 0.46;
            const liqCx = (bb.min.x + bb.max.x) * 0.5;
            const liqCz = (bb.min.z + bb.max.z) * 0.5;

            liquid = new THREE.Mesh(
                new THREE.CylinderGeometry(cylR, cylR, cylH, 14),
                new THREE.MeshStandardMaterial({
                    color: 0x66ffd8,
                    transparent: true,
                    opacity: 0.5,
                    emissive: 0x228866,
                    emissiveIntensity: 0.32,
                })
            );
            liquid.position.copy(_wtl(group, liqCx, liqCy, liqCz));
            liquid.visible = false;
            group.add(liquid);
            liquidRestY = liquid.position.y;
            bubbleSpawnWorldY = bb.max.y - 0.12;

            const gauge = new THREE.Mesh(
                new THREE.SphereGeometry(0.12, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: 0xffee88,
                    emissive: 0xcc8800,
                    emissiveIntensity: 0.72,
                })
            );
            gauge.position.copy(
                _wtl(
                    group,
                    bb.max.x + 0.1,
                    bb.min.y + spanY * 0.58,
                    (bb.min.z + bb.max.z) * 0.5
                )
            );
            group.add(gauge);

            const label = this._textSprite('Lager Tank', 0xaaccff);
            label.position.copy(
                _wtl(group, (bb.min.x + bb.max.x) * 0.5, bb.max.y + 0.42, (bb.min.z + bb.max.z) * 0.5)
            );
            group.add(label);

            const progressBg = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.12), this._mat(0x333333));
            progressBg.position.copy(
                _wtl(
                    group,
                    (bb.min.x + bb.max.x) * 0.5,
                    bb.max.y + 0.22,
                    (bb.min.z + bb.max.z) * 0.5 + 0.45
                )
            );
            group.add(progressBg);

            const progressFill = new THREE.Mesh(
                new THREE.BoxGeometry(1.8, 0.1, 0.1),
                new THREE.MeshStandardMaterial({ color: 0x44aa88, emissive: 0x224422 })
            );
            progressFill.position.copy(progressBg.position);
            progressFill.scale.x = 0;
            progressFill.visible = false;
            group.add(progressFill);

            group.updateMatrixWorld(true);
            const bbHit = new THREE.Box3().setFromObject(lagModel);
            hitW = Math.max(2.4, (bbHit.max.x - bbHit.min.x) * 1.15);
            hitH = Math.max(2.5, (bbHit.max.y - bbHit.min.y) * 1.08);
            hitD = Math.max(2.4, (bbHit.max.z - bbHit.min.z) * 1.15);
            hitCx = (bbHit.min.x + bbHit.max.x) * 0.5;
            hitCy = (bbHit.min.y + bbHit.max.y) * 0.5;
            hitCz = (bbHit.min.z + bbHit.max.z) * 0.5;

            this.scene.add(group);

            const hitbox = new THREE.Mesh(
                new THREE.BoxGeometry(hitW, hitH, hitD),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            hitbox.position.set(hitCx, hitCy, hitCz);
            hitbox.userData = { type: 'lagerTank' };
            this.scene.add(hitbox);
            this.interactables.push(hitbox);
            this._addCollider(hitbox);

            this.lagerTank = {
                group,
                tank,
                liquid,
                gauge,
                progressFill,
                progressBg,
                label,
                position: pos,
                state: 'empty',
                recipe: null,
                progress: 0,
                duration: 0,
                speed: 1.0,
                bubbles: [],
                batchValid: true,
                liquidRestY,
                bubbleSpawnWorldY,
            };
        } else {
            const fs = CEILING_SCALE * (2 / 3);
            const steelMat = this._stainlessMaterial();
            tank = new THREE.Mesh(
                new THREE.CylinderGeometry(1.1 * fs, 1.15 * fs, 2.4 * fs, 18),
                steelMat
            );
            tank.position.y = 1.25 * fs;
            group.add(tank);

            liquid = new THREE.Mesh(
                new THREE.CylinderGeometry(1.0 * fs, 1.05 * fs, 1.9 * fs, 14),
                new THREE.MeshStandardMaterial({
                    color: 0x66ffd8,
                    transparent: true,
                    opacity: 0.5,
                    emissive: 0x228866,
                    emissiveIntensity: 0.32,
                })
            );
            liquid.position.y = 1.2 * fs;
            liquid.visible = false;
            group.add(liquid);
            liquidRestY = liquid.position.y;
            bubbleSpawnWorldY = pos.y + 2.6 * fs;

            const gauge = new THREE.Mesh(
                new THREE.SphereGeometry(0.14 * fs, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: 0xffee88,
                    emissive: 0xcc8800,
                    emissiveIntensity: 0.72,
                })
            );
            gauge.position.set(1.25 * fs, 1.8 * fs, 0);
            group.add(gauge);

            const label = this._textSprite('Lager Tank', 0xaaccff);
            label.position.y = 2.85 * fs;
            group.add(label);

            const progressBg = new THREE.Mesh(
                new THREE.BoxGeometry(1.8 * fs, 0.12 * fs, 0.12 * fs),
                this._mat(0x333333)
            );
            progressBg.position.set(0, 2.55 * fs, 0.55 * fs);
            group.add(progressBg);

            const progressFill = new THREE.Mesh(
                new THREE.BoxGeometry(1.8 * fs, 0.1 * fs, 0.1 * fs),
                new THREE.MeshStandardMaterial({ color: 0x44aa88, emissive: 0x224422 })
            );
            progressFill.position.copy(progressBg.position);
            progressFill.scale.x = 0;
            progressFill.visible = false;
            group.add(progressFill);

            hitW = 2.6 * fs;
            hitH = 2.75 * fs;
            hitD = 2.6 * fs;
            hitCx = pos.x;
            hitCy = pos.y + 1.35 * fs;
            hitCz = pos.z;

            this.scene.add(group);

            const hitbox = new THREE.Mesh(
                new THREE.BoxGeometry(hitW, hitH, hitD),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            hitbox.position.set(hitCx, hitCy, hitCz);
            hitbox.userData = { type: 'lagerTank' };
            this.scene.add(hitbox);
            this.interactables.push(hitbox);
            this._addCollider(hitbox);

            this.lagerTank = {
                group,
                tank,
                liquid,
                gauge,
                progressFill,
                progressBg,
                label,
                position: pos,
                state: 'empty',
                recipe: null,
                progress: 0,
                duration: 0,
                speed: 1.0,
                bubbles: [],
                batchValid: true,
                liquidRestY,
                bubbleSpawnWorldY,
            };
        }
        if (popIn && this.lagerTank?.group) {
            this._schedulePopIn(this.lagerTank.group);
        }
    }

    // ─── keg station ────────────────────────────────────────
    _buildKegStation() {
        const pos = new THREE.Vector3(13, 0, -4);
        const group = new THREE.Group();
        group.position.copy(pos);

        const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 2), this._hullPanelMaterial());
        table.position.y = 0.45; group.add(table);

        const trim = new THREE.Mesh(
            new THREE.BoxGeometry(3.08, 0.06, 2.08),
            this._neonAt(3)
        );
        trim.position.y = 0.93;
        group.add(trim);

        /** Table mesh: center y=0.45, height 0.9 → top surface at y=0.9 (group local). */
        const FLUID_UPLINK_TABLE_TOP_Y = 0.9;

        let stationKeg;
        if (this.assets.kegTemplate) {
            stationKeg = this.assets.kegTemplate.clone(true);
            stationKeg.scale.multiplyScalar(1.35);
            stationKeg.rotation.x = Math.PI / 2;
            stationKeg.position.set(0, 0, 0);
            group.add(stationKeg);
            stationKeg.updateMatrixWorld(true);
            const kbox = new THREE.Box3().setFromObject(stationKeg);
            stationKeg.position.y = FLUID_UPLINK_TABLE_TOP_Y - kbox.min.y;
        } else {
            stationKeg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.6, 0.6, 1.4, 12),
                new THREE.MeshStandardMaterial({
                    color: 0x8899aa,
                    metalness: 0.82,
                    roughness: 0.22,
                    envMapIntensity: 1.0,
                    emissive: 0x061018,
                    emissiveIntensity: 0.1,
                })
            );
            stationKeg.rotation.x = Math.PI / 2;
            stationKeg.position.set(0, 0, 0);
            group.add(stationKeg);
            stationKeg.updateMatrixWorld(true);
            const kbox = new THREE.Box3().setFromObject(stationKeg);
            stationKeg.position.y = FLUID_UPLINK_TABLE_TOP_Y - kbox.min.y;
        }

        const hose = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8),
            new THREE.MeshStandardMaterial({
                color: 0x334455,
                metalness: 0.5,
                roughness: 0.55,
                emissive: 0x112233,
                emissiveIntensity: 0.15,
            })
        );
        hose.position.set(-0.8, 1.2, 0); hose.rotation.z = Math.PI / 4; group.add(hose);

        const label = this._textSprite('Fluid Uplink', 0xaaffee);
        label.position.y = 2.2; group.add(label);

        this.scene.add(group);
        group.updateMatrixWorld(true);
        stationKeg.updateMatrixWorld(true);
        const stationKegBox = new THREE.Box3().setFromObject(stationKeg);
        this.colliders.push({ mesh: stationKeg, box: stationKegBox });

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(3, 2, 2), new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.copy(pos); hitbox.position.y = 1;
        hitbox.userData = { type: 'kegStation' };
        this.scene.add(hitbox); this.interactables.push(hitbox);
        this._addCollider(hitbox);

        this.kegStation = { group, position: pos, kegMeshes: [] };
    }

    // ─── bar (horseshoe) ────────────────────────────────────
    _buildBar() {
        const { cx, cz, innerR, outerR, topY, frontH, angleStart, angleEnd, angleSpan } = BAR;
        const BAR_SEGS = 24;
        const centerR = (innerR + outerR) * 0.5;
        const radialWidth = outerR - innerR;

        const topMat = new THREE.MeshStandardMaterial({
            color: 0x2a3848,
            metalness: 0.55,
            roughness: 0.38,
            envMapIntensity: 0.85,
            emissive: 0x061018,
            emissiveIntensity: 0.08,
        });
        const panelMat = this._hullPanelMaterial();
        const neonRim = this._neonAt(0);
        const neonFront = this._neonAt(2);

        // Build the horseshoe as curved segmented strips.
        // Each segment = a radial "wedge" of the annulus, oriented so its local +X axis
        // points tangent to the arc and +Z points radially outward.
        for (let i = 0; i < BAR_SEGS; i++) {
            const t0 = angleStart + (i / BAR_SEGS) * angleSpan;
            const t1 = angleStart + ((i + 1) / BAR_SEGS) * angleSpan;
            const tMid = (t0 + t1) * 0.5;
            const midX = cx + centerR * Math.cos(tMid);
            const midZ = cz + centerR * Math.sin(tMid);

            // Tangent length at centerline — chord length between the two endpoints on centerR.
            const tx0 = cx + centerR * Math.cos(t0);
            const tz0 = cz + centerR * Math.sin(t0);
            const tx1 = cx + centerR * Math.cos(t1);
            const tz1 = cz + centerR * Math.sin(t1);
            const tanLen = Math.hypot(tx1 - tx0, tz1 - tz0) + 0.01;

            // Yaw so local +X = tangent dir, local +Z = outward radial dir.
            // Radial outward direction at tMid is (cos tMid, sin tMid). Tangent (CCW) is (-sin tMid, cos tMid).
            // We want local +X → tangent. Rotation.y = y such that (cos y, -sin y) = tangent in world XZ,
            // where rotation y rotates local +X=(1,0,0) to world (cos y, 0, -sin y).
            // Solve: cos y = -sin tMid, -sin y = cos tMid → y = atan2(-cos tMid, -sin tMid).
            const yaw = Math.atan2(-Math.cos(tMid), -Math.sin(tMid));

            // Bar-top slab (thin box spanning the radial width).
            const top = new THREE.Mesh(
                new THREE.BoxGeometry(tanLen, 0.15, radialWidth),
                topMat
            );
            top.position.set(midX, topY - 0.075, midZ);
            top.rotation.y = yaw;
            top.receiveShadow = true;
            this.scene.add(top);

            // Rim neon along the customer-facing outer edge.
            const rim = new THREE.Mesh(
                new THREE.BoxGeometry(tanLen, 0.045, 0.04),
                neonRim
            );
            // Shift locally along +Z (outward) by half the radial width.
            const rimX = midX + (radialWidth * 0.48) * Math.cos(tMid);
            const rimZ = midZ + (radialWidth * 0.48) * Math.sin(tMid);
            rim.position.set(rimX, topY + 0.025, rimZ);
            rim.rotation.y = yaw;
            this.scene.add(rim);

            // Outer front panel (customer-facing wall).
            const outX = cx + outerR * Math.cos(tMid);
            const outZ = cz + outerR * Math.sin(tMid);
            const outFace = new THREE.Mesh(
                new THREE.BoxGeometry(tanLen, frontH, 0.1),
                panelMat
            );
            outFace.position.set(outX, frontH * 0.5, outZ);
            outFace.rotation.y = yaw;
            this.scene.add(outFace);

            // Neon strip running under the lip of the bar on the customer side.
            if (i > 0 && i < BAR_SEGS - 1) {
                const strip = new THREE.Mesh(
                    new THREE.BoxGeometry(tanLen, 0.04, 0.02),
                    neonFront
                );
                strip.position.set(outX, topY - 0.26, outZ);
                strip.rotation.y = yaw;
                this.scene.add(strip);
            }

            // Inner back panel (bartender side).
            const inX = cx + innerR * Math.cos(tMid);
            const inZ = cz + innerR * Math.sin(tMid);
            const inFace = new THREE.Mesh(
                new THREE.BoxGeometry(tanLen, frontH, 0.1),
                panelMat
            );
            inFace.position.set(inX, frontH * 0.5, inZ);
            inFace.rotation.y = yaw;
            this.scene.add(inFace);

            // Invisible collider — one chunky wedge per segment blocks both sides of the bar.
            const col = new THREE.Mesh(
                new THREE.BoxGeometry(tanLen, frontH + 0.1, radialWidth),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            col.position.set(midX, (frontH + 0.1) * 0.5, midZ);
            col.rotation.y = yaw;
            this.scene.add(col);
            this._addCollider(col);
        }

        // End caps on the two open ends of the horseshoe (so the bar looks finished at the opening).
        for (const theta of [angleStart, angleEnd]) {
            const capX = cx + centerR * Math.cos(theta);
            const capZ = cz + centerR * Math.sin(theta);
            const capYaw = Math.atan2(-Math.cos(theta), -Math.sin(theta));
            const cap = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, frontH + 0.16, radialWidth + 0.04),
                panelMat
            );
            cap.position.set(capX, (frontH + 0.16) * 0.5 - 0.08, capZ);
            cap.rotation.y = capYaw;
            this.scene.add(cap);

            const capRim = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.05, radialWidth + 0.06),
                neonRim
            );
            capRim.position.set(capX, topY + 0.025, capZ);
            capRim.rotation.y = capYaw;
            this.scene.add(capRim);
        }

        // Bar stools around the customer-facing outer arc.
        const stoolMat = new THREE.MeshStandardMaterial({
            color: 0x3a4a5c,
            metalness: 0.72,
            roughness: 0.34,
            envMapIntensity: 0.88,
            emissive: 0x061018,
            emissiveIntensity: 0.06,
        });
        const g = this._fg;
        const STOOL_COUNT = 7;
        const stoolR = outerR + 0.55;
        for (let i = 0; i < STOOL_COUNT; i++) {
            const theta = angleStart + ((i + 0.5) / STOOL_COUNT) * angleSpan;
            const sx = cx + stoolR * Math.cos(theta);
            const sz = cz + stoolR * Math.sin(theta);
            const foot = new THREE.Mesh(g.barStoolFoot, stoolMat);
            foot.rotation.x = Math.PI / 2;
            foot.position.set(sx, 0.03, sz);
            this.scene.add(foot);
            const ped = new THREE.Mesh(g.barStoolPedestal, stoolMat);
            ped.position.set(sx, 0.045, sz);
            this.scene.add(ped);
            const seat = new THREE.Mesh(g.barStoolSeat, stoolMat);
            seat.position.set(sx, 0.735, sz);
            this.scene.add(seat);
            const seatGlow = new THREE.Mesh(
                new THREE.TorusGeometry(0.255, 0.012, 6, 20),
                this._neonAt(i)
            );
            seatGlow.rotation.x = Math.PI / 2;
            seatGlow.position.set(sx, 0.675, sz);
            this.scene.add(seatGlow);
        }
    }

    // ─── taps ───────────────────────────────────────────────
    _buildTaps() {
        TAP_SLOTS.forEach((slot, index) => {
            if (!slot.starter) return;
            this._createTapAtIndex(index, false);
        });
    }

    _createTapAtIndex(index, popIn = false) {
        const slot = TAP_SLOTS[index];
        const gltfTapRoot = this.assets?.beerTapTemplate;
        // Taps sit on the bar-top centerline; rotationY orients the spout toward the customer.
        const tapSlotZ = slot.z ?? 0.8;
        const tapYaw = slot.rotationY ?? 0;

            const group = new THREE.Group();
            group.position.set(slot.x, BAR.topY + 0.05, tapSlotZ);
            group.rotation.y = tapYaw;

            let handle = null;
            let knob = null;

            if (gltfTapRoot) {
                const tapModel = gltfTapRoot.clone(true);
                tapModel.traverse((o) => {
                    if (o.isMesh) {
                        o.castShadow = false;
                        o.receiveShadow = true;
                    }
                });
                tapModel.rotation.y = 0;
                tapModel.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(tapModel);
                const size = box.getSize(new THREE.Vector3());
                const targetH = 0.58;
                const s = targetH / Math.max(0.001, size.y);
                tapModel.scale.setScalar(s);
                tapModel.updateMatrixWorld(true);
                const box2 = new THREE.Box3().setFromObject(tapModel);
                tapModel.position.set(
                    -(box2.min.x + box2.max.x) * 0.5,
                    -box2.min.y,
                    -(box2.min.z + box2.max.z) * 0.5
                );
                group.add(tapModel);
                handle = tapModel;

                knob = new THREE.Mesh(
                    new THREE.SphereGeometry(0.055, 14, 12),
                    new THREE.MeshStandardMaterial({
                        color: 0xff0000,
                        metalness: 0.25,
                        roughness: 0.42,
                        emissive: 0x330000,
                        emissiveIntensity: 0.35,
                        envMapIntensity: 0.9,
                    })
                );
                group.add(knob);
                const syncKnobY = () => {
                    tapModel.updateMatrixWorld(true);
                    const b = new THREE.Box3().setFromObject(tapModel);
                    const top = new THREE.Vector3(
                        (b.min.x + b.max.x) * 0.5,
                        b.max.y + 0.06,
                        (b.min.z + b.max.z) * 0.5
                    );
                    group.worldToLocal(top);
                    knob.position.copy(top);
                };
                syncKnobY();
            } else {
                handle = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10, 1),
                    new THREE.MeshStandardMaterial({
                        color: 0xccd8e8,
                        metalness: 0.85,
                        roughness: 0.2,
                        envMapIntensity: 1.05,
                    })
                );
                handle.position.y = 0.35;
                group.add(handle);

                knob = new THREE.Mesh(
                    new THREE.SphereGeometry(0.082, 12, 10),
                    this._neonAt(index)
                );
                knob.position.y = 0.65;
                group.add(knob);

                const collar = new THREE.Mesh(
                    new THREE.TorusGeometry(0.072, 0.014, 10, 28),
                    new THREE.MeshStandardMaterial({
                        color: 0x99aabb,
                        metalness: 0.9,
                        roughness: 0.16,
                        envMapIntensity: 1.05,
                    })
                );
                collar.rotation.x = Math.PI / 2;
                collar.position.y = 0.58;
                group.add(collar);

                const tapBase = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.085, 0.105, 0.12, 12, 1),
                    new THREE.MeshStandardMaterial({
                        color: 0x8899aa,
                        metalness: 0.88,
                        roughness: 0.18,
                        envMapIntensity: 1.05,
                    })
                );
                tapBase.position.y = 0.06;
                group.add(tapBase);
            }

            const label = this._textSprite(`Tap ${index + 1}`, 0xffeecc);
            label.position.y = gltfTapRoot ? 0.95 : 1.0;
            group.add(label);

            const lockOverlay = null;
            const lockLabel = null;

            this.scene.add(group);

            const hitbox = new THREE.Mesh(
                new THREE.BoxGeometry(1.3, 1.2, 1.1), new THREE.MeshBasicMaterial({ visible: false })
            );
            hitbox.position.set(slot.x, 1.6, tapSlotZ);
            hitbox.rotation.y = tapYaw;
            hitbox.userData = { type: 'tap', index };
            this.scene.add(hitbox); this.interactables.push(hitbox);

            this.taps[index] = {
                group, handle, knob, label,
                lockOverlay, lockLabel,
                position: new THREE.Vector3(slot.x, BAR.topY + 0.05, tapSlotZ),
                keg: null,
                unlocked: true, cost: slot.cost
            };
        if (popIn) {
            const g = this.taps[index]?.group;
            if (g) this._schedulePopIn(g);
        }
    }

    spawnTapFromStore(index, { popIn = true } = {}) {
        const slot = TAP_SLOTS[index];
        if (!slot || slot.starter || !slot.storeId) return;
        if (this.taps[index]) return;
        this._createTapAtIndex(index, popIn);
    }

    _removeTapAtIndex(index) {
        const tap = this.taps[index];
        if (!tap) return;
        const hitbox = this.interactables.find(
            (o) => o.userData?.type === 'tap' && o.userData?.index === index
        );
        if (hitbox) {
            this.scene.remove(hitbox);
            const ix = this.interactables.indexOf(hitbox);
            if (ix >= 0) this.interactables.splice(ix, 1);
            hitbox.geometry?.dispose?.();
            hitbox.material?.dispose?.();
            const cix = this.colliders.findIndex((c) => c.mesh === hitbox);
            if (cix >= 0) this.colliders.splice(cix, 1);
        }
        if (tap.group) {
            tap.group.traverse((o) => {
                if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const m of mats) {
                    if (m?.map) m.map.dispose?.();
                    m?.dispose?.();
                }
            });
            this.scene.remove(tap.group);
        }
        this.taps[index] = null;
    }

    // ─── customer spots ─────────────────────────────────────
    /** Patrons stand just outside the horseshoe (customer side), facing the bar. */
    _buildCustomerSpots() {
        const COUNT = 5;
        const { cx, cz, outerR, angleStart, angleSpan } = BAR;
        const r = outerR + 0.85; // ~1 m clearance past the bar top's outer edge
        for (let i = 0; i < COUNT; i++) {
            const theta = angleStart + ((i + 0.5) / COUNT) * angleSpan;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            // Face the bar center (default forward is −Z, so yaw = atan2(dx, dz) with
            // dx = x − cx, dz = z − cz gives the "facing-inward" rotation).
            const rotationY = Math.atan2(x - cx, z - cz);
            this.customerSpots.push({
                position: new THREE.Vector3(x, 0, z),
                rotationY,
                occupied: false,
                index: i,
            });
        }
    }

    /** Seat positions / facing for sit → bar → sit loop (no meshes). */
    _buildTableSeats() {
        const extra = this.assets?.furnitureChairTemplate?.userData?.chairYawExtra ?? 0;
        const tableConfigs = this._getTaproomTableConfigs();
        tableConfigs.forEach((cfg) => {
            const n = cfg.chairs;
            for (let i = 0; i < n; i++) {
                const angle = (i / n) * Math.PI * 2;
                const cx = cfg.x + Math.cos(angle) * 1.2;
                const cz = cfg.z + Math.sin(angle) * 1.2;
                const dx = cfg.x - cx;
                const dz = cfg.z - cz;
                this.tableSeats.push({
                    position: new THREE.Vector3(cx, 0, cz),
                    rotationY: Math.atan2(dx, dz) + extra,
                    occupied: false,
                });
            }
        });

        // Booth tables tucked along the curved taproom wall — each has 2 chairs facing inward.
        const boothConfigs = this._getTaproomBoothConfigs();
        boothConfigs.forEach((cfg) => {
            const side = cfg.seatOffset; // half-length (m) along the booth's long axis
            const dirs = this._boothLocalAxes(cfg.yaw);
            [-side, +side].forEach((dAlong) => {
                // Chair sits on the room-center side of the booth, facing the table (toward wall).
                const cxSeat = cfg.x + dirs.inX * 0.85 + dirs.tanX * dAlong;
                const czSeat = cfg.z + dirs.inZ * 0.85 + dirs.tanZ * dAlong;
                const lookX = cfg.x + dirs.tanX * dAlong;
                const lookZ = cfg.z + dirs.tanZ * dAlong;
                const dx = lookX - cxSeat;
                const dz = lookZ - czSeat;
                this.tableSeats.push({
                    position: new THREE.Vector3(cxSeat, 0, czSeat),
                    rotationY: Math.atan2(dx, dz) + extra,
                    occupied: false,
                });
            });
        });
    }

    /**
     * Unit vectors for a booth rotated by `yaw` around Y. Local +X aligns with the
     * booth's long axis (tangent to the ellipse), local +Z points radially inward
     * (toward the room center).
     */
    _boothLocalAxes(yaw) {
        return {
            tanX: Math.cos(yaw),
            tanZ: -Math.sin(yaw),
            inX: Math.sin(yaw),
            inZ: Math.cos(yaw),
        };
    }

    /** Pedestal tables inside the half-ellipse taproom, carefully clear of the horseshoe. */
    _getTaproomTableConfigs() {
        return [
            { x: -6, z: 12, chairs: 4 },
            { x: 6, z: 12, chairs: 4 },
            { x: -9, z: 16, chairs: 3 },
            { x: 9, z: 16, chairs: 3 },
            { x: -5, z: 19, chairs: 3 },
            { x: 5, z: 19, chairs: 3 },
        ];
    }

    /**
     * Booth tables that sit ~1.4 m inside the curved outer wall. Each booth's table is
     * rotated so its long axis is tangent to the wall.
     * `yaw` is the three.js rotation.y for the booth (default booth long axis = +X).
     * Booth center is already offset inward from the ellipse.
     */
    _getTaproomBoothConfigs() {
        const tap = this._taproom;
        const rxIn = tap.ellipseRx - 1.35;
        const rzIn = tap.ellipseRz - 1.35;
        const params = [Math.PI / 5, (4 * Math.PI) / 5]; // ~36° and ~144° along the ellipse
        return params.map((t) => {
            const x = rxIn * Math.cos(t);
            const z = tap.dividerZ + rzIn * Math.sin(t);
            // Tangent direction of the ellipse curve at parameter t
            const tgx = -tap.ellipseRx * Math.sin(t);
            const tgz = tap.ellipseRz * Math.cos(t);
            // Yaw so the booth's default long +X lines up with the tangent direction.
            const yaw = Math.atan2(-tgz, tgx);
            return { x, z, yaw, seatOffset: 0.65 };
        });
    }

    /** Taproom ceiling fixture — top edge sits just under `ROOM_CEILING_Y`. */
    _addTaproomChandelier(wx, wz) {
        const tmpl = this.assets?.taproomChandelierTemplate;
        if (!tmpl) return;
        const ch = tmpl.clone(true);
        ch.traverse((o) => {
            if (o.isMesh) {
                o.castShadow = false;
                o.receiveShadow = true;
            }
        });
        ch.rotation.y = 0;
        ch.position.set(wx, 0, wz);
        ch.updateMatrixWorld(true);
        const b0 = new THREE.Box3().setFromObject(ch);
        const h0 = b0.max.y - b0.min.y;
        const targetH = 0.66;
        const s = targetH / Math.max(0.001, h0);
        ch.scale.setScalar(s);
        ch.updateMatrixWorld(true);
        const b1 = new THREE.Box3().setFromObject(ch);
        ch.position.y = ROOM_CEILING_Y - 0.06 - b1.max.y;
        this.scene.add(ch);
    }

    // ─── taproom furniture (aesthetic only) ──────────────────
    _buildTaproomFurniture() {
        const g = this._fg;
        const tableMat = this._alloyTableMaterial();
        const tableRim = tableMat.clone();
        tableRim.emissive = new THREE.Color(0x1a3048);
        tableRim.emissiveIntensity = 0.14;

        const chairMat = new THREE.MeshStandardMaterial({
            color: 0x354555,
            metalness: 0.62,
            roughness: 0.42,
            envMapIntensity: 0.9,
        });
        const cushionMat = new THREE.MeshStandardMaterial({
            color: 0x2a5080,
            metalness: 0.28,
            roughness: 0.58,
            emissive: 0x102040,
            emissiveIntensity: 0.14,
        });
        const chairTpl = this.assets?.furnitureChairTemplate;

        const tableConfigs = this._getTaproomTableConfigs();

        tableConfigs.forEach((cfg) => {
            const { x, z } = cfg;
            const foot = new THREE.Mesh(g.tableFoot, tableMat);
            foot.position.set(x, 0.02, z);
            foot.userData._staticScenery = true;
            this.scene.add(foot);

            const ped = new THREE.Mesh(g.tablePedestal, tableMat);
            ped.position.set(x, 0.04, z);
            ped.userData._staticScenery = true;
            this.scene.add(ped);

            const top = new THREE.Mesh(g.tableTop, tableMat);
            top.position.set(x, 0.04 + 0.74 + 0.024, z);
            top.userData._staticScenery = true;
            this.scene.add(top);

            const edge = new THREE.Mesh(g.tableEdgeRing, tableRim);
            edge.rotation.x = Math.PI / 2;
            edge.position.set(x, 0.04 + 0.74 - 0.008, z);
            edge.userData._staticScenery = true;
            this.scene.add(edge);

            const tcol = new THREE.Mesh(
                new THREE.CylinderGeometry(0.72, 0.72, 0.85, 10),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            tcol.position.set(x, 0.42, z);
            this._addCollider(tcol);

            for (let i = 0; i < cfg.chairs; i++) {
                const angle = (i / cfg.chairs) * Math.PI * 2;
                const cx = x + Math.cos(angle) * 1.2;
                const cz = z + Math.sin(angle) * 1.2;

                if (chairTpl) {
                    this._addGlbChair(chairTpl, cx, cz, x, z);
                } else {
                    const seat = new THREE.Mesh(g.chairSeat, chairMat);
                    seat.position.set(cx, 0.22, cz);
                    seat.userData._staticScenery = true;
                    this.scene.add(seat);

                    const cush = new THREE.Mesh(g.chairCushion, cushionMat);
                    cush.position.set(cx, 0.315, cz);
                    cush.userData._staticScenery = true;
                    this.scene.add(cush);

                    const backX = cx + Math.cos(angle) * 0.19;
                    const backZ = cz + Math.sin(angle) * 0.19;
                    const chairBack = new THREE.Mesh(g.chairBack, chairMat);
                    chairBack.position.set(backX, 0.58, backZ);
                    chairBack.rotation.y = -angle + Math.PI;
                    chairBack.userData._staticScenery = true;
                    this.scene.add(chairBack);

                    const lo = 0.168;
                    [[lo, lo], [-lo, lo], [lo, -lo], [-lo, -lo]].forEach(([dx, dz]) => {
                        const leg = new THREE.Mesh(g.chairLeg, chairMat);
                        leg.position.set(cx + dx, 0.078, cz + dz);
                        leg.userData._staticScenery = true;
                        this.scene.add(leg);
                    });
                }
            }
        });

        // Curved-wall booths: booth tables tucked along the inside of the half-ellipse wall.
        // Each booth's long axis is tangent to the curve and faces the bar. GLB chairs sit
        // on the bar-facing side.
        const boothConfigs = this._getTaproomBoothConfigs();
        boothConfigs.forEach((cfg) => {
            const bleg = new THREE.Mesh(g.boothTablePedestal, tableMat);
            bleg.rotation.y = cfg.yaw;
            bleg.position.set(cfg.x, 0.05, cfg.z);
            bleg.userData._staticScenery = true;
            this.scene.add(bleg);

            const btop = new THREE.Mesh(g.boothTableTop, tableMat);
            btop.rotation.y = cfg.yaw;
            btop.position.set(cfg.x, 0.05 + 0.72 + 0.028, cfg.z);
            btop.userData._staticScenery = true;
            this.scene.add(btop);

            const btcol = new THREE.Mesh(
                new THREE.BoxGeometry(2.35, 0.85, 0.85),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            btcol.rotation.y = cfg.yaw;
            btcol.position.set(cfg.x, 0.42, cfg.z);
            this._addCollider(btcol);

            if (chairTpl) {
                const dirs = this._boothLocalAxes(cfg.yaw);
                [-cfg.seatOffset, cfg.seatOffset].forEach((dAlong) => {
                    const cx = cfg.x + dirs.inX * 0.85 + dirs.tanX * dAlong;
                    const cz = cfg.z + dirs.inZ * 0.85 + dirs.tanZ * dAlong;
                    const lookX = cfg.x + dirs.tanX * dAlong;
                    const lookZ = cfg.z + dirs.tanZ * dAlong;
                    this._addGlbChair(chairTpl, cx, cz, lookX, lookZ);
                });
            }

            this._addTaproomChandelier(cfg.x, cfg.z);
        });

        // Holo target — mounted on the curved east wall, oriented to face the room center.
        const holoBaseMat = new THREE.MeshStandardMaterial({
            color: 0x0a1520,
            metalness: 0.48,
            roughness: 0.78,
            emissive: 0x112233,
            emissiveIntensity: 0.28,
        });
        {
            const t = Math.PI * 0.28;
            const tap = this._taproom;
            const ex = tap.ellipseRx * Math.cos(t);
            const ez = tap.dividerZ + tap.ellipseRz * Math.sin(t);
            const nx = ex / (tap.ellipseRx * tap.ellipseRx);
            const nz = (ez - tap.dividerZ) / (tap.ellipseRz * tap.ellipseRz);
            const nLen = Math.hypot(nx, nz);
            const outX = nx / nLen;
            const outZ = nz / nLen;
            const holoX = ex - outX * 0.15;
            const holoZ = ez - outZ * 0.15;
            // After rotating the holoBoard cylinder cap by π/2 around X it faces +Z locally; the
            // surrounding group rotates that face toward world (sin y, cos y). We want the board
            // pointed radially inward (opposite the wall normal), so yaw = atan2(−outX, −outZ).
            const holoYaw = Math.atan2(-outX, -outZ);
            const holoGroup = new THREE.Group();
            holoGroup.position.set(holoX, 1.6, holoZ);
            holoGroup.rotation.y = holoYaw;

            const board = new THREE.Mesh(g.holoBoard, holoBaseMat);
            board.rotation.x = Math.PI / 2;
            holoGroup.add(board);

            const ringOuter = new THREE.Mesh(g.holoRingOuter, this._neonAt(0));
            ringOuter.rotation.x = Math.PI / 2;
            ringOuter.position.z = -0.1;
            holoGroup.add(ringOuter);

            const ringMid = new THREE.Mesh(g.holoRingMid, this._neonAt(1));
            ringMid.rotation.x = Math.PI / 2;
            ringMid.position.z = -0.11;
            holoGroup.add(ringMid);

            const ringIn = new THREE.Mesh(g.holoRingInner, this._neonAt(3));
            ringIn.rotation.x = Math.PI / 2;
            ringIn.position.z = -0.12;
            holoGroup.add(ringIn);

            const bull = new THREE.Mesh(
                g.holoBull,
                new THREE.MeshStandardMaterial({
                    color: 0xff4466,
                    emissive: 0xaa2233,
                    emissiveIntensity: 0.75,
                    metalness: 0.35,
                    roughness: 0.35,
                })
            );
            bull.position.z = -0.18;
            holoGroup.add(bull);

            const dlabel = this._textSprite('HOLO TARGET', 0xffaae8, 0.55);
            dlabel.position.set(0, 0.7, -0.1);
            holoGroup.add(dlabel);

            holoGroup.userData._staticScenery = true;
            this.scene.add(holoGroup);
        }

        // Galactic Jukebox — replaces the old "BREW MANIFEST" chalkboard. Sits against
        // the divider wall facing +Z (into the taproom) so the player can walk up to it
        // from the tables. Uses the glTF template when available, otherwise a procedural
        // cabinet. Hitbox + collider register it as an interactable of type 'jukebox'.
        this._buildTaproomJukebox(-10, this._taproom.dividerZ + 0.18);

        const shadeMat = new THREE.MeshStandardMaterial({
            color: 0x4a4860,
            metalness: 0.72,
            roughness: 0.28,
            emissive: 0xffaa66,
            emissiveIntensity: 0.42,
        });
        const chTpl = this.assets?.taproomChandelierTemplate;
        tableConfigs.forEach((cfg) => {
            if (chTpl) {
                this._addTaproomChandelier(cfg.x, cfg.z);
            } else {
                const cord = new THREE.Mesh(g.pendantCord, this._mat(0x1a2030));
                cord.position.set(cfg.x, ROOM_CEILING_Y - 0.06, cfg.z);
                this.scene.add(cord);

                const shade = new THREE.Mesh(g.pendantShade, shadeMat);
                shade.position.set(cfg.x, ROOM_CEILING_Y - 0.76, cfg.z);
                shade.scale.set(1.05, 0.82, 1.05);
                this.scene.add(shade);
            }
        });

        const potMat = new THREE.MeshStandardMaterial({
            color: 0x2a3548,
            metalness: 0.58,
            roughness: 0.4,
            envMapIntensity: 0.75,
        });
        const fluidMat = new THREE.MeshStandardMaterial({
            color: 0x88ffee,
            transparent: true,
            opacity: 0.54,
            emissive: 0x44ffcc,
            emissiveIntensity: 0.68,
            roughness: 0.1,
            metalness: 0.1,
        });
        [[-13, 0, 11], [13, 0, 11], [-5, 0, 19.5], [5, 0, 19.5]].forEach(([px, py, pz]) => {
            const pot = new THREE.Mesh(g.hydroPot, potMat);
            pot.position.set(px, 0.02, pz);
            this.scene.add(pot);

            const rim = new THREE.Mesh(
                new THREE.TorusGeometry(0.17, 0.012, 8, 32),
                this._neonAt(px < 0 ? 1 : px > 0 ? 2 : 3)
            );
            rim.rotation.x = Math.PI / 2;
            rim.position.set(px, 0.38, pz);
            this.scene.add(rim);

            const fluid = new THREE.Mesh(g.hydroFluid, fluidMat);
            fluid.position.set(px, 0.56, pz);
            this.scene.add(fluid);
        });
    }

    // ─── lighting ───────────────────────────────────────────
    _buildLighting() {
        // Scene was lit by Ambient + Hemi + Directional + 3 PointLights. Every
        // `MeshStandardMaterial` in range paid shader cost for each of those 3 point lights
        // on every pixel. Dropping the central "fill" light and bumping ambient/hemisphere
        // slightly restores overall brightness with markedly lower fragment cost — the two
        // remaining point lights still give the brew side vs tap side their color accents.
        const ambient = new THREE.AmbientLight(0xe8dcff, 0.62);
        this.scene.add(ambient);

        const hemi = new THREE.HemisphereLight(0xffe8f8, 0x2a2438, 0.82);
        this.scene.add(hemi);

        const sun = new THREE.DirectionalLight(0xfff8f0, 1.05);
        sun.position.set(8, 22, 10);
        sun.target.position.set(0, 0, 0);
        this.scene.add(sun);
        this.scene.add(sun.target);

        sun.castShadow = false;

        const brewAccent = new THREE.PointLight(0x66ffdd, 0.34, 44);
        brewAccent.position.set(-4, 4.05, -14);
        this.scene.add(brewAccent);

        const tapAccent = new THREE.PointLight(0xffcc66, 0.3, 42);
        tapAccent.position.set(6, 3.95, 10);
        this.scene.add(tapAccent);

        this._buildNeonCeilingStrips();

        this.scene.fog = new THREE.Fog(0x1c1428, 44, 72);
    }

    /** Perimeter + zone-divider emissive strips (space-disco accent). */
    _buildNeonCeilingStrips() {
        const y = CEILING_NEON_Y;
        const t = 0.07;
        const w = 0.11;
        const HW = 17;
        const HD = 23;
        const ix = HW - 0.38;
        const iz = HD - 0.38;
        const nm = this._getNeonMaterials();

        const addStrip = (geo, px, py, pz, mat) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(px, py, pz);
            m.matrixAutoUpdate = false;
            m.updateMatrix();
            this.scene.add(m);
        };

        addStrip(new THREE.BoxGeometry(30.5, t, w), 0, y, -iz, nm[0]);
        addStrip(new THREE.BoxGeometry(11.2, t, w), -9.6, y, iz, nm[2]);
        addStrip(new THREE.BoxGeometry(11.2, t, w), 9.6, y, iz, nm[1]);
        addStrip(new THREE.BoxGeometry(w, t, 43), ix, y, 0, nm[3]);
        addStrip(new THREE.BoxGeometry(w, t, 43), -ix, y, 0, nm[1]);
        addStrip(new THREE.BoxGeometry(26, t * 0.85, w * 0.85), 0, y - 0.11, -1.4, nm[2]);
        addStrip(new THREE.BoxGeometry(8, t * 0.75, w * 0.75), -12, y - 0.11, -14, nm[3]);
        addStrip(new THREE.BoxGeometry(8, t * 0.75, w * 0.75), 12, y - 0.11, -14, nm[0]);
    }

    // ─── decorations ────────────────────────────────────────
    _buildDecorations() {
        const g = this._fg;

        const signMat = new THREE.MeshStandardMaterial({
            color: 0x241828,
            metalness: 0.52,
            roughness: 0.42,
            emissive: 0x662244,
            emissiveIntensity: 0.28,
        });
        const signY = ROOM_CEILING_Y - 0.72;
        const sign = new THREE.Mesh(g.signTaproom, signMat);
        sign.position.set(0, signY, 2.8);
        sign.userData._staticScenery = true;
        this.scene.add(sign);
        const signText = this._textSprite('ZERO-G TAPROOM', 0xffee88, 1.25);
        signText.position.set(0, signY, 2.9);
        signText.userData._staticScenery = true;
        this.scene.add(signText);

        const bsign = new THREE.Mesh(g.signBrewery, signMat.clone());
        bsign.material.emissive?.setHex?.(0x226644);
        bsign.material.emissiveIntensity = 0.22;
        bsign.position.set(0, signY, -1);
        bsign.userData._staticScenery = true;
        this.scene.add(bsign);
        const bsignText = this._textSprite('SPACE BREWERY', 0xaaffee, 1.15);
        bsignText.position.set(0, signY, -1.1);
        bsignText.userData._staticScenery = true;
        this.scene.add(bsignText);

        const shelfMat = new THREE.MeshStandardMaterial({
            color: 0x3a4a5c,
            metalness: 0.68,
            roughness: 0.36,
            envMapIntensity: 0.85,
        });
        for (let y = 1.5; y <= 2.5; y += 1) {
            const shelf = new THREE.Mesh(g.shelfPlank, shelfMat);
            shelf.position.set(16.6, y, -15);
            shelf.userData._staticScenery = true;
            this.scene.add(shelf);
        }

        const mat = new THREE.Mesh(
            g.airlockMat,
            new THREE.MeshStandardMaterial({
                color: 0x2a3548,
                metalness: 0.4,
                roughness: 0.65,
                emissive: 0xffaa00,
                emissiveIntensity: 0.1,
            })
        );
        mat.position.set(0, 0.012, 22.5);
        mat.userData._staticScenery = true;
        this.scene.add(mat);

        this._buildTaproomWallArt();
    }

    /**
     * Galactic jukebox cabinet: occupies the spot where the old "BREW MANIFEST"
     * chalkboard used to hang on the divider wall. We use the glTF template
     * loaded via AssetLoader when available, otherwise a procedural cabinet so
     * the spot never reads as empty if the download failed. An invisible hitbox
     * registers the cabinet as an `interactable` of type `jukebox`, matching
     * the same pattern used by the recipe terminal and brew stations.
     *
     * @param {number} x world-X anchor (feet of cabinet)
     * @param {number} z world-Z anchor (flush with divider wall + inset)
     */
    _buildTaproomJukebox(x, z) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        let bb = null;
        const tmpl = this.assets?.jukeboxTemplate;
        if (tmpl) {
            const juke = tmpl.clone(true);
            juke.traverse((o) => {
                if (o.isMesh) {
                    o.castShadow = false;
                    o.receiveShadow = true;
                }
            });
            juke.updateMatrixWorld(true);
            // Scale so the cabinet is ~1.9 m tall (same order as the brewer
            // avatar, reads as a proper stand-up jukebox). Source asset ships
            // at varying units depending on the Sketchfab export, so compute
            // from its own bounding box rather than hard-coding a scalar.
            const b0 = new THREE.Box3().setFromObject(juke);
            const h0 = Math.max(0.001, b0.max.y - b0.min.y);
            const targetH = 1.9;
            const s = targetH / h0;
            juke.scale.setScalar(s);
            juke.updateMatrixWorld(true);
            // Recentre feet on y=0 and XZ on the local origin, then rotate so
            // the cabinet front faces +Z (into the taproom). Sketchfab jukebox
            // exports typically ship facing -Z, so a 180° Y rotation is
            // needed; if the glTF already faces +Z the visuals still read
            // fine from behind and we would just flip in a follow-up.
            const b1 = new THREE.Box3().setFromObject(juke);
            juke.position.set(
                -(b1.min.x + b1.max.x) * 0.5,
                -b1.min.y,
                -(b1.min.z + b1.max.z) * 0.5
            );
            juke.rotation.y = Math.PI;
            group.add(juke);
            group.updateMatrixWorld(true);
            bb = new THREE.Box3().setFromObject(juke);
        } else {
            const cab = new THREE.Mesh(
                new THREE.BoxGeometry(1.1, 1.9, 0.6),
                new THREE.MeshStandardMaterial({
                    color: 0x3a2048,
                    emissive: 0xaa3388,
                    emissiveIntensity: 0.35,
                    metalness: 0.55,
                    roughness: 0.35,
                })
            );
            cab.position.y = 0.95;
            group.add(cab);
            const screen = new THREE.Mesh(
                new THREE.PlaneGeometry(0.85, 0.45),
                new THREE.MeshStandardMaterial({
                    color: 0x08141e,
                    emissive: 0x66ccff,
                    emissiveIntensity: 0.6,
                    roughness: 0.4,
                })
            );
            screen.position.set(0, 1.45, 0.31);
            group.add(screen);
            group.updateMatrixWorld(true);
            bb = new THREE.Box3().setFromObject(group);
        }

        const label = this._textSprite('JUKEBOX', 0xffccee, 0.42);
        label.position.set(0, (bb?.max?.y ?? 1.9) + 0.24, 0);
        group.add(label);

        group.userData._staticScenery = true;
        this.scene.add(group);

        // Hitbox: wrap the cabinet bounds with a small pad so [E] picks up
        // even when the player is standing off-centre. Also doubles as a
        // wall collider so you can't walk into / through the cabinet.
        const pad = 0.18;
        const hitW = Math.max(1.0, (bb.max.x - bb.min.x) + pad);
        const hitH = Math.max(1.6, (bb.max.y - bb.min.y) + pad);
        const hitD = Math.max(0.6, (bb.max.z - bb.min.z) + pad);
        const cx = (bb.min.x + bb.max.x) * 0.5;
        const cy = (bb.min.y + bb.max.y) * 0.5;
        const cz = (bb.min.z + bb.max.z) * 0.5;
        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(hitW, hitH, hitD),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.set(cx, cy, cz);
        hitbox.userData = { type: 'jukebox' };
        this.scene.add(hitbox);
        this.interactables.push(hitbox);
        this._addCollider(hitbox);
    }

    /**
     * Taproom wall dressing: three framed posters + circular "portholes" that
     * look out into deep space. The portholes share a procedural starfield
     * canvas texture and sit flush against the curved outer wall / divider
     * so the walls read as an orbital station hull rather than a flat
     * interior. No physics changes — everything here is decorative and
     * frozen into `_staticEnvMeshes` so matrices aren't rebuilt each frame.
     */
    _buildTaproomWallArt() {
        const tap = this._taproom;
        if (!tap) return;

        const posters = this.assets?.textures?.posters || {};
        const spaceTex = this._getSpaceWindowTexture();

        /**
         * Frame + glass assembly for one round porthole. The "glass" is just a
         * radial gradient + stars; the frame is an emissive torus so the
         * window reads even in dim taproom lighting.
         */
        const buildPorthole = (radius) => {
            const group = new THREE.Group();
            const disc = new THREE.Mesh(
                new THREE.CircleGeometry(radius, 40),
                new THREE.MeshBasicMaterial({
                    map: spaceTex,
                    toneMapped: false,
                    depthWrite: false,
                })
            );
            disc.position.z = 0.01;
            group.add(disc);

            const innerFrame = new THREE.Mesh(
                new THREE.TorusGeometry(radius * 1.02, radius * 0.06, 10, 40),
                new THREE.MeshStandardMaterial({
                    color: 0xc8d4e0,
                    metalness: 0.85,
                    roughness: 0.28,
                    envMapIntensity: 1.1,
                    emissive: 0x112233,
                    emissiveIntensity: 0.25,
                })
            );
            innerFrame.position.z = 0.03;
            group.add(innerFrame);

            const outerFrame = new THREE.Mesh(
                new THREE.TorusGeometry(radius * 1.15, radius * 0.05, 10, 40),
                new THREE.MeshStandardMaterial({
                    color: 0x2a3548,
                    metalness: 0.65,
                    roughness: 0.36,
                    emissive: 0x5effd4,
                    emissiveIntensity: 0.45,
                })
            );
            outerFrame.position.z = 0.02;
            group.add(outerFrame);

            const rim = new THREE.Mesh(
                new THREE.RingGeometry(radius * 1.04, radius * 1.12, 40, 1),
                new THREE.MeshBasicMaterial({
                    color: 0x101820,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                })
            );
            rim.position.z = 0.015;
            group.add(rim);

            return group;
        };

        /**
         * Build a framed poster with the given sRGB texture. Sized to the
         * taproom's eye-level wall art — ~1.1 m wide, 1.65 m tall (portrait),
         * with a thin metallic frame so it doesn't blend into the hull panels.
         */
        const buildPoster = (texture, width = 1.1, height = 1.65) => {
            const group = new THREE.Group();
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(width, height),
                new THREE.MeshBasicMaterial({
                    map: texture,
                    toneMapped: false,
                    depthWrite: false,
                })
            );
            plane.position.z = 0.02;
            group.add(plane);

            const frameMat = new THREE.MeshStandardMaterial({
                color: 0x1a2234,
                metalness: 0.72,
                roughness: 0.36,
                emissive: 0xffcc66,
                emissiveIntensity: 0.18,
            });
            const ft = 0.06; // frame thickness
            const fd = 0.04; // frame depth
            const top = new THREE.Mesh(
                new THREE.BoxGeometry(width + ft * 2, ft, fd), frameMat
            );
            top.position.set(0, height / 2 + ft / 2, 0.02);
            group.add(top);
            const bot = top.clone();
            bot.position.y = -(height / 2 + ft / 2);
            group.add(bot);
            const left = new THREE.Mesh(
                new THREE.BoxGeometry(ft, height + ft * 2, fd), frameMat
            );
            left.position.set(-(width / 2 + ft / 2), 0, 0.02);
            group.add(left);
            const right = left.clone();
            right.position.x = width / 2 + ft / 2;
            group.add(right);

            return group;
        };

        /**
         * Place `obj` flat against the inner surface of the elliptical
         * taproom wall at parameter `t` (0..π). The object's local +Z is
         * oriented toward the room interior and its position is nudged
         * slightly off the wall so it never z-fights against the hull.
         */
        const mountOnCurvedWall = (obj, t, yCenter, inwardOffset = 0.18) => {
            const rx = tap.ellipseRx;
            const rz = tap.ellipseRz;
            const wallX = rx * Math.cos(t);
            const wallZ = tap.dividerZ + rz * Math.sin(t);
            // Inward direction is the ellipse normal (x/rx², z/rz²) inverted
            // and normalised — gives a visually correct facing even though
            // the wall isn't a true circle.
            let nx = -Math.cos(t) / rx;
            let nz = -Math.sin(t) / rz;
            const nlen = Math.hypot(nx, nz) || 1;
            nx /= nlen; nz /= nlen;
            obj.position.set(wallX + nx * inwardOffset, yCenter, wallZ + nz * inwardOffset);
            // Yaw so the local +Z axis aligns with the inward normal: default
            // three.js plane/circle normal is +Z, matching our disc meshes.
            obj.rotation.y = Math.atan2(nx, nz);
        };

        const addStatic = (obj) => {
            obj.userData._staticScenery = true;
            this.scene.add(obj);
            // _freezeStaticScenery() walks every `_staticScenery` group at
            // the end of the constructor, so we don't need to append to
            // `_staticEnvMeshes` for matrix freezing here.
        };

        // Portholes along the curved wall. Entrance gap lives around t=π/2,
        // so these are spaced away from the apex on both sides.
        /** @type {Array<{ t: number, y: number, r: number }>} */
        const portholeSpots = [
            { t: 0.08 * Math.PI, y: 2.35, r: 0.62 },
            { t: 0.30 * Math.PI, y: 2.55, r: 0.78 },
            { t: 0.70 * Math.PI, y: 2.55, r: 0.78 },
            { t: 0.92 * Math.PI, y: 2.35, r: 0.62 },
        ];
        for (const spot of portholeSpots) {
            const p = buildPorthole(spot.r);
            mountOnCurvedWall(p, spot.t, spot.y, 0.16);
            addStatic(p);
        }

        // Posters — two on the curved wall (between portholes) and one on
        // the divider wall facing the taproom interior. Only added if the
        // source texture actually loaded, so a missing PNG doesn't spawn a
        // solid black rectangle.
        const curvedPosters = [
            { t: 0.20 * Math.PI, y: 2.15, texture: posters.astroBeer },
            { t: 0.80 * Math.PI, y: 2.15, texture: posters.novaLager },
        ];
        for (const p of curvedPosters) {
            if (!p.texture) continue;
            const poster = buildPoster(p.texture);
            mountOnCurvedWall(poster, p.t, p.y, 0.22);
            addStatic(poster);
        }

        // Divider wall (z = dividerZ) with flat normal facing +Z. Positioned
        // on the east half so it doesn't crowd the jukebox cabinet at x = -10.
        if (posters.astralBrew) {
            const poster = buildPoster(posters.astralBrew);
            poster.position.set(6, 2.15, tap.dividerZ + 0.19);
            // Plane default normal is +Z, which already faces the taproom.
            addStatic(poster);
        }
    }

    /**
     * Procedural starfield for the porthole "windows". Renders once, cached
     * on the World instance, and shared by every porthole mesh so we only
     * upload one texture to the GPU. Content: dark indigo vignette, scatter
     * of bright stars, a couple of nebula smudges and a faint ringed planet
     * silhouette so each window reads as "looking into space".
     */
    _getSpaceWindowTexture() {
        if (this._spaceWindowTexture) return this._spaceWindowTexture;

        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Radial vignette: deep indigo centre fading to near-black edges so
        // the disc reads as a round porthole rather than a square swatch.
        const bg = ctx.createRadialGradient(
            size * 0.5, size * 0.5, size * 0.1,
            size * 0.5, size * 0.5, size * 0.5
        );
        bg.addColorStop(0, '#1a1838');
        bg.addColorStop(0.55, '#070616');
        bg.addColorStop(1, '#020108');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);

        // Faint nebula smudges.
        const nebulae = [
            { x: 0.32, y: 0.36, r: 0.28, col: 'rgba(120, 80, 200, 0.18)' },
            { x: 0.72, y: 0.66, r: 0.32, col: 'rgba(60, 150, 220, 0.16)' },
            { x: 0.55, y: 0.22, r: 0.18, col: 'rgba(220, 120, 180, 0.12)' },
        ];
        for (const n of nebulae) {
            const g = ctx.createRadialGradient(
                n.x * size, n.y * size, 2,
                n.x * size, n.y * size, n.r * size
            );
            g.addColorStop(0, n.col);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, size, size);
        }

        // Stars — deterministic layout via a simple LCG so every porthole
        // shows the same view (they're all "looking out" through the hull).
        let seed = 1337;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 0xffffffff;
        };
        for (let i = 0; i < 320; i++) {
            const x = rand() * size;
            const y = rand() * size;
            const r = rand() * 1.2 + 0.2;
            const a = rand() * 0.7 + 0.25;
            ctx.fillStyle = `rgba(255, 245, 230, ${a})`;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // A dozen brighter "beacon" stars with a subtle halo.
        for (let i = 0; i < 12; i++) {
            const x = rand() * size;
            const y = rand() * size;
            const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ringed planet in the lower-right-ish area for visual anchoring.
        const pcx = size * 0.66;
        const pcy = size * 0.72;
        const pr = size * 0.12;
        const planetGrad = ctx.createRadialGradient(
            pcx - pr * 0.35, pcy - pr * 0.35, pr * 0.1,
            pcx, pcy, pr
        );
        planetGrad.addColorStop(0, '#f0c078');
        planetGrad.addColorStop(0.55, '#c87848');
        planetGrad.addColorStop(1, '#331810');
        ctx.fillStyle = planetGrad;
        ctx.beginPath();
        ctx.arc(pcx, pcy, pr, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(pcx, pcy);
        ctx.rotate(-0.35);
        ctx.scale(1, 0.22);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(230, 200, 150, 0.65)';
        ctx.beginPath();
        ctx.arc(0, 0, pr * 1.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 230, 190, 0.9)';
        ctx.beginPath();
        ctx.arc(0, 0, pr * 1.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this._spaceWindowTexture = tex;
        return tex;
    }
}
