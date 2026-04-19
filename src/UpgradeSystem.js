import * as THREE from 'three';

const LOCK_DIM = {
    brewStation: { w: 2.5, h: 2.4, d: 2, y: 1.2 },
    fermenter: { w: 1.4, h: 3.4, d: 1.4, y: 1.7 },
    tap: { w: 1, h: 1, d: 0.6, y: 0.5 },
};

export class UpgradeSystem {
    constructor(world, gameState, audioSystem, ui) {
        this.world = world;
        this.gameState = gameState;
        this.audio = audioSystem;
        this.ui = ui;
    }

    tryPurchase(type, index) {
        const station = this._getStation(type, index);
        if (!station || station.unlocked) return false;

        const cost = station.cost;
        if (this.gameState.player.money >= cost) {
            this.gameState.player.money -= cost;
            this._unlock(station, type, index);
            this.audio.playCashRegister();
            this.ui.showNotification(
                `Purchased! (-$${cost})`,
                'rgba(20,80,20,0.9)', 2000
            );
            return true;
        } else {
            this.audio.playError();
            this.ui.showNotification(
                `Need $${cost} (have $${this.gameState.player.money})`,
                'rgba(120,20,20,0.9)', 1500
            );
            return false;
        }
    }

    _getStation(type, index) {
        if (type === 'brewStation') return this.world.brewStations[index];
        if (type === 'fermenter') return this.world.fermenters[index];
        if (type === 'tap') return this.world.taps[index];
        return null;
    }

    _unlock(station, type, index) {
        station.unlocked = true;

        // Remove lock overlay and label
        if (station.lockOverlay) {
            station.group.remove(station.lockOverlay);
            station.lockOverlay.geometry?.dispose?.();
            station.lockOverlay.material?.dispose?.();
            station.lockOverlay = null;
        }
        if (station.lockLabel) {
            station.group.remove(station.lockLabel);
            station.lockLabel.material?.map?.dispose?.();
            station.lockLabel.material?.dispose?.();
            station.lockLabel = null;
        }

        // Restore the name label
        if (station.label) {
            const parent = station.label.parent;
            const pos = station.label.position.clone();
            parent.remove(station.label);
            station.label.material?.map?.dispose?.();
            station.label.material?.dispose?.();

            let name;
            if (type === 'brewStation') name = `Reactor ${index + 1}`;
            else if (type === 'fermenter') name = `Bio-Tank ${index + 1}`;
            else name = `Tap ${index + 1}`;

            station.label = this._textSprite(name, 0xffffff);
            station.label.position.copy(pos);
            parent.add(station.label);
        }
    }

    _addLockOverlay(station, type) {
        const dim = LOCK_DIM[type];
        if (!dim) return;
        const overlay = new THREE.Mesh(
            new THREE.BoxGeometry(dim.w + 0.15, dim.h + 0.15, dim.d + 0.15),
            new THREE.MeshStandardMaterial({
                color: 0x181818,
                transparent: true,
                opacity: 0.55,
                depthWrite: false,
            })
        );
        overlay.position.y = dim.y;
        overlay.renderOrder = 1;
        station.group.add(overlay);
        const lockLabel = this._textSprite(`LOCKED  $${station.cost}`, 0xff6644, 0.8);
        lockLabel.position.y = dim.y + dim.h / 2 + 0.35;
        station.group.add(lockLabel);
        station.lockOverlay = overlay;
        station.lockLabel = lockLabel;
    }

    /** Match saved or default progression without spending money. */
    syncStationUnlock(type, index, shouldUnlock) {
        const station = this._getStation(type, index);
        if (!station) return;
        if (shouldUnlock && !station.unlocked) {
            this._unlock(station, type, index);
        } else if (!shouldUnlock && station.unlocked) {
            station.unlocked = false;
            if (station.lockOverlay) {
                station.group.remove(station.lockOverlay);
                station.lockOverlay.geometry?.dispose?.();
                station.lockOverlay.material?.dispose?.();
                station.lockOverlay = null;
            }
            if (station.lockLabel) {
                station.group.remove(station.lockLabel);
                station.lockLabel.material?.map?.dispose?.();
                station.lockLabel.material?.dispose?.();
                station.lockLabel = null;
            }
            this._addLockOverlay(station, type);
        }
    }

    _textSprite(text, color = 0xffffff) {
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
        s.scale.set(2, 0.5, 1);
        return s;
    }
}
