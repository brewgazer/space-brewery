/**
 * Floor milled-batch lockers: only { type: 'milledBatch' } can be stored (brew-ready dry grist).
 */
export const DRY_STORAGE_SLOT_COUNT = 8;

export class DryStorageSystem {
    constructor(world, audioSystem) {
        this.world = world;
        this.audio = audioSystem;
    }

    static updateSlotVisual(rack, slotIndex) {
        const vis = rack.slotVisuals?.[slotIndex];
        if (!vis) return;
        const filled = !!rack.slots[slotIndex];
        vis.visible = filled;
    }

    static refreshRack(rack) {
        for (let s = 0; s < DRY_STORAGE_SLOT_COUNT; s++) {
            DryStorageSystem.updateSlotVisual(rack, s);
        }
    }

    static clearAll(world) {
        world.dryStorageRacks?.forEach((rack) => {
            for (let s = 0; s < DRY_STORAGE_SLOT_COUNT; s++) {
                rack.slots[s] = null;
                DryStorageSystem.updateSlotVisual(rack, s);
            }
        });
    }

    interact(rackIndex, slotIndex, player, ui, animPlayer) {
        const rack = this.world.dryStorageRacks?.[rackIndex];
        if (!rack || slotIndex < 0 || slotIndex >= DRY_STORAGE_SLOT_COUNT) return;

        const stored = rack.slots[slotIndex];

        if (player.carrying?.type === 'milledBatch') {
            if (stored) {
                this.audio.playError();
                ui?.showNotification?.('Storage slot full', 'rgba(120,40,20,0.9)', 1800);
                return;
            }
            rack.slots[slotIndex] = [...player.carrying.ingredients];
            player.carrying = null;
            DryStorageSystem.updateSlotVisual(rack, slotIndex);
            this.audio.playPickup();
            animPlayer?.playBrewerGesture?.('grabMix');
            return;
        }

        if (player.carrying) {
            this.audio.playError();
            ui?.showNotification?.(
                'Dry storage: milled batches only',
                'rgba(100,50,25,0.92)',
                2600
            );
            return;
        }

        if (stored) {
            player.carrying = { type: 'milledBatch', ingredients: [...stored] };
            rack.slots[slotIndex] = null;
            DryStorageSystem.updateSlotVisual(rack, slotIndex);
            this.audio.playPickup();
            animPlayer?.playBrewerGesture?.('grabMix');
        }
    }
}
