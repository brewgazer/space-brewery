/**
 * First-person [E] interactions. Core movement/look stay in Player.js / main.js.
 * @param {THREE.Object3D|null} target — raycast hit (must have userData.type)
 * @param {object} ctx — gameplay systems from getPlayCtx() plus audioSystem, ui, customerSystem
 */
export function handleGameplayInteraction(target, ctx) {
    if (!target) return;
    const {
        gameState,
        world,
        player,
        audioSystem,
        brewSystem,
        fermentSystem,
        kegSystem,
        customerSystem,
        grainMillSystem,
        dryStorageSystem,
        upgradeSystem,
        ui,
    } = ctx;
    const data = target.userData;

    if (data._locked) {
        upgradeSystem.tryPurchase(data.type, data.index);
        return;
    }

    if (data.type === 'brewStation') {
        brewSystem.interact(data.index, gameState.player, player);
    } else if (data.type === 'wortDrain') {
        if (gameState.player.carrying?.type === 'wort') {
            gameState.player.carrying = null;
            audioSystem.playPour();
        } else {
            audioSystem.playError();
        }
    } else if (data.type === 'recipeShop') {
        ui.openRecipeShop();
    } else if (data.type === 'jukebox') {
        ui.openJukebox?.();
    } else if (data.type === 'fermenter') {
        fermentSystem.interact(data.index, gameState.player, player);
    } else if (data.type === 'lagerTank') {
        fermentSystem.interactLagerTank(gameState.player, player);
    } else if (data.type === 'kegStation') {
        kegSystem.interactKegStation(gameState.player, player);
    } else if (data.type === 'tap') {
        kegSystem.interactTap(data.index, gameState.player, customerSystem, player);
    } else if (data.type === 'ingredientBin') {
        const c = gameState.player.carrying;
        if (c?.type === 'bucket') {
            if (c.milled) {
                audioSystem.playError();
                ui?.showNotification?.(
                    'Milled grist goes to the brew kettle',
                    'rgba(120,40,20,0.92)',
                    2400
                );
                return;
            }
            const ids = c.ingredientIds;
            if (!Array.isArray(ids) || ids.length !== 3) {
                audioSystem.playError();
                return;
            }
            if (ids.every(Boolean)) {
                audioSystem.playError();
                return;
            }
            if (ids.includes(data.ingredientId)) {
                audioSystem.playError();
                return;
            }
            const ix = ids.findIndex((x) => x == null);
            if (ix < 0) {
                audioSystem.playError();
                return;
            }
            ids[ix] = data.ingredientId;
            audioSystem.playPickup();
            player?.playBrewerGesture?.('grabMix');
            return;
        }
        if (c) {
            audioSystem.playError();
            return;
        }
        gameState.player.carrying = { type: 'ingredient', ingredientId: data.ingredientId };
        audioSystem.playPickup();
        player?.playBrewerGesture?.('grabMix');
    } else if (data.type === 'looseGrainBucket') {
        if (data.millLocked) {
            audioSystem.playError();
            return;
        }
        if (gameState.player.carrying) {
            audioSystem.playError();
            return;
        }
        const raw = data.ingredientIds;
        const ingredientIds =
            Array.isArray(raw) && raw.length === 3
                ? [raw[0] ?? null, raw[1] ?? null, raw[2] ?? null]
                : [null, null, null];
        gameState.player.carrying = {
            type: 'bucket',
            ingredientIds,
            milled: !!data.milled,
        };
        world.removeLoosePickup(target);
        audioSystem.playPickup();
        player?.playBrewerGesture?.('grabMix');
        ui?.refreshCarryingBadge?.();
    } else if (data.type === 'looseIngredient') {
        if (gameState.player.carrying) {
            audioSystem.playError();
            return;
        }
        gameState.player.carrying = { type: 'ingredient', ingredientId: data.ingredientId };
        world.removeLoosePickup(target);
        audioSystem.playPickup();
        player?.playBrewerGesture?.('grabMix');
    } else if (data.type === 'looseMilledBatch') {
        if (gameState.player.carrying) {
            audioSystem.playError();
            return;
        }
        gameState.player.carrying = { type: 'milledBatch', ingredients: [...data.ingredients] };
        world.removeLoosePickup(target);
        audioSystem.playPickup();
        player?.playBrewerGesture?.('grabMix');
    } else if (data.type === 'grainMill') {
        grainMillSystem.interact(gameState.player, ui, player);
    } else if (data.type === 'dryStorageSlot') {
        dryStorageSystem.interact(data.rackIndex, data.slotIndex, gameState.player, ui, player);
    }
}
