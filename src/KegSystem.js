import * as THREE from 'three';

export class KegSystem {
    constructor(scene, kegStation, taps, gameState, audioSystem) {
        this.scene = scene;
        this.kegStation = kegStation;
        this.taps = taps;
        this.gameState = gameState;
        this.audio = audioSystem;
        this.selectingKeg = null;
        this.maxServingsPerKeg = 5;
        this._tapsDirty = false;
    }

    interactKegStation(player) {
        if (player.carrying && player.carrying.type === 'beer') {
            const keg = {
                recipe: player.carrying.recipe,
                servings: this.maxServingsPerKeg,
                id: Date.now()
            };
            this.gameState.kegs.push(keg);
            player.carrying = null;
            this.audio.playKeg();
            this._updateKegVisuals();
            return;
        }

        if (!player.carrying) {
            this.audio.playError();
        }
    }

    interactTap(tapIndex, player, customerSystem) {
        const tap = this.taps[tapIndex];
        if (!tap || !tap.unlocked) return;

        // If tap has a keg loaded, serve a customer
        if (tap.keg) {
            const served = customerSystem.serveCustomer(tap.keg.recipe);
            if (served) {
                tap.keg.servings--;
                this._tapsDirty = true;
                this.audio.playServe();

                if (tap.keg.servings <= 0) {
                    tap.keg = null;
                    tap.knob.material.color.setHex(0xff0000);
                }
                return;
            } else {
                this.audio.playError();
                return;
            }
        }

        // If tap empty and kegs available, let player assign one
        if (!tap.keg && this.gameState.kegs.length > 0) {
            this.selectingKeg = tapIndex;
            return;
        }

        this.audio.playError();
    }

    selectKeg(kegIndex) {
        if (this.selectingKeg === null) return;
        if (kegIndex >= this.gameState.kegs.length) {
            this.selectingKeg = null;
            return;
        }

        const keg = this.gameState.kegs.splice(kegIndex, 1)[0];
        const tap = this.taps[this.selectingKeg];
        tap.keg = keg;
        tap.knob.material.color.setHex(keg.recipe.color);
        this._tapsDirty = true;
        this._updateKegVisuals();
        this.audio.playKeg();
        this.selectingKeg = null;
    }

    untapKeg(tapIndex) {
        const tap = this.taps[tapIndex];
        if (!tap || !tap.unlocked || !tap.keg) return false;
        if (tap.keg.servings < this.maxServingsPerKeg) return false;

        this.gameState.kegs.push(tap.keg);
        tap.keg = null;
        tap.knob.material.color.setHex(0xff0000);
        this._tapsDirty = true;
        this._updateKegVisuals();
        this.audio.playKeg();
        return true;
    }

    cancelSelection() {
        this.selectingKeg = null;
    }

    _updateTapLabel(tap, index) {
        // Remove old label, create new one
        const parent = tap.label.parent;
        const pos = tap.label.position.clone();
        parent.remove(tap.label);

        const text = tap.keg ? `${tap.keg.recipe.name} (${tap.keg.servings})` : `Tap ${index + 1}`;
        const color = tap.keg ? 0xffdd44 : 0xcccccc;
        tap.label = this._createTextSprite(text, color);
        tap.label.position.copy(pos);
        parent.add(tap.label);
    }

    updateTapLabels() {
        if (!this._tapsDirty) return;
        this._tapsDirty = false;
        this.taps.forEach((tap, i) => { if (tap.unlocked) this._updateTapLabel(tap, i); });
    }

    _updateKegVisuals() {
        // Clear old keg meshes
        this.kegStation.kegMeshes.forEach(m => this.scene.remove(m));
        this.kegStation.kegMeshes = [];

        // Show kegs on rack
        this.gameState.kegs.forEach((keg, i) => {
            const mesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10),
                new THREE.MeshStandardMaterial({
                    color: 0xc8c8d0,
                    metalness: 0.62,
                    roughness: 0.34,
                    envMapIntensity: 1.0,
                })
            );
            mesh.rotation.x = Math.PI / 2;
            mesh.position.set(
                8.5 + (i % 4) * 0.6,
                0.4 + Math.floor(i / 4) * 0.6,
                -1
            );
            this.scene.add(mesh);
            this.kegStation.kegMeshes.push(mesh);

            // Color band showing beer type
            const band = new THREE.Mesh(
                new THREE.CylinderGeometry(0.21, 0.21, 0.15, 10),
                new THREE.MeshStandardMaterial({
                    color: keg.recipe.color,
                    metalness: 0.15,
                    roughness: 0.45,
                    envMapIntensity: 0.55,
                })
            );
            band.rotation.x = Math.PI / 2;
            band.position.copy(mesh.position);
            this.scene.add(band);
            this.kegStation.kegMeshes.push(band);
        });
    }

    _createTextSprite(text, color = 0xffffff) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const hex = '#' + new THREE.Color(color).getHexString();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(text, 128, 32);
        ctx.fillStyle = hex;
        ctx.fillText(text, 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.5, 0.4, 1);
        return sprite;
    }
}
