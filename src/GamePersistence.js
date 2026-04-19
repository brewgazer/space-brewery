import { syncTapIndicatorMaterial } from './KegSystem.js';
import { BREW_SLOTS, FERM_SLOTS, TAP_SLOTS } from './World.js';
import { DryStorageSystem, DRY_STORAGE_SLOT_COUNT } from './DryStorageSystem.js';
import { PATRON_TINT_COLORS } from './PatronColors.js';
import { RECIPES, STARTER_UNLOCKED_RECIPE_IDS } from './RecipeSystem.js';
import { LAGER_TANK_STORE_ID } from './StoreObjects.js';

/** @deprecated single-slot key; migrated when loading slot 0 */
export const LEGACY_SAVE_KEY = 'brewery_game_save_v1';

export const SAVE_SLOT_COUNT = 4;

export function saveKeyForSlot(slot) {
    return `brewery_game_save_slot_${slot}`;
}

export function hasSaveGame(slot = 0) {
    try {
        const k = saveKeyForSlot(slot);
        if (localStorage.getItem(k)) return true;
        if (slot === 0 && localStorage.getItem(LEGACY_SAVE_KEY)) return true;
        return false;
    } catch {
        return false;
    }
}

export function clearSaveGame(slot = 0) {
    try {
        localStorage.removeItem(saveKeyForSlot(slot));
        if (slot === 0) localStorage.removeItem(LEGACY_SAVE_KEY);
    } catch {
        /* ignore */
    }
}

export function saveGameToStorage(data, slot = 0) {
    try {
        localStorage.setItem(saveKeyForSlot(slot), JSON.stringify(data));
        if (slot === 0) localStorage.removeItem(LEGACY_SAVE_KEY);
        return true;
    } catch (e) {
        console.warn('Save failed', e);
        return false;
    }
}

/** After world spawns or removes the lager tank, keep brew/ferment systems in sync. */
export function syncLagerTankRefs(ctx) {
    const { world, fermentSystem, brewSystem } = ctx;
    const lt = world?.lagerTank ?? null;
    if (fermentSystem) fermentSystem.lagerTank = lt;
    if (brewSystem) brewSystem.lagerTank = lt;
}

export function loadSaveFromStorage(slot = 0) {
    try {
        let raw = localStorage.getItem(saveKeyForSlot(slot));
        if (!raw && slot === 0) raw = localStorage.getItem(LEGACY_SAVE_KEY);
        if (!raw) return null;
        const o = JSON.parse(raw);
        return o?.v === 1 || o?.v === 2 || o?.v === 3 ? o : null;
    } catch {
        return null;
    }
}

function serializeCarrying(c) {
    if (!c) return null;
    if (c.type === 'wort' || c.type === 'beer') {
        return {
            type: c.type,
            recipeId: c.recipe?.id ?? null,
            batchValid: c.batchValid !== false,
            premiumLager: c.type === 'beer' && c.premiumLager === true,
        };
    }
    if (c.type === 'ingredient') {
        return { type: 'ingredient', ingredientId: c.ingredientId };
    }
    if (c.type === 'milledBatch') {
        return { type: 'milledBatch', ingredients: [...c.ingredients] };
    }
    if (c.type === 'bucket' && Array.isArray(c.ingredientIds) && c.ingredientIds.length === 3) {
        return {
            type: 'bucket',
            ingredientIds: c.ingredientIds.map((x) => (x == null ? null : String(x))),
            milled: !!c.milled,
        };
    }
    return null;
}

export function buildSaveSnapshot(world, gameState, waveManager, grainMillSystem = null) {
    const cravingIds = (gameState.dailyCravings || []).map((c) => c.id);
    const carrying = serializeCarrying(gameState.player.carrying);

    return {
        v: 3,
        dayNumber: gameState.dayNumber,
        dailyCravings: cravingIds,
        player: {
            money: gameState.player.money,
            score: gameState.player.score,
            carrying,
            characterColorIndex: Math.min(
                PATRON_TINT_COLORS.length - 1,
                Math.max(0, gameState.playerCharacter?.colorIndex ?? 0)
            ),
        },
        unlockedRecipeIds: [...(gameState.unlockedRecipeIds || [])],
        ownedObjectIds: [...(gameState.ownedObjectIds || [])],
        equipmentPlacements: Object.fromEntries(
            Object.entries(gameState.equipmentPlacements || {}).map(([k, v]) => [
                k,
                { x: v.x, z: v.z, yaw: v.yaw ?? 0 },
            ])
        ),
        kegs: gameState.kegs.map((k) => ({
            id: k.id,
            recipeId: k.recipe?.id,
            servings: k.servings,
            batchValid: k.batchValid !== false,
            premiumLager: k.premiumLager === true,
        })),
        brew: world.brewStations.map((st) => ({
            unlocked: st.unlocked,
            state: st.state,
            recipeId: st.recipe?.id ?? null,
            progress: st.progress,
            duration: st.duration,
            milledIngredientIds:
                st.milledIngredients?.length === 3 ? [...st.milledIngredients] : null,
            batchValid: st.batchValid !== false,
        })),
        ferm: world.fermenters.map((f) =>
            f
                ? {
                      unlocked: f.unlocked,
                      state: f.state,
                      recipeId: f.recipe?.id ?? null,
                      progress: f.progress,
                      duration: f.duration,
                      speed: f.speed,
                      batchValid: f.batchValid !== false,
                  }
                : null
        ),
        lagerTank: world.lagerTank
            ? {
                  state: world.lagerTank.state,
                  recipeId: world.lagerTank.recipe?.id ?? null,
                  progress: world.lagerTank.progress,
                  duration: world.lagerTank.duration,
                  speed: world.lagerTank.speed,
                  batchValid: world.lagerTank.batchValid !== false,
              }
            : null,
        grainMill: grainMillSystem
            ? {
                  slots: grainMillSystem.slots.map((s) => s ?? null),
                  state: grainMillSystem.state,
                  progress: grainMillSystem.progress,
              }
            : null,
        dryStorage: world.dryStorageRacks?.map((rack) =>
            rack.slots.map((cell) =>
                Array.isArray(cell) && cell.length === 3 ? [...cell] : null
            )
        ),
        taps: world.taps.map((t) =>
            t
                ? {
                      unlocked: t.unlocked,
                      keg: t.keg
                          ? {
                                id: t.keg.id,
                                recipeId: t.keg.recipe?.id,
                                servings: t.keg.servings,
                                batchValid: t.keg.batchValid !== false,
                                premiumLager: t.keg.premiumLager === true,
                            }
                          : null,
                  }
                : null
        ),
        wave: waveManager.getWaveSave(),
    };
}

function applyBrewStation(st, snap, recipeSystem) {
    const recipe = snap.recipeId ? recipeSystem.getRecipeById(snap.recipeId) : null;
    st.state = snap.state || 'empty';
    st.recipe = recipe;
    st.progress = snap.progress ?? 0;
    st.duration = Math.max(0.01, snap.duration || 1);
    st.milledIngredients =
        snap.milledIngredientIds?.length === 3 ? [...snap.milledIngredientIds] : null;
    st.batchValid = snap.batchValid !== false;

    if (st.state === 'empty') {
        st.batchValid = true;
        st.liquid.visible = false;
        st.progressFill.visible = false;
        st.progressFill.scale.x = 0;
    } else if (st.state === 'brewing') {
        st.liquid.visible = true;
        if (recipe) {
            st.liquid.material.color.setHex(st.batchValid === false ? 0x4a3a28 : recipe.color);
        }
        st.progressFill.visible = true;
        const p = Math.min(1, st.progress);
        st.progressFill.scale.x = Math.max(0.001, p);
        const barWidth = 2;
        st.progressFill.position.x = -(barWidth * (1 - p)) / 2;
        st.progressFill.material.color.setHex(0x44aa44);
        st.progressFill.material.emissive.setHex(0x115511);
    } else if (st.state === 'done') {
        st.liquid.visible = true;
        if (recipe) {
            st.liquid.material.color.setHex(st.batchValid === false ? 0x3d2818 : recipe.color);
        }
        st.progressFill.visible = true;
        st.progressFill.scale.x = 1;
        st.progressFill.position.x = 0;
        if (st.batchValid === false) {
            st.progressFill.material.color.setHex(0xaa6644);
            st.progressFill.material.emissive.setHex(0x442211);
        } else {
            st.progressFill.material.color.setHex(0x44dd44);
            st.progressFill.material.emissive.setHex(0x115511);
        }
    }
}

function applyFermenter(ferm, snap, recipeSystem, fermentSystem) {
    fermentSystem._clearBubbles(ferm);
    const recipe = snap.recipeId ? recipeSystem.getRecipeById(snap.recipeId) : null;
    ferm.state = snap.state || 'empty';
    ferm.recipe = recipe;
    ferm.progress = snap.progress ?? 0;
    ferm.duration = Math.max(0.01, snap.duration || 1);
    ferm.speed = snap.speed ?? 1;
    ferm.batchValid = snap.batchValid !== false;

    if (ferm.state === 'empty') {
        ferm.batchValid = true;
        ferm.liquid.visible = false;
        ferm.progressFill.visible = false;
        ferm.progressFill.scale.x = 0;
        ferm.gauge.material.color.setHex(0x44ffcc);
        ferm.gauge.material.emissive.setHex(0x118866);
    } else if (ferm.state === 'fermenting') {
        ferm.liquid.visible = true;
        if (recipe) ferm.liquid.material.color.setHex(recipe.color);
        ferm.progressFill.visible = true;
        const p = Math.min(1, ferm.progress);
        ferm.progressFill.scale.x = Math.max(0.001, p);
        const barWidth = 1.5;
        ferm.progressFill.position.x = -(barWidth * (1 - p)) / 2;
    } else if (ferm.state === 'done') {
        ferm.liquid.visible = true;
        if (recipe) ferm.liquid.material.color.setHex(recipe.color);
        ferm.progressFill.visible = true;
        ferm.progressFill.scale.x = 1;
        ferm.progressFill.position.x = 0;
        ferm.gauge.material.color.setHex(0x44aa44);
        ferm.gauge.material.emissive.setHex(0x113311);
    }
}

function applyDryStorage(world, saved) {
    if (!world.dryStorageRacks?.length) return;
    world.dryStorageRacks.forEach((rack, i) => {
        const row = saved.dryStorage?.[i];
        for (let s = 0; s < DRY_STORAGE_SLOT_COUNT; s++) {
            const cell = row?.[s];
            rack.slots[s] =
                Array.isArray(cell) && cell.length === 3 ? [...cell] : null;
            DryStorageSystem.updateSlotVisual(rack, s);
        }
    });
}

function applyTap(tap, snap, recipeSystem) {
    if (snap.keg && snap.keg.recipeId) {
        const r = recipeSystem.getRecipeById(snap.keg.recipeId);
        if (r) {
            tap.keg = {
                recipe: r,
                servings: snap.keg.servings ?? 5,
                id: snap.keg.id ?? Date.now(),
                batchValid: snap.keg.batchValid !== false,
                premiumLager: snap.keg.premiumLager === true,
            };
            syncTapIndicatorMaterial(tap, r.color);
            return;
        }
    }
    tap.keg = null;
    syncTapIndicatorMaterial(tap, 0xff0000);
}

/**
 * @param {object} saved
 * @param {object} ctx — world, gameState, waveManager, recipeSystem, upgradeSystem,
 *   fermentSystem, kegSystem, brewSystem, customerSystem, grainMillSystem
 */
export function applySaveSnapshot(saved, ctx) {
    if (!saved || (saved.v !== 1 && saved.v !== 2 && saved.v !== 3)) return false;
    const {
        world,
        gameState,
        waveManager,
        recipeSystem,
        upgradeSystem,
        fermentSystem,
        kegSystem,
        brewSystem,
        customerSystem,
        grainMillSystem,
    } = ctx;

    customerSystem.clearAllCustomers();
    world.clearLoosePickups?.();

    gameState.dayNumber = saved.dayNumber ?? 1;
    gameState.player.money = saved.player?.money ?? 0;
    gameState.player.score = saved.player?.score ?? 0;

    const ci = saved.player?.characterColorIndex;
    gameState.playerCharacter = {
        colorIndex:
            typeof ci === 'number'
                ? Math.max(0, Math.min(PATRON_TINT_COLORS.length - 1, ci))
                : 0,
    };

    if (Array.isArray(saved.unlockedRecipeIds) && saved.unlockedRecipeIds.length > 0) {
        gameState.unlockedRecipeIds = [...new Set(saved.unlockedRecipeIds)];
    } else {
        gameState.unlockedRecipeIds = RECIPES.map((r) => r.id);
    }

    const craveIds = saved.dailyCravings || [];
    const allowed = new Set(gameState.unlockedRecipeIds);
    gameState.dailyCravings = craveIds
        .map((id) => recipeSystem.getRecipeById(id))
        .filter((r) => r && allowed.has(r.id));
    if (gameState.dailyCravings.length === 0) {
        gameState.dailyCravings = recipeSystem.generateDailyCravings(
            gameState.dayNumber,
            gameState.unlockedRecipeIds
        );
    }

    const car = saved.player?.carrying;
    if (car?.type === 'wort' || car?.type === 'beer') {
        const r = recipeSystem.getRecipeById(car.recipeId);
        if (r) {
            gameState.player.carrying = {
                type: car.type,
                recipe: r,
                batchValid: car.batchValid !== false,
                premiumLager: car.type === 'beer' && car.premiumLager === true,
            };
        } else {
            gameState.player.carrying = null;
        }
    } else if (car?.type === 'ingredient' && car.ingredientId) {
        gameState.player.carrying = { type: 'ingredient', ingredientId: car.ingredientId };
    } else if (car?.type === 'milledBatch' && Array.isArray(car.ingredients) && car.ingredients.length === 3) {
        gameState.player.carrying = { type: 'milledBatch', ingredients: [...car.ingredients] };
    } else if (car?.type === 'bucket' && Array.isArray(car.ingredientIds) && car.ingredientIds.length === 3) {
        gameState.player.carrying = {
            type: 'bucket',
            ingredientIds: car.ingredientIds.map((x) => (x == null || x === '' ? null : String(x))),
            milled: !!car.milled,
        };
    } else {
        gameState.player.carrying = null;
    }

    gameState.ownedObjectIds = Array.isArray(saved.ownedObjectIds)
        ? [...new Set(saved.ownedObjectIds.map(String))]
        : [];

    // Restore the player-chosen placements for fermenters / lager tank. Older saves
    // predate the placement system and simply have no entry here → spawns fall back
    // to the original FERM_SLOTS / hard-coded lager-tank positions.
    const placementSrc =
        saved.equipmentPlacements && typeof saved.equipmentPlacements === 'object'
            ? saved.equipmentPlacements
            : {};
    const restoredPlacements = {};
    for (const [k, v] of Object.entries(placementSrc)) {
        if (!v || typeof v !== 'object') continue;
        const x = Number(v.x);
        const z = Number(v.z);
        const yaw = Number(v.yaw ?? 0);
        if (Number.isFinite(x) && Number.isFinite(z)) {
            restoredPlacements[String(k)] = {
                x,
                z,
                yaw: Number.isFinite(yaw) ? yaw : 0,
            };
        }
    }
    gameState.equipmentPlacements = restoredPlacements;

    const ownedMigration = new Set(gameState.ownedObjectIds);
    FERM_SLOTS.forEach((slot, i) => {
        if (slot.starter || !slot.storeId) return;
        if (saved.ferm?.[i]?.unlocked) ownedMigration.add(slot.storeId);
    });
    TAP_SLOTS.forEach((slot, i) => {
        if (slot.starter || !slot.storeId) return;
        if (saved.taps?.[i]?.unlocked) ownedMigration.add(slot.storeId);
    });
    // Only migrate purchase if there was real progress (legacy saves had a visible empty tank).
    const ltSnap = saved.lagerTank;
    if (ltSnap && typeof ltSnap === 'object') {
        const st = ltSnap.state;
        const rid = ltSnap.recipeId;
        const hadProgress =
            st === 'fermenting' ||
            st === 'done' ||
            (rid != null && rid !== '');
        if (hadProgress) ownedMigration.add(LAGER_TANK_STORE_ID);
    }
    gameState.ownedObjectIds = [...ownedMigration];

    gameState.kegs = (saved.kegs || [])
        .map((k) => {
            const r = recipeSystem.getRecipeById(k.recipeId);
            if (!r) return null;
            return {
                recipe: r,
                servings: k.servings ?? 5,
                id: k.id ?? Date.now(),
                batchValid: k.batchValid !== false,
                premiumLager: k.premiumLager === true,
            };
        })
        .filter(Boolean);

    BREW_SLOTS.forEach((slot, i) => {
        const u = saved.brew?.[i]?.unlocked ?? slot.unlocked;
        upgradeSystem.syncStationUnlock('brewStation', i, u);
    });

    world.syncStoreEquipmentFromOwned?.(gameState);

    world.brewStations.forEach((st, i) => {
        if (saved.brew?.[i]) applyBrewStation(st, saved.brew[i], recipeSystem);
    });
    world.fermenters.forEach((f, i) => {
        if (f && saved.ferm?.[i]) applyFermenter(f, saved.ferm[i], recipeSystem, fermentSystem);
    });
    if (world.lagerTank && saved.lagerTank) {
        applyFermenter(world.lagerTank, saved.lagerTank, recipeSystem, fermentSystem);
    }
    world.taps.forEach((t, i) => {
        if (t && saved.taps?.[i]) applyTap(t, saved.taps[i], recipeSystem);
    });

    waveManager.setWaveSave(saved.wave);

    brewSystem.cancelSelection();
    kegSystem.cancelSelection();
    kegSystem._tapsDirty = true;
    kegSystem._updateKegVisuals();

    if (grainMillSystem && saved.grainMill?.slots && Array.isArray(saved.grainMill.slots)) {
        grainMillSystem.reset();
        grainMillSystem.slots = saved.grainMill.slots.map((s) => s || null);
        if (saved.grainMill.state === 'milling') {
            grainMillSystem.state = 'idle';
            grainMillSystem.progress = 0;
        }
    } else if (grainMillSystem) {
        grainMillSystem.reset();
    }

    applyDryStorage(world, saved);

    gameState.recipeShopOpen = false;
    gameState.jukeboxOpen = false;

    syncLagerTankRefs({ world, fermentSystem, brewSystem });

    return true;
}

export function resetToNewGame(ctx) {
    const {
        world,
        gameState,
        waveManager,
        recipeSystem,
        upgradeSystem,
        fermentSystem,
        kegSystem,
        brewSystem,
        customerSystem,
        grainMillSystem,
    } = ctx;

    customerSystem.clearAllCustomers();
    world.clearLoosePickups?.();
    grainMillSystem?.reset?.();
    DryStorageSystem.clearAll(world);

    gameState.player = { carrying: null, money: 0, score: 0 };
    gameState.kegs = [];
    gameState.dayNumber = 1;
    gameState.unlockedRecipeIds = [...STARTER_UNLOCKED_RECIPE_IDS];
    gameState.ownedObjectIds = [];
    gameState.equipmentPlacements = {};
    world.despawnPurchasedFermentersAndTaps?.();
    gameState.dailyCravings = recipeSystem.generateDailyCravings(1, gameState.unlockedRecipeIds);
    gameState.recipeShopOpen = false;
    gameState.jukeboxOpen = false;
    gameState.currentWave = 0;
    gameState.waveActive = false;
    gameState.waitingForPlayer = false;

    BREW_SLOTS.forEach((slot, i) => {
        upgradeSystem.syncStationUnlock('brewStation', i, slot.unlocked);
    });

    world.brewStations.forEach((st) => {
        applyBrewStation(
            st,
            {
                state: 'empty',
                recipeId: null,
                progress: 0,
                duration: 1,
                milledIngredientIds: null,
                batchValid: true,
            },
            recipeSystem
        );
    });
    world.fermenters.forEach((f) => {
        if (!f) return;
        applyFermenter(
            f,
            {
                state: 'empty',
                recipeId: null,
                progress: 0,
                duration: 1,
                speed: 1,
                batchValid: true,
            },
            recipeSystem,
            fermentSystem
        );
    });
    world.taps.forEach((t) => {
        if (!t) return;
        applyTap(t, { keg: null }, recipeSystem);
    });

    brewSystem.cancelSelection();
    kegSystem.cancelSelection();
    kegSystem._tapsDirty = true;
    kegSystem._updateKegVisuals();

    syncLagerTankRefs({ world, fermentSystem, brewSystem });

    waveManager.startDay();
}

/** New cravings for same day; clears sim state but keeps money and unlocks. */
export function restartCurrentDay(ctx) {
    const {
        world,
        gameState,
        waveManager,
        recipeSystem,
        fermentSystem,
        kegSystem,
        brewSystem,
        customerSystem,
        grainMillSystem,
    } = ctx;

    customerSystem.clearAllCustomers();
    gameState.player.carrying = null;
    gameState.kegs = [];
    world.clearLoosePickups?.();
    grainMillSystem?.reset?.();
    DryStorageSystem.clearAll(world);

    world.brewStations.forEach((st) => {
        applyBrewStation(
            st,
            {
                state: 'empty',
                recipeId: null,
                progress: 0,
                duration: 1,
                milledIngredientIds: null,
                batchValid: true,
            },
            recipeSystem
        );
    });
    world.fermenters.forEach((f) => {
        if (!f) return;
        applyFermenter(
            f,
            {
                state: 'empty',
                recipeId: null,
                progress: 0,
                duration: 1,
                speed: 1,
                batchValid: true,
            },
            recipeSystem,
            fermentSystem
        );
    });
    if (world.lagerTank) {
        applyFermenter(
            world.lagerTank,
            {
                state: 'empty',
                recipeId: null,
                progress: 0,
                duration: 1,
                speed: 1,
                batchValid: true,
            },
            recipeSystem,
            fermentSystem
        );
    }
    world.taps.forEach((t) => {
        if (!t) return;
        applyTap(t, { keg: null }, recipeSystem);
    });

    brewSystem.cancelSelection();
    kegSystem.cancelSelection();
    kegSystem._tapsDirty = true;
    kegSystem._updateKegVisuals();

    waveManager.restartCurrentDay();
}
