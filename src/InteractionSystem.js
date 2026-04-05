import * as THREE from 'three';

export class InteractionSystem {
    constructor(camera, interactables) {
        this.camera = camera;
        this.interactables = interactables;
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 4;
        this.currentTarget = null;
        this._ndc = new THREE.Vector2(0, 0);

        this.crosshair = document.getElementById('crosshair');
    }

    update() {
        this.raycaster.setFromCamera(this._ndc, this.camera);
        const hits = this.raycaster.intersectObjects(this.interactables);

        if (hits.length > 0) {
            this.currentTarget = hits[0].object;
            if (this.crosshair) this.crosshair.classList.add('active');
        } else {
            this.currentTarget = null;
            if (this.crosshair) this.crosshair.classList.remove('active');
        }
    }
}
