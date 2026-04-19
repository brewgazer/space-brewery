import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Shared smooth / rounded geometries for taproom & brewery props (no extra GLB downloads).
 * Matches the “designed low-poly” look of the robot patrons.
 */
let _geoms = null;

function tagShared(g) {
    if (g) g.userData.shared = true;
    return g;
}

export function getFurnitureGeometries() {
    if (_geoms) return _geoms;

    const tablePedestalProfile = [
        new THREE.Vector2(0.015, 0),
        new THREE.Vector2(0.16, 0.018),
        new THREE.Vector2(0.12, 0.12),
        new THREE.Vector2(0.065, 0.32),
        new THREE.Vector2(0.095, 0.68),
        new THREE.Vector2(0.055, 0.705),
        new THREE.Vector2(0.085, 0.74),
    ];

    const boothTableLegProfile = [
        new THREE.Vector2(0.02, 0),
        new THREE.Vector2(0.1, 0.02),
        new THREE.Vector2(0.055, 0.32),
        new THREE.Vector2(0.08, 0.68),
        new THREE.Vector2(0.045, 0.72),
    ];

    const hydroPotProfile = [
        new THREE.Vector2(0.01, 0),
        new THREE.Vector2(0.2, 0.04),
        new THREE.Vector2(0.22, 0.18),
        new THREE.Vector2(0.18, 0.38),
        new THREE.Vector2(0.14, 0.42),
    ];

    const barStoolProfile = [
        new THREE.Vector2(0.02, 0),
        new THREE.Vector2(0.14, 0.022),
        new THREE.Vector2(0.09, 0.18),
        new THREE.Vector2(0.054, 0.42),
        new THREE.Vector2(0.085, 0.58),
        new THREE.Vector2(0.048, 0.64),
    ];

    _geoms = {
        tableTop: tagShared(new THREE.CylinderGeometry(0.72, 0.735, 0.048, 20, 1)),
        tablePedestal: tagShared(new THREE.LatheGeometry(tablePedestalProfile, 22)),
        tableFoot: tagShared(new THREE.CylinderGeometry(0.4, 0.44, 0.04, 20)),
        tableEdgeRing: tagShared(new THREE.TorusGeometry(0.73, 0.018, 6, 24)),

        chairSeat: tagShared(new RoundedBoxGeometry(0.44, 0.12, 0.44, 4, 0.06)),
        chairCushion: tagShared(new RoundedBoxGeometry(0.38, 0.05, 0.38, 3, 0.04)),
        chairBack: tagShared(new RoundedBoxGeometry(0.42, 0.52, 0.08, 4, 0.05)),
        chairLeg: tagShared(new THREE.CapsuleGeometry(0.032, 0.095, 4, 8)),

        boothTableTop: tagShared(new RoundedBoxGeometry(2.35, 0.055, 0.78, 4, 0.045)),
        boothTablePedestal: tagShared(new THREE.LatheGeometry(boothTableLegProfile, 16)),

        barStoolSeat: tagShared(new THREE.CylinderGeometry(0.27, 0.24, 0.1, 16, 1)),
        barStoolPedestal: tagShared(new THREE.LatheGeometry(barStoolProfile, 16)),
        barStoolFoot: tagShared(new THREE.TorusGeometry(0.22, 0.022, 6, 20)),

        holoBoard: tagShared(new THREE.CylinderGeometry(0.46, 0.46, 0.055, 28, 1)),
        holoRingOuter: tagShared(new THREE.TorusGeometry(0.44, 0.028, 8, 28)),
        holoRingMid: tagShared(new THREE.TorusGeometry(0.3, 0.022, 8, 24)),
        holoRingInner: tagShared(new THREE.TorusGeometry(0.16, 0.018, 6, 20)),
        holoBull: tagShared(new THREE.SphereGeometry(0.065, 12, 10)),

        menuPanel: tagShared(new RoundedBoxGeometry(0.09, 1.22, 2.38, 3, 0.035)),
        menuFrame: tagShared(new RoundedBoxGeometry(0.07, 1.34, 2.52, 3, 0.04)),

        pendantCord: tagShared(new THREE.CylinderGeometry(0.018, 0.018, 1.12, 12, 1)),
        pendantShade: tagShared(new THREE.SphereGeometry(0.19, 16, 12)),

        hydroPot: tagShared(new THREE.LatheGeometry(hydroPotProfile, 16)),
        hydroFluid: tagShared(new THREE.SphereGeometry(0.29, 16, 12)),

        crate: tagShared(new RoundedBoxGeometry(0.86, 0.88, 0.86, 3, 0.045)),
        crateBand: tagShared(new THREE.TorusGeometry(0.36, 0.014, 6, 24)),

        signTaproom: tagShared(new RoundedBoxGeometry(8.05, 0.78, 0.09, 4, 0.06)),
        signBrewery: tagShared(new RoundedBoxGeometry(6.55, 0.62, 0.09, 4, 0.055)),
        shelfPlank: tagShared(new RoundedBoxGeometry(0.28, 0.085, 3.02, 2, 0.018)),
        airlockMat: tagShared(new RoundedBoxGeometry(4.02, 0.028, 1.52, 2, 0.03)),
    };

    return _geoms;
}
