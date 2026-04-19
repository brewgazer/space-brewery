import * as THREE from 'three';

const MAX_BUBBLES_PER_FERM = 4;

export class FermentSystem {
    constructor(scene, fermenters, lagerTank, gameState, audioSystem) {
        this.scene = scene;
        this.fermenters = fermenters;
        /** @type {object | null} */
        this.lagerTank = lagerTank;
        this.gameState = gameState;
        this.audio = audioSystem;
        this.time = 0;

        this._bubbleGeo = new THREE.SphereGeometry(0.035, 3, 2);
        this._bubblePool = [];
        this._cStart = new THREE.Color();
        this._cEnd = new THREE.Color();
    }

    _acquireBubbleMesh() {
        let mesh = this._bubblePool.pop();
        if (!mesh) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.55,
                depthWrite: false
            });
            mesh = new THREE.Mesh(this._bubbleGeo, mat);
        }
        mesh.material.opacity = 0.55;
        mesh.visible = true;
        this.scene.add(mesh);
        return mesh;
    }

    _releaseBubbleMesh(mesh) {
        mesh.visible = false;
        this.scene.remove(mesh);
        if (this._bubblePool.length < 48) this._bubblePool.push(mesh);
    }

    interact(fermenterIndex, player, animPlayer) {
        const ferm = this.fermenters[fermenterIndex];
        if (!ferm?.unlocked) return;

        if (ferm.state === 'empty' && player.carrying && player.carrying.type === 'wort') {
            ferm.state = 'fermenting';
            ferm.recipe = player.carrying.recipe;
            ferm.batchValid = player.carrying.batchValid !== false;
            ferm.progress = 0;
            ferm._gaugeBand = -1;
            ferm._speedJitterT = 0;
            ferm.duration = ferm.recipe.fermentTime * (0.85 + Math.random() * 0.3);
            ferm.speed = 0.8 + Math.random() * 0.4;
            ferm.liquid.visible = true;
            ferm.liquid.material.color.setHex(ferm.recipe.color);
            ferm.progressFill.visible = true;
            player.carrying = null;
            this.audio.playPour();
            animPlayer?.playBrewerGesture?.('pour');
            return;
        }

        if (ferm.state === 'done' && !player.carrying) {
            const bv = ferm.batchValid !== false;
            player.carrying = { type: 'beer', recipe: ferm.recipe, batchValid: bv, premiumLager: false };
            ferm.state = 'empty';
            ferm.recipe = null;
            ferm.batchValid = true;
            ferm.progress = 0;
            ferm._gaugeBand = -1;
            ferm.liquid.visible = false;
            ferm.progressFill.visible = false;
            ferm.progressFill.scale.x = 0;
            ferm.gauge.material.color.setHex(0x44aa44);
            ferm.gauge.material.emissive.setHex(0x113311);
            this._clearBubbles(ferm);
            this.audio.playPickup();
            animPlayer?.playBrewerGesture?.('grabWort');
            return;
        }

        if (ferm.state === 'fermenting') {
            this.audio.playError();
        }
    }

    interactLagerTank(player, animPlayer) {
        const ferm = this.lagerTank;
        if (!ferm) return;

        if (ferm.state === 'empty' && player.carrying && player.carrying.type === 'wort') {
            if (player.carrying.recipe?.id !== 'lager') {
                this.audio.playError();
                return;
            }
            ferm.state = 'fermenting';
            ferm.recipe = player.carrying.recipe;
            ferm.batchValid = player.carrying.batchValid !== false;
            ferm.progress = 0;
            ferm._gaugeBand = -1;
            ferm._speedJitterT = 0;
            ferm.duration = ferm.recipe.fermentTime * (0.85 + Math.random() * 0.3) * 0.92;
            ferm.speed = 0.85 + Math.random() * 0.35;
            ferm.liquid.visible = true;
            ferm.liquid.material.color.setHex(ferm.recipe.color);
            ferm.progressFill.visible = true;
            player.carrying = null;
            this.audio.playPour();
            animPlayer?.playBrewerGesture?.('pour');
            return;
        }

        if (ferm.state === 'done' && !player.carrying) {
            const bv = ferm.batchValid !== false;
            player.carrying = {
                type: 'beer',
                recipe: ferm.recipe,
                batchValid: bv,
                premiumLager: true,
            };
            ferm.state = 'empty';
            ferm.recipe = null;
            ferm.batchValid = true;
            ferm.progress = 0;
            ferm._gaugeBand = -1;
            ferm.liquid.visible = false;
            ferm.progressFill.visible = false;
            ferm.progressFill.scale.x = 0;
            ferm.gauge.material.color.setHex(0x44aa44);
            ferm.gauge.material.emissive.setHex(0x113311);
            this._clearBubbles(ferm);
            this.audio.playPickup();
            animPlayer?.playBrewerGesture?.('grabWort');
            return;
        }

        if (ferm.state === 'fermenting') {
            this.audio.playError();
        }
    }

    update(delta) {
        this.time += delta;

        // Was allocating a fresh spread/filter array every frame — pure GC churn.
        for (let i = 0; i < this.fermenters.length; i++) {
            const ferm = this.fermenters[i];
            if (ferm && ferm.unlocked) this._tickFermenter(ferm, delta);
        }
        if (this.lagerTank) this._tickFermenter(this.lagerTank, delta);
    }

    _tickFermenter(ferm, delta) {
        if (ferm.state === 'fermenting') {
                ferm._speedJitterT = (ferm._speedJitterT || 0) + delta;
                if (ferm._speedJitterT >= 0.35) {
                    ferm._speedJitterT = 0;
                    if (Math.random() < 0.18) {
                        ferm.speed = 0.7 + Math.random() * 0.6;
                    }
                }

                ferm.progress += (delta * ferm.speed) / ferm.duration;

                if (ferm.progress >= 1) {
                    ferm.progress = 1;
                    ferm.state = 'done';
                    ferm._gaugeBand = -1;
                    this.audio.playFermentComplete();
                }

                ferm.progressFill.scale.x = Math.max(0.001, ferm.progress);
                const barWidth = 1.5;
                ferm.progressFill.position.x = -(barWidth * (1 - ferm.progress)) / 2;

                this._cStart.set(0xddaa33);
                this._cEnd.set(ferm.recipe.color);
                ferm.liquid.material.color.copy(this._cStart.lerp(this._cEnd, ferm.progress));
                ferm.liquid.material.opacity = 0.4 + ferm.progress * 0.4;

                const gBand = ferm.progress < 0.5 ? 0 : ferm.progress < 0.9 ? 1 : 2;
                if (gBand !== ferm._gaugeBand) {
                    ferm._gaugeBand = gBand;
                    if (gBand === 0) {
                        ferm.gauge.material.color.setHex(0xaaaa22);
                        ferm.gauge.material.emissive.setHex(0x333300);
                    } else if (gBand === 1) {
                        ferm.gauge.material.color.setHex(0xdd8800);
                        ferm.gauge.material.emissive.setHex(0x442200);
                    }
                }

                this._cStart.set(0xdd8800);
                this._cEnd.set(0x44aa44);
                ferm.progressFill.material.color.copy(this._cStart.lerp(this._cEnd, ferm.progress));

                this._updateBubbles(ferm, delta);
            }

        if (ferm.state === 'done') {
            ferm.gauge.material.color.setHex(0x44dd44);
            ferm.gauge.material.emissive.setRGB(
                0.1,
                0.4 + Math.sin(this.time * 5) * 0.2,
                0.1
            );
            const restY = ferm.liquidRestY ?? 1.5;
            ferm.liquid.position.y = restY + Math.sin(this.time * 2) * 0.02;
        }
    }

    _updateBubbles(ferm, delta) {
        const bubbleRate = (0.08 + ferm.progress * 0.14) * 0.65;
        if (ferm.bubbles.length < MAX_BUBBLES_PER_FERM && Math.random() < bubbleRate * delta) {
            this._spawnBubble(ferm);
        }

        for (let i = ferm.bubbles.length - 1; i >= 0; i--) {
            const b = ferm.bubbles[i];
            b.mesh.position.y += delta * b.rise;
            b.mesh.position.x += Math.sin(this.time * 3 + b.offset) * delta * 0.08;
            b.life -= delta;
            const t = b.life / b.maxLife;
            b.mesh.material.opacity = Math.max(0, t * 0.55);
            const s = 0.85 + (1 - t) * 0.35;
            b.mesh.scale.setScalar(s);

            if (b.life <= 0) {
                this._releaseBubbleMesh(b.mesh);
                ferm.bubbles.splice(i, 1);
            }
        }
    }

    _spawnBubble(ferm) {
        const mesh = this._acquireBubbleMesh();
        const bubbleY =
            typeof ferm.bubbleSpawnWorldY === 'number'
                ? ferm.bubbleSpawnWorldY
                : ferm.position.y + 3.1;
        mesh.position.set(
            ferm.position.x + (Math.random() - 0.5) * 0.8,
            bubbleY,
            ferm.position.z + (Math.random() - 0.5) * 0.8
        );
        mesh.scale.setScalar(1);
        const life = 0.9 + Math.random() * 1.1;
        ferm.bubbles.push({
            mesh,
            life,
            maxLife: life,
            offset: Math.random() * Math.PI * 2,
            rise: 0.45 + Math.random() * 0.35
        });
    }

    _clearBubbles(ferm) {
        ferm.bubbles.forEach(b => this._releaseBubbleMesh(b.mesh));
        ferm.bubbles = [];
    }
}
