import * as THREE from 'three';
import { Player } from './src/Player.js';
import { World } from './src/World.js';
import { InteractionSystem } from './src/InteractionSystem.js';
import { BrewSystem } from './src/BrewSystem.js';
import { FermentSystem } from './src/FermentSystem.js';
import { KegSystem } from './src/KegSystem.js';
import { CustomerSystem } from './src/CustomerSystem.js';
import { WaveManager } from './src/WaveManager.js';
import { RecipeSystem } from './src/RecipeSystem.js';
import { RecipeManager } from './src/RecipeManager.js';
import { GrainMill } from './src/GrainMill.js';
import { UI } from './src/UI.js';
import { AudioSystem } from './src/AudioSystem.js';
import { UpgradeSystem } from './src/UpgradeSystem.js';
import { PlacementSystem } from './src/PlacementSystem.js';
import { loadGameAssets } from './src/AssetLoader.js';
import {
    hasSaveGame,
    clearSaveGame,
    saveGameToStorage,
    loadSaveFromStorage,
    buildSaveSnapshot,
    applySaveSnapshot,
    resetToNewGame,
    restartCurrentDay,
    syncLagerTankRefs,
} from './src/GamePersistence.js';
import { PATRON_TINT_COLORS } from './src/PatronColors.js';
import { hasUnlockedEmptyFermenter } from './src/FermentUtil.js';
import { handleGameplayInteraction } from './src/PlayerInteraction.js';
import { DryStorageSystem } from './src/DryStorageSystem.js';
import { getStoreObjectDef, STORE_OBJECT_DEFS } from './src/StoreObjects.js';
import { NetManager } from './src/net/NetManager.js';
import { RemotePlayer } from './src/net/RemotePlayer.js';

window.addEventListener('unhandledrejection', (ev) => {
    console.error(ev.reason);
    const el = document.getElementById('loading-line');
    if (el && !window.__brewGameReady) {
        const msg = ev.reason?.message || String(ev.reason || 'Unknown error');
        el.textContent = `Startup error: ${msg} — check console (F12). Try Ctrl+Shift+R to hard-refresh.`;
    }
});

// --- Renderer (tuned for smooth play on typical hardware) ---
const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.68;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.pointerEvents = 'none';

// --- Scene & Camera ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x100818);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 80);

// --- Game State ---
const gameState = {
    started: false,
    paused: false,
    _pointerLockFailed: false,
    player: { carrying: null, money: 0, score: 0 },
    kegs: [],
    dailyCravings: [],
    currentWave: 0,
    dayNumber: 1,
    waveActive: false,
    waitingForPlayer: false,
    saveSlot: 0,
    playerCharacter: { colorIndex: 0 },
    pendingCharacterColorIndex: 0,
    /** Recipe ids the player has purchased — cravings only draw from this set. */
    unlockedRecipeIds: ['lager'],
    /** Store tools bought at the supply terminal (e.g. grain bucket). */
    ownedObjectIds: [],
    /**
     * Player-chosen world positions for placeable equipment (fermenters, lager tank).
     * Keyed by the StoreObjects id (e.g. `fermenter_slot_2`, `lager_tank`).
     * Set by PlacementSystem on purchase; consumed by World spawn methods on load.
     */
    equipmentPlacements: {},
    /** Supply terminal UI: 'home' | 'recipes' | 'tools' */
    supplyTerminalView: 'home',
    /** True while recipe kiosk is open — avoids treating pointer unlock as pause. */
    recipeShopOpen: false,
};
window.gameState = gameState;

const recipeSystem = new RecipeSystem();
const recipeManager = new RecipeManager();
const audioSystem = new AudioSystem();
const ui = new UI(gameState, recipeManager);
ui.attachAudio(audioSystem);

/**
 * Multiplayer.
 *
 * Transport-agnostic manager held at module scope so the animate() loop can
 * publish the local player's pose and remote avatars are updated in lockstep
 * with the renderer. `remotePlayers` is keyed by peerId; entries are created
 * lazily the first time we see that peer's state.
 *
 * Note: world state (kegs, fermenters, customers, money) is still per-tab.
 * This pass establishes connectivity + visible avatars so the Find Game UI
 * and local cross-tab tests work. Authoritative world sync is a follow-up.
 */
const netManager = new NetManager();
window.__brewNet = netManager; // handy for console debugging
/** @type {Map<string, RemotePlayer>} */
const remotePlayers = new Map();

/**
 * UI wizard state — gathers the user's multiplayer choices before calling
 * beginPlaySession. Reset whenever we return to the title.
 */
const pendingSession = {
    mode: 'offline',          // 'offline' | 'local' | 'online'
    role: 'offline',          // 'offline' | 'host' | 'join'
    hostServerName: '',
    joinTarget: null,         // { id, name, hostName, mode } when joining
    fromSave: false,
};

function resetPendingSession() {
    pendingSession.mode = 'offline';
    pendingSession.role = 'offline';
    pendingSession.hostServerName = '';
    pendingSession.joinTarget = null;
    pendingSession.fromSave = false;
}

let gameReady = false;
let world;
let player;
let interactionSystem;
let brewSystem;
let fermentSystem;
let kegSystem;
let customerSystem;
let waveManager;
let upgradeSystem;
let placementSystem;
let grainMillSystem;
let dryStorageSystem;
let brewHitboxes;
let fermHitboxes;
let tapHitboxes;

/** Patron GLB + textures (for player avatar). */
let gameAssetBucket = null;

async function primeAudioIfNeeded() {
    audioSystem.init();
    await audioSystem.loadGameAudio();
}

async function ensureAudioStarted() {
    await primeAudioIfNeeded();
    audioSystem.startGameBackgroundMusic();
}

/** First interactions on the main menu (not straight into a session) start title BGM. */
async function tryPrimeTitleMenuMusic(e) {
    if (gameState.started) return;
    const t = e?.target;
    if (t?.closest?.('#btn-continue') || t?.closest?.('#btn-character-start')) return;
    if (audioSystem.isTitleMenuBgmActive()) {
        audioSystem.resumeBackgroundMusic();
        return;
    }
    await primeAudioIfNeeded();
    if (gameState.started) return;
    audioSystem.startTitleBackgroundMusic();
}

function getPlayCtx() {
    return {
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
        dryStorageSystem,
    };
}

/**
 * Footprint (in metres) for the blinking placement ghost for equipment the player
 * gets to position manually. Must enclose the spawned GLB / fallback mesh so the
 * collision probe matches reality.
 */
const PLACEMENT_FOOTPRINT = {
    fermenter: { w: 1.9, h: 3.3, d: 1.9 },
    lagerTank: { w: 2.9, h: 3.0, d: 2.9 },
};

/** Brewery-side placement bounds (north of the dividing wall at z=0). */
const BREWERY_PLACEMENT_BOUNDS = {
    minX: -16,
    maxX: 16,
    minZ: -22,
    maxZ: -0.8,
};

function tryBuyStoreObject(objectId) {
    const def = getStoreObjectDef(objectId);
    if (!def) return false;
    const owned = gameState.ownedObjectIds || (gameState.ownedObjectIds = []);
    if (owned.includes(objectId)) {
        audioSystem.playError();
        ui.showNotification('You already own this', 'rgba(120,40,40,0.92)', 2000);
        return false;
    }
    const cost = def.cost ?? 0;
    if (gameState.player.money < cost) {
        audioSystem.playError();
        ui.showNotification(`Need $${cost} for ${def.name}`, 'rgba(120,40,40,0.92)', 2000);
        return false;
    }

    const needsPlacement =
        (def.equipment === 'fermenter' && typeof def.slotIndex === 'number') ||
        def.equipment === 'lagerTank';
    if (needsPlacement && placementSystem) {
        beginEquipmentPlacement(def);
        return true;
    }

    gameState.player.money -= cost;
    owned.push(objectId);
    audioSystem.playCashRegister();
    ui.showNotification(`Purchased: ${def.name} (-$${cost})`, 'rgba(30,90,50,0.92)', 2200);
    ui.refreshRecipeShopContent();
    if (world) {
        world.syncOwnedStorePickups?.(gameState, gameAssetBucket);
        if (def.equipment === 'tap' && typeof def.slotIndex === 'number') {
            world.spawnTapFromStore?.(def.slotIndex, { popIn: true });
        }
        buildHitboxCaches();
        syncInteractableState();
        kegSystem._tapsDirty = true;
        kegSystem._updateKegVisuals();
    }
    return true;
}

/**
 * Funds are already verified at this point. Close the supply terminal, return
 * pointer-lock control to the player so they can aim, and hand off to the
 * PlacementSystem. Money is only spent if the player confirms a valid spot.
 */
function beginEquipmentPlacement(def) {
    if (ui.isRecipeShopOpen()) {
        ui.closeRecipeShop();
    }
    player?.lock();

    const footprint =
        def.equipment === 'lagerTank'
            ? PLACEMENT_FOOTPRINT.lagerTank
            : PLACEMENT_FOOTPRINT.fermenter;

    placementSystem.start({
        type: def.equipment,
        label: def.name,
        footprint,
        bounds: BREWERY_PLACEMENT_BOUNDS,
        onConfirm: ({ x, z, yaw }) => finalizeEquipmentPurchase(def, { x, z, yaw }),
        onCancel: () => {
            ui.showNotification(
                `Placement cancelled — ${def.name} not purchased.`,
                'rgba(80,60,30,0.92)',
                1800
            );
        },
    });
}

function finalizeEquipmentPurchase(def, transform) {
    const cost = def.cost ?? 0;
    if (gameState.player.money < cost) {
        audioSystem.playError();
        ui.showNotification(
            `Lost funds during placement — ${def.name} not purchased.`,
            'rgba(120,40,40,0.92)',
            2200
        );
        return;
    }

    const owned = gameState.ownedObjectIds || (gameState.ownedObjectIds = []);
    if (owned.includes(def.id)) return; // double-click guard
    gameState.player.money -= cost;
    owned.push(def.id);

    const placements =
        gameState.equipmentPlacements || (gameState.equipmentPlacements = {});
    placements[def.id] = { x: transform.x, z: transform.z, yaw: transform.yaw };

    audioSystem.playCashRegister();
    ui.showNotification(
        `Placed: ${def.name} (-$${cost})`,
        'rgba(30,90,50,0.92)',
        2200
    );

    if (world) {
        world.syncOwnedStorePickups?.(gameState, gameAssetBucket);
        if (def.equipment === 'fermenter' && typeof def.slotIndex === 'number') {
            world.spawnFermenterFromStore?.(def.slotIndex, {
                popIn: true,
                placement: placements[def.id],
            });
        } else if (def.equipment === 'lagerTank') {
            world.spawnLagerTankFromStore?.({
                popIn: true,
                placement: placements[def.id],
            });
            syncLagerTankRefs(getPlayCtx());
        }
        buildHitboxCaches();
        syncInteractableState();
        kegSystem._tapsDirty = true;
        kegSystem._updateKegVisuals();
    }
    ui.refreshRecipeShopContent();
}

function tryBuyRecipe(recipeId) {
    const r = recipeSystem.getRecipeById(recipeId);
    const ids = gameState.unlockedRecipeIds;
    if (!r || !ids || ids.includes(r.id)) return false;
    const cost = r.unlockCost ?? 0;
    if (cost <= 0) return false;
    if (gameState.player.money < cost) {
        audioSystem.playError();
        ui.showNotification(`Need $${cost} for ${r.name}`, 'rgba(120,40,40,0.92)', 2000);
        return false;
    }
    gameState.player.money -= cost;
    ids.push(r.id);
    audioSystem.playCashRegister();
    ui.showNotification(`Unlocked recipe: ${r.name} (-$${cost})`, 'rgba(30,90,50,0.92)', 2200);
    ui.refreshRecipeShopContent();
    return true;
}

function updateSaveSlotButtonStyles() {
    document.querySelectorAll('.save-slot-btn').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.slot) === gameState.saveSlot);
    });
}

function refreshStartMenuSaveButton() {
    ui.setStartSaveButtonEnabled(hasSaveGame(gameState.saveSlot));
    updateSaveSlotButtonStyles();
    ui._syncStartAudioSliders();
}

function hideCharacterSelectPanel() {
    const p = document.getElementById('character-select-panel');
    const row = document.getElementById('save-slot-row');
    const menu = document.getElementById('start-menu-buttons');
    if (p) p.style.display = 'none';
    if (row) row.style.display = 'flex';
    if (menu) menu.style.display = 'flex';
}

function showCharacterSelectPanel() {
    const p = document.getElementById('character-select-panel');
    const row = document.getElementById('save-slot-row');
    const menu = document.getElementById('start-menu-buttons');
    if (menu) menu.style.display = 'none';
    if (row) row.style.display = 'none';
    if (p) p.style.display = 'flex';
}

function exitToTitleMenu() {
    gameState.started = false;
    gameState.paused = false;
    try {
        document.exitPointerLock?.();
    } catch (_) {
        /* ignore */
    }
    customerSystem?.clearAllCustomers();
    grainMillSystem?.reset?.();
    world?.clearLoosePickups?.();
    ui.closeRecipeShop(true);
    player?.clearAvatarForMenu?.();
    disposeAllRemotePlayers();
    netManager.leave();
    updateMultiplayerBanner();
    resetPendingSession();
    audioSystem.startTitleBackgroundMusic();
    brewSystem?.cancelSelection();
    kegSystem?.cancelSelection();
    ui.hideRecipeSelection();
    ui.hideKegSelection();
    if (startScreen) startScreen.style.display = 'flex';
    hideCharacterSelectPanel();
    const sp = document.getElementById('start-settings-panel');
    if (sp) sp.style.display = 'none';
    hideMultiplayerPanels();
    showStartMenuRoot();
    renderer.domElement.style.pointerEvents = 'none';
    refreshStartMenuSaveButton();
}

function disposeAllRemotePlayers() {
    for (const rp of remotePlayers.values()) rp.dispose();
    remotePlayers.clear();
}

function updateMultiplayerBanner() {
    const banner = document.getElementById('mp-session-banner');
    const text = document.getElementById('mp-banner-text');
    if (!banner || !text) return;
    if (!netManager.active || !gameState.started) {
        banner.style.display = 'none';
        return;
    }
    const info = netManager.serverInfo;
    const roleLabel = netManager.isHost ? 'Hosting' : 'Joined';
    const modeLabel = (netManager.mode || 'local').toUpperCase();
    const others = remotePlayers.size;
    const friendCount =
        `<span class="mp-ping">${others + 1}</span> ${others + 1 === 1 ? 'player' : 'players'}`;
    text.innerHTML = `${roleLabel} · ${modeLabel} · “${info?.name || 'Server'}” · ${friendCount}`;
    banner.style.display = 'block';
}

async function beginPlaySession(fromSave) {
    if (!gameReady) {
        if (loadingLine) {
            loadingLine.textContent = 'Still loading — wait a moment, then try again.';
        }
        return;
    }
    if (gameState.started) return;

    // Joiners always start from a fresh world — we don't have world-state sync
    // yet, so it's cleaner to ignore local saves.
    const isJoiner = pendingSession.role === 'join';
    if (isJoiner) fromSave = false;

    // Kick off the networking session before we touch gameplay state so a
    // failure surfaces before the renderer hands over pointer-lock.
    try {
        await establishNetSession();
    } catch (err) {
        console.error('Multiplayer start failed', err);
        ui.showNotification(
            `Multiplayer error: ${err?.message || err}`,
            'rgba(120,30,30,0.92)',
            3500
        );
        netManager.leave();
        // Return to the most sensible panel instead of an orphan character
        // select — usually the server list (for a failed join).
        hideCharacterSelectPanel();
        if (pendingSession.role === 'join') {
            showFindGamePanel();
        } else if (pendingSession.role === 'host') {
            showHostFormPanel();
        } else {
            showStartMenuRoot();
        }
        return;
    }

    gameState.started = true;
    hideCharacterSelectPanel();
    if (startScreen) startScreen.style.display = 'none';
    const sp = document.getElementById('start-settings-panel');
    if (sp) sp.style.display = 'none';
    hideMultiplayerPanels();
    renderer.domElement.style.pointerEvents = 'auto';
    player.lock();

    await ensureAudioStarted();

    const ctx = getPlayCtx();
    const slot = gameState.saveSlot;

    if (fromSave) {
        const saved = loadSaveFromStorage(slot);
        if (saved) {
            applySaveSnapshot(saved, ctx);
            ui.updateCravingsSidebar(gameState.dailyCravings);
        } else {
            gameState.playerCharacter = { colorIndex: 0 };
            resetToNewGame(ctx);
            audioSystem.playDayStart();
        }
    } else {
        gameState.playerCharacter = {
            colorIndex: Math.max(
                0,
                Math.min(PATRON_TINT_COLORS.length - 1, gameState.pendingCharacterColorIndex ?? 0)
            ),
        };
        if (!isJoiner) {
            clearSaveGame(slot);
        }
        resetToNewGame(ctx);
        audioSystem.playDayStart();
    }

    player.setPatronAvatar(gameAssetBucket, gameState.playerCharacter?.colorIndex ?? 0);
    player.resetWorldPosition(0, 0);
    world?.syncOwnedStorePickups?.(gameState, gameAssetBucket);
    updateMultiplayerBanner();
}

async function establishNetSession() {
    const { role, mode } = pendingSession;
    if (role === 'offline' || mode === 'offline') {
        netManager.goOffline();
        return;
    }
    netManager.setSelf({
        name: getPlayerDisplayName(),
        colorIndex: gameState.pendingCharacterColorIndex ?? 0,
    });
    if (role === 'host') {
        await netManager.hostServer({
            mode,
            serverName: pendingSession.hostServerName || 'Unnamed Brewery',
        });
    } else if (role === 'join') {
        if (!pendingSession.joinTarget) throw new Error('No server selected.');
        await netManager.joinServer({
            mode,
            serverId: pendingSession.joinTarget.id,
        });
    }
}

function getPlayerDisplayName() {
    const el = document.getElementById('player-name-input');
    const raw = (el?.value || '').trim();
    if (raw) return raw.slice(0, 24);
    return 'Brewer-' + Math.floor(1000 + Math.random() * 9000);
}

function wireStartMenuAndSettings() {
    if (window.__brewStartMenuWired) return;

    const btnContinue = document.getElementById('btn-continue');
    const btnNew = document.getElementById('btn-new-game');
    const btnSet = document.getElementById('btn-start-settings');
    const btnBack = document.getElementById('btn-start-settings-back');
    const btnCharStart = document.getElementById('btn-character-start');
    const btnCharBack = document.getElementById('btn-character-back');
    const panel = document.getElementById('start-settings-panel');
    const menuRow = document.getElementById('start-menu-buttons');
    const startBgm = document.getElementById('start-bgm');
    const startSfx = document.getElementById('start-sfx');
    const startSens = document.getElementById('start-sens');
    const startSensVal = document.getElementById('start-sens-val');

    document.querySelectorAll('.save-slot-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            gameState.saveSlot = Number(btn.dataset.slot);
            refreshStartMenuSaveButton();
        });
    });

    const colorWrap = document.getElementById('character-colors');
    if (colorWrap) {
        PATRON_TINT_COLORS.forEach((hex, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'char-swatch' + (i === 0 ? ' selected' : '');
            b.style.background = '#' + hex.toString(16).padStart(6, '0');
            b.title = `Outfit ${i + 1}`;
            b.addEventListener('click', (ev) => {
                ev.stopPropagation();
                gameState.pendingCharacterColorIndex = i;
                colorWrap.querySelectorAll('.char-swatch').forEach((s) => s.classList.remove('selected'));
                b.classList.add('selected');
            });
            colorWrap.appendChild(b);
        });
    }

    btnContinue?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!hasSaveGame(gameState.saveSlot)) return;
        pendingSession.fromSave = true;
        showModeSelectPanel();
    });
    btnNew?.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = gameState.saveSlot;
        if (hasSaveGame(slot)) {
            if (
                !window.confirm(
                    `Start a new game in save slot ${slot + 1}? This will erase the existing save in that slot.`
                )
            ) {
                return;
            }
        }
        pendingSession.fromSave = false;
        showModeSelectPanel();
    });
    btnCharStart?.addEventListener('click', (e) => {
        e.stopPropagation();
        beginPlaySession(pendingSession.fromSave);
    });
    btnCharBack?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideCharacterSelectPanel();
        // Go back to the last pre-character panel based on how we got here.
        if (pendingSession.role === 'host') {
            showHostFormPanel();
        } else if (pendingSession.role === 'join') {
            showFindGamePanel();
        } else {
            showModeSelectPanel();
        }
    });
    wireMultiplayerMenus();
    const saveSlotRow = document.getElementById('save-slot-row');
    btnSet?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel) panel.style.display = 'flex';
        if (menuRow) menuRow.style.display = 'none';
        if (saveSlotRow) saveSlotRow.style.display = 'none';
        ui._syncStartAudioSliders();
    });
    btnBack?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel) panel.style.display = 'none';
        if (menuRow) menuRow.style.display = 'flex';
        if (saveSlotRow) saveSlotRow.style.display = 'flex';
    });

    const onStartBgm = () => {
        if (!startBgm) return;
        audioSystem.setBgmVolume(Number(startBgm.value) / 100);
    };
    const onStartSfx = () => {
        if (!startSfx) return;
        audioSystem.setSfxVolume(Number(startSfx.value) / 100);
    };
    const onStartSens = () => {
        if (!startSens) return;
        const v = Number(startSens.value);
        if (startSensVal) startSensVal.textContent = `${v.toFixed(1)}×`;
        player?.setSensitivityMultiplier?.(v);
        // Keep the value cached even before the player is instantiated so the
        // in-game pause panel can mirror it.
        try { localStorage.setItem('brewery_mouse_sensitivity', String(v)); } catch (_) { /* ignore */ }
    };
    if (startSens) {
        try {
            const raw = localStorage.getItem('brewery_mouse_sensitivity');
            if (raw != null && !Number.isNaN(parseFloat(raw))) {
                startSens.value = String(Math.max(1, Math.min(10, parseFloat(raw))));
            }
        } catch (_) { /* ignore */ }
        if (startSensVal) startSensVal.textContent = `${Number(startSens.value).toFixed(1)}×`;
    }
    startBgm?.addEventListener('input', onStartBgm);
    startSfx?.addEventListener('input', onStartSfx);
    startSens?.addEventListener('input', onStartSens);

    const menu = document.getElementById('start-screen');
    menu?.addEventListener(
        'pointerdown',
        (ev) => {
            void tryPrimeTitleMenuMusic(ev);
        },
        true
    );

    window.__brewStartMenuWired = true;
}

// ---------------------------------------------------------------------------
// Start-menu multiplayer wiring
// ---------------------------------------------------------------------------

function showStartMenuRoot() {
    const menu = document.getElementById('start-menu-buttons');
    const row = document.getElementById('save-slot-row');
    if (menu) menu.style.display = 'flex';
    if (row) row.style.display = 'flex';
}

function hideStartMenuRoot() {
    const menu = document.getElementById('start-menu-buttons');
    const row = document.getElementById('save-slot-row');
    if (menu) menu.style.display = 'none';
    if (row) row.style.display = 'none';
}

function hideMultiplayerPanels() {
    const ids = ['mode-select-panel', 'host-form-panel', 'find-game-panel'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }
    stopBrowsingServers();
}

function showModeSelectPanel() {
    hideMultiplayerPanels();
    hideCharacterSelectPanel();
    hideStartMenuRoot();
    const panel = document.getElementById('mode-select-panel');
    const title = document.getElementById('mode-select-title');
    if (title) {
        title.textContent = pendingSession.fromSave
            ? 'Continue — choose mode'
            : 'New game — choose mode';
    }
    if (panel) panel.style.display = 'flex';
}

function showHostFormPanel() {
    hideMultiplayerPanels();
    hideCharacterSelectPanel();
    hideStartMenuRoot();
    const panel = document.getElementById('host-form-panel');
    const title = document.getElementById('host-form-title');
    const input = document.getElementById('host-server-name');
    if (title) {
        title.textContent = pendingSession.mode === 'online'
            ? 'Host an Online server'
            : 'Host a Local server';
    }
    if (input && !input.value) {
        input.value = pendingSession.hostServerName || defaultServerName();
    }
    if (panel) panel.style.display = 'flex';
    setTimeout(() => input?.focus(), 40);
}

function showFindGamePanel() {
    hideMultiplayerPanels();
    hideCharacterSelectPanel();
    hideStartMenuRoot();
    const panel = document.getElementById('find-game-panel');
    if (panel) panel.style.display = 'flex';
    syncFindBrowseUi();
    startBrowsingServers(findBrowseMode);
}

function defaultServerName() {
    const suffix = Math.floor(100 + Math.random() * 900);
    return `Brewery #${suffix}`;
}

let _stopBrowsing = null;
/** @type {'local' | 'online'} */
let findBrowseMode = 'local';

function syncFindBrowseUi() {
    const loc = document.getElementById('btn-browse-local');
    const onl = document.getElementById('btn-browse-online');
    const note = document.getElementById('find-game-note');
    if (loc) loc.classList.toggle('browse-active', findBrowseMode === 'local');
    if (onl) onl.classList.toggle('browse-active', findBrowseMode === 'online');
    if (note) {
        note.textContent =
            findBrowseMode === 'online'
                ? 'Uses the WebSocket relay (run npm run relay). Point window.BREW_RELAY_URL at your deployed relay over HTTPS.'
                : 'Other tabs on this PC only — open two tabs to test.';
    }
}

function startBrowsingServers(mode) {
    stopBrowsingServers();
    renderServerList([], mode);
    const unsub = netManager.onServerList((list) => renderServerList(list, mode));
    netManager.startBrowsing(mode);
    _stopBrowsing = () => {
        unsub?.();
        netManager.stopBrowsing();
    };
}

function stopBrowsingServers() {
    if (_stopBrowsing) {
        _stopBrowsing();
        _stopBrowsing = null;
    }
}

function renderServerList(list, mode) {
    const host = document.getElementById('server-list');
    if (!host) return;
    host.innerHTML = '';
    if (!list || list.length === 0) {
        const empty = document.createElement('div');
        empty.id = 'server-list-empty';
        empty.textContent =
            mode === 'online'
                ? 'No servers on the relay — start npm run relay, then host “Online” from another browser.'
                : 'No servers found yet — host one from another tab.';
        host.appendChild(empty);
        return;
    }
    for (const s of list) {
        const row = document.createElement('div');
        row.className = 'server-row';
        row.innerHTML = `
            <div>
                <div class="srv-name"></div>
                <div class="srv-meta"></div>
            </div>
            <div class="srv-count"></div>
        `;
        row.querySelector('.srv-name').textContent = s.name;
        row.querySelector('.srv-meta').textContent = `host: ${s.hostName} · ${s.mode}`;
        row.querySelector('.srv-count').textContent = `${s.players}/${s.max}`;
        row.addEventListener('click', (ev) => {
            ev.stopPropagation();
            beginJoinFlow(s);
        });
        host.appendChild(row);
    }
}

function beginJoinFlow(server) {
    pendingSession.role = 'join';
    pendingSession.mode = server.mode === 'online' ? 'online' : 'local';
    pendingSession.joinTarget = { ...server };
    pendingSession.fromSave = false;
    hideMultiplayerPanels();
    showCharacterSelectPanel();
    const title = document.getElementById('char-select-title');
    const note = document.getElementById('char-select-note');
    if (title) title.textContent = `Joining “${server.name}”`;
    if (note) note.textContent = `Host: ${server.hostName} · pick your outfit + display name`;
}

function wireMultiplayerMenus() {
    const btnFind = document.getElementById('btn-find-game');
    btnFind?.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingSession.fromSave = false;
        showFindGamePanel();
    });

    const btnModeOff = document.getElementById('btn-mode-offline');
    const btnModeLoc = document.getElementById('btn-mode-local');
    const btnModeOn = document.getElementById('btn-mode-online');
    const btnModeBack = document.getElementById('btn-mode-back');

    btnModeOff?.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingSession.mode = 'offline';
        pendingSession.role = 'offline';
        pendingSession.joinTarget = null;
        hideMultiplayerPanels();
        if (pendingSession.fromSave) {
            beginPlaySession(true);
        } else {
            showCharacterSelectPanel();
            resetCharSelectHeader();
        }
    });
    btnModeLoc?.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingSession.mode = 'local';
        pendingSession.role = 'host';
        pendingSession.joinTarget = null;
        showHostFormPanel();
    });
    btnModeOn?.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingSession.mode = 'online';
        pendingSession.role = 'host';
        pendingSession.joinTarget = null;
        showHostFormPanel();
    });
    btnModeBack?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideMultiplayerPanels();
        showStartMenuRoot();
        resetPendingSession();
    });

    const btnHostNext = document.getElementById('btn-host-next');
    const btnHostBack = document.getElementById('btn-host-back');
    const hostName = document.getElementById('host-server-name');
    hostName?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            btnHostNext?.click();
        }
    });
    btnHostNext?.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = (hostName?.value || '').trim();
        if (!name) {
            hostName?.focus();
            return;
        }
        pendingSession.hostServerName = name;
        hideMultiplayerPanels();
        showCharacterSelectPanel();
        resetCharSelectHeader();
        const title = document.getElementById('char-select-title');
        if (title) title.textContent = `Hosting “${name}” — pick your brewer`;
    });
    btnHostBack?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideMultiplayerPanels();
        showModeSelectPanel();
    });

    const btnFindBack = document.getElementById('btn-find-back');
    const btnFindRefresh = document.getElementById('btn-find-refresh');
    btnFindBack?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideMultiplayerPanels();
        showStartMenuRoot();
        resetPendingSession();
    });
    btnFindRefresh?.addEventListener('click', (e) => {
        e.stopPropagation();
        startBrowsingServers(findBrowseMode);
    });

    document.getElementById('btn-browse-local')?.addEventListener('click', (e) => {
        e.stopPropagation();
        findBrowseMode = 'local';
        syncFindBrowseUi();
        startBrowsingServers('local');
    });
    document.getElementById('btn-browse-online')?.addEventListener('click', (e) => {
        e.stopPropagation();
        findBrowseMode = 'online';
        syncFindBrowseUi();
        startBrowsingServers('online');
    });
}

function resetCharSelectHeader() {
    const title = document.getElementById('char-select-title');
    const note = document.getElementById('char-select-note');
    if (title) title.textContent = 'Choose your brewer';
    if (note) note.textContent = 'Same models as patrons — pick an outfit color';
}

// ---------------------------------------------------------------------------
// Remote avatar sync
// ---------------------------------------------------------------------------

function ensureRemotePlayer(peerId, state) {
    let rp = remotePlayers.get(peerId);
    if (!rp) {
        rp = new RemotePlayer(scene, gameAssetBucket, state);
        remotePlayers.set(peerId, rp);
        updateMultiplayerBanner();
    }
    return rp;
}

function removeRemotePlayer(peerId) {
    const rp = remotePlayers.get(peerId);
    if (!rp) return;
    rp.dispose();
    remotePlayers.delete(peerId);
    updateMultiplayerBanner();
}

netManager.onRemote((ev) => {
    if (ev.kind === 'state') {
        if (!gameReady) return;
        const rp = ensureRemotePlayer(ev.peerId, ev.state);
        rp.applyState(ev.state);
    } else if (ev.kind === 'leave') {
        removeRemotePlayer(ev.peerId);
    } else if (ev.kind === 'kicked') {
        ui.showNotification(
            `Disconnected: ${ev.reason || 'host closed the session.'}`,
            'rgba(120,30,30,0.92)',
            3500
        );
        disposeAllRemotePlayers();
        updateMultiplayerBanner();
    }
});

function wireWaveCallbacks() {
    waveManager.onWaveStart = (num) => {
        ui.showNotification(`Wave ${num}!`, 'rgba(20,50,80,0.92)');
        audioSystem.playWaveStart();
    };
    waveManager.onWaveEnd = (num) => {
        ui.showNotification(`Wave ${num} Complete!`, 'rgba(20,80,20,0.9)');
    };
    waveManager.onDayEnd = (newDay, summary) => {
        audioSystem.playDayStart();
        ui.showDayTransition(newDay, summary);
        ui.updateCravingsSidebar(gameState.dailyCravings);
    };
    waveManager.onDayStart = () => {
        ui.showDailyCravings(gameState.dailyCravings);
        ui.updateCravingsSidebar(gameState.dailyCravings);
    };
    waveManager.onWaitingForPlayer = () => {
        gameState.waitingForPlayer = true;
        ui.showNotification('Brew up! Press [F] when ready for customers', 'rgba(20,45,70,0.92)', 3000);
    };
}

let lagerHitbox = null;

function buildHitboxCaches() {
    brewHitboxes = world.brewStations.map((_, i) =>
        world.interactables.find(o => o.userData.type === 'brewStation' && o.userData.index === i)
    );
    fermHitboxes = world.fermenters.map((_, i) =>
        world.interactables.find(o => o.userData.type === 'fermenter' && o.userData.index === i)
    );
    tapHitboxes = world.taps.map((_, i) =>
        world.interactables.find(o => o.userData.type === 'tap' && o.userData.index === i)
    );
    lagerHitbox = world.interactables.find((o) => o.userData?.type === 'lagerTank') || null;
}

/** Cached once per animate tick — otherwise `canTryConvince` ran up to 7× per frame. */
let _frameCanConvince = false;

function syncInteractableState() {
    if (lagerHitbox && world.lagerTank) {
        lagerHitbox.userData._state = world.lagerTank.state;
    }
    world.brewStations.forEach((s, i) => {
        if (brewHitboxes[i]) {
            brewHitboxes[i].userData._state = s.state;
            brewHitboxes[i].userData._locked = !s.unlocked;
            brewHitboxes[i].userData._cost = s.cost;
            brewHitboxes[i].userData._wortNoFermenterSlot =
                s.state === 'done' &&
                !hasUnlockedEmptyFermenter(world.fermenters, world.lagerTank, s.recipe);
            brewHitboxes[i].userData._needsMilledBatch =
                s.state === 'empty' && !s.milledIngredients?.length;
            brewHitboxes[i].userData._awaitingRecipe =
                s.state === 'empty' && s.milledIngredients?.length === 3;
            brewHitboxes[i].userData._badBatch = s.state === 'done' && s.batchValid === false;
        }
    });
    world.fermenters.forEach((f, i) => {
        if (f && fermHitboxes[i]) {
            fermHitboxes[i].userData._state = f.state;
            fermHitboxes[i].userData._locked = !f.unlocked;
            fermHitboxes[i].userData._cost = f.cost;
        }
    });
    const canConv = _frameCanConvince;
    const kegsAvail = gameState.kegs.length > 0;
    const maxServ = kegSystem.maxServingsPerKeg;
    for (let i = 0; i < world.taps.length; i++) {
        const t = world.taps[i];
        const hb = tapHitboxes[i];
        if (!t || !hb) continue;
        const ud = hb.userData;
        ud._hasKeg = !!t.keg;
        ud._beerName = t.keg?.recipe?.name || '';
        ud._kegsAvailable = kegsAvail;
        ud._canUntap = !!t.keg && t.keg.servings >= maxServ;
        ud._locked = !t.unlocked;
        ud._cost = t.cost;
        ud._canConvince = canConv;
    }
    if (world.grainMillStation?.hitbox && grainMillSystem) {
        const gh = world.grainMillStation.hitbox.userData;
        gh._millFilled = grainMillSystem.filledCount;
        gh._millState = grainMillSystem.state;
    }
    world.dryStorageRacks?.forEach((rack) => {
        rack.hitboxes?.forEach((hit, s) => {
            hit.userData._filled = !!rack.slots[s];
            hit.userData._rackNum = rack.index + 1;
            hit.userData._slotNum = s + 1;
        });
    });
}

function handleInteraction(target) {
    handleGameplayInteraction(target, {
        ...getPlayCtx(),
        player,
        audioSystem,
        ui,
        customerSystem,
        dryStorageSystem,
    });
}

let prevBrewSelecting = null;
let prevKegSelecting = null;

function checkSelectionUI() {
    if (brewSystem.selectingRecipe !== null && prevBrewSelecting === null) {
        ui.showRecipeSelection(brewSystem.selectingRecipe);
    } else if (brewSystem.selectingRecipe === null && prevBrewSelecting !== null) {
        ui.hideRecipeSelection();
    }
    prevBrewSelecting = brewSystem.selectingRecipe;

    if (kegSystem.selectingKeg !== null && prevKegSelecting === null) {
        ui.showKegSelection(gameState.kegs);
    } else if (kegSystem.selectingKeg === null && prevKegSelecting !== null) {
        ui.hideKegSelection();
    }
    prevKegSelecting = kegSystem.selectingKeg;

    const px = player.avatarPos.x;
    const pz = player.avatarPos.z;
    const maxSelDist = 5;
    if (brewSystem.selectingRecipe !== null) {
        const station = world.brewStations[brewSystem.selectingRecipe];
        const dx = station.position.x - px;
        const dz = station.position.z - pz;
        if (dx * dx + dz * dz > maxSelDist * maxSelDist) {
            brewSystem.cancelSelection();
            ui.hideRecipeSelection();
        }
    }
    if (kegSystem.selectingKeg !== null) {
        const tap = world.taps[kegSystem.selectingKeg];
        if (!tap) {
            kegSystem.cancelSelection();
            ui.hideKegSelection();
        } else {
            const dx = tap.position.x - px;
            const dz = tap.position.z - pz;
            if (dx * dx + dz * dz > maxSelDist * maxSelDist) {
                kegSystem.cancelSelection();
                ui.hideKegSelection();
            }
        }
    }
}

const clock = new THREE.Clock();
/** Used to halve per-frame hitbox userData sync (discrete states; one-frame lag is fine). */
let gameLogicTick = 0;

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);

    if (!gameReady) {
        renderer.render(scene, camera);
        return;
    }

    if (gameState.started && !gameState.paused) {
        gameLogicTick++;
        world?.updatePopInAnimations?.(delta);
        player.update(delta);
        interactionSystem.update(player);
        placementSystem?.update(delta);
        brewSystem.update(delta);
        grainMillSystem?.update(delta);
        fermentSystem.update(delta);
        customerSystem.update(delta);
        waveManager.update(delta);

        // Multiplayer: broadcast our pose and update remote avatars. Remote
        // avatar updates run outside the gameplay paused-guard (so avatars
        // still move smoothly even if you pop the pause menu), but the local
        // broadcast stays gated so we don't spam frozen poses.
        netManager.tickSendLocalState(player);
        for (const rp of remotePlayers.values()) {
            rp.update(delta);
        }
        if ((gameLogicTick % 30) === 0) updateMultiplayerBanner();

        // Convince eligibility scans patrons + taps; cache once per frame and
        // reuse for both interactable sync and UI prompt (was running 7×).
        _frameCanConvince =
            customerSystem?.canTryConvince?.(world.taps, player) ?? false;

        if ((gameLogicTick & 1) === 0) {
            syncInteractableState();
        }
        checkSelectionUI();
        kegSystem.updateTapLabels();
        ui.update(interactionSystem.currentTarget, player, {
            canConvince: _frameCanConvince,
        });
    } else if (gameState.paused) {
        ui.update(null, player, { canConvince: false });
        // Keep remote avatars animating while paused so you can still see
        // teammates walking when you hit Escape.
        for (const rp of remotePlayers.values()) rp.update(delta);
    }

    renderer.render(scene, camera);
}

const startScreen = document.getElementById('start-screen');
const loadingLine = document.getElementById('loading-line');

document.addEventListener('keydown', (e) => {
    if (!gameReady || !gameState.started || gameState.paused) return;

    if (ui.isRecipeShopOpen()) {
        if (e.code === 'Escape' || e.code === 'Tab') {
            ui.closeRecipeShop();
            e.preventDefault();
            player?.lock();
            return;
        }
        if (e.code === 'Backspace' && !e.repeat) {
            const v = gameState.supplyTerminalView;
            if (v === 'recipes' || v === 'tools') {
                gameState.supplyTerminalView = 'home';
                ui.refreshRecipeShopContent();
                e.preventDefault();
                return;
            }
        }
        if (e.key >= '0' && e.key <= '9' && !e.repeat) {
            if (gameState.supplyTerminalView === 'home') {
                if (e.key === '1') {
                    gameState.supplyTerminalView = 'tools';
                    ui.refreshRecipeShopContent();
                } else if (e.key === '2') {
                    gameState.supplyTerminalView = 'recipes';
                    ui.refreshRecipeShopContent();
                }
                return;
            }
            const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
            if (gameState.supplyTerminalView === 'tools') {
                const owned = new Set(gameState.ownedObjectIds || []);
                const forSale = STORE_OBJECT_DEFS.filter((o) => !owned.has(o.id));
                if (idx >= 0 && idx < forSale.length && idx < 10) {
                    tryBuyStoreObject(forSale[idx].id);
                }
            } else if (gameState.supplyTerminalView === 'recipes') {
                const locked = recipeSystem.recipes.filter(
                    (rr) => !gameState.unlockedRecipeIds.includes(rr.id)
                );
                if (idx >= 0 && idx < locked.length && idx < 10) {
                    tryBuyRecipe(locked[idx].id);
                }
            }
            return;
        }
        return;
    }

    // Placement mode — Escape cancels, E confirms the blinking ghost footprint.
    // Must precede the generic KeyE/Escape handlers below.
    if (placementSystem?.active) {
        if (e.code === 'Escape') {
            placementSystem.cancel();
            e.preventDefault();
            return;
        }
        if (e.code === 'KeyE') {
            placementSystem.confirm();
            e.preventDefault();
            return;
        }
    }

    if (e.code === 'Tab') {
        if (brewSystem.selectingRecipe !== null) {
            brewSystem.cancelSelection();
            ui.hideRecipeSelection();
            e.preventDefault();
            return;
        }
        if (kegSystem.selectingKeg !== null) {
            kegSystem.cancelSelection();
            ui.hideKegSelection();
            e.preventDefault();
            return;
        }
    }

    const noRecipeOrKegUI =
        brewSystem.selectingRecipe === null && kegSystem.selectingKeg === null;
    if (e.code === 'Digit1' && !e.repeat && noRecipeOrKegUI) {
        player?.playBrewerTaunt?.('yell');
    }
    if (e.code === 'Digit2' && !e.repeat && noRecipeOrKegUI) {
        const t = performance.now() * 0.001;
        const yelledRecently = player && t - player.getLastYellTime() < 4.5;
        player?.playBrewerTaunt?.('point');
        if (
            yelledRecently &&
            customerSystem?.tryKickRowdyAfterPointing?.(player)
        ) {
            ui.showNotification('Rowdy patron ejected', 'rgba(90,40,20,0.92)', 2000);
        }
    }

    if (e.code === 'KeyE') {
        handleInteraction(interactionSystem.currentTarget);
    }

    if (e.code === 'KeyQ') {
        if (e.repeat) return;
        const c = gameState.player.carrying;
        if (!c) return;
        if (c.type === 'bucket') {
            const dir = new THREE.Vector3();
            player.getFacingXZ(dir);
            const pos = new THREE.Vector3(player.avatarPos.x, 0, player.avatarPos.z);
            pos.x += dir.x * 1.0;
            pos.z += dir.z * 1.0;
            const ids = c.ingredientIds;
            gameState.player.carrying = null;
            ui.refreshCarryingBadge();
            try {
                world.spawnGrainBucketLoose(gameAssetBucket.grainBucketTemplate, pos, ids, {
                    milled: !!c.milled,
                });
            } catch (err) {
                console.error('spawnGrainBucketLoose', err);
            }
            audioSystem.playPickup();
            return;
        }
        if (c.type !== 'ingredient' && c.type !== 'milledBatch') return;
        const dir = new THREE.Vector3();
        player.getFacingXZ(dir);
        const pos = new THREE.Vector3(player.avatarPos.x, 0, player.avatarPos.z);
        pos.x += dir.x * 1.0;
        pos.z += dir.z * 1.0;
        if (c.type === 'ingredient') {
            const ingredientId = c.ingredientId;
            gameState.player.carrying = null;
            ui.refreshCarryingBadge();
            try {
                world.spawnIngredientLoose(ingredientId, pos);
            } catch (err) {
                console.error('spawnIngredientLoose', err);
            }
        } else {
            const ingredients = Array.isArray(c.ingredients) ? [...c.ingredients] : [];
            gameState.player.carrying = null;
            ui.refreshCarryingBadge();
            try {
                if (ingredients.length > 0) {
                    world.spawnMilledBatchLoose(ingredients, pos);
                }
            } catch (err) {
                console.error('spawnMilledBatchLoose', err);
            }
        }
        audioSystem.playPickup();
    }

    if (e.code === 'KeyF') {
        if (gameState.waitingForPlayer) {
            gameState.waitingForPlayer = false;
            waveManager.playerReady();
        }
    }

    if (e.code === 'KeyG') {
        const target = interactionSystem.currentTarget;
        if (target && target.userData.type === 'tap') {
            const idx = target.userData.index;
            if (kegSystem.untapKeg(idx)) {
                ui.showNotification('Keg removed from tap', 'rgba(80,50,10,0.9)', 1500);
            } else {
                const tap = world.taps[idx];
                if (tap && tap.keg && tap.keg.servings < kegSystem.maxServingsPerKeg) {
                    ui.showNotification('Already poured — keg must stay until empty', 'rgba(150,30,30,0.9)', 2000);
                }
            }
        }
    }

    if (e.code === 'KeyV' && !e.repeat) {
        const outcome = customerSystem.tryConvinceWaitingCustomer(
            world.taps,
            recipeSystem,
            player
        );
        if (outcome === 'success') {
            ui.showNotification(
                'Patron agreed to try something on tap',
                'rgba(30,80,50,0.92)',
                2200
            );
        } else if (outcome === 'fail') {
            ui.showNotification(
                'Patron is not budging',
                'rgba(90,55,25,0.92)',
                2000
            );
        } else if (outcome === 'no_alternative') {
            ui.showNotification(
                'No other beer on tap to suggest',
                'rgba(70,50,30,0.9)',
                2000
            );
        } else if (outcome === 'no_patron') {
            ui.showNotification('No one waiting at the bar', 'rgba(60,60,70,0.9)', 1800);
        } else if (outcome === 'no_patron_in_view') {
            ui.showNotification(
                'Face a waiting patron nearby (in front of you) to suggest a swap',
                'rgba(55,65,85,0.92)',
                3200
            );
        }
    }

    if (e.key >= '0' && e.key <= '9') {
        const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        if (brewSystem.selectingRecipe !== null) {
            brewSystem.selectRecipe(idx);
            ui.hideRecipeSelection();
        } else if (kegSystem.selectingKeg !== null) {
            kegSystem.selectKeg(idx);
            ui.hideKegSelection();
        }
    }

    if (e.code === 'Escape') {
        if (ui.isRecipeShopOpen()) {
            ui.closeRecipeShop();
            player?.lock();
            return;
        }
        brewSystem.cancelSelection();
        kegSystem.cancelSelection();
        ui.hideRecipeSelection();
        ui.hideKegSelection();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !gameReady || !gameState.started || !gameState.paused) return;
    e.preventDefault();
    if (ui.handlePauseEscape()) return;
    player?.lock();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function bootstrap() {
    const assetBucket = {
        textures: {},
        patronTemplate: null,
        envTexture: null,
        furnitureChairTemplate: null,
        beerTapTemplate: null,
        beerFermenterTemplate: null,
        mashTunTemplate: null,
        lagerTankTemplate: null,
        recipeTerminalTemplate: null,
        taproomChandelierTemplate: null,
        kegTemplate: null,
        grainBucketTemplate: null,
        grainMillTemplate: null,
    };

    if (loadingLine) {
        loadingLine.textContent = 'Loading patrons, furniture, and textures…';
    }
    function initGameWorldAfterAssets() {
        if (gameReady) return;
        try {
            gameAssetBucket = assetBucket;
            world = new World(scene, assetBucket);
            player = new Player(camera, scene, world.colliders, renderer.domElement);
            ui.attachPlayer(player);
            interactionSystem = new InteractionSystem(camera, world.interactables);
            brewSystem = new BrewSystem(
                scene,
                world.brewStations,
                world.fermenters,
                world.lagerTank,
                gameState,
                audioSystem,
                recipeManager
            );
            grainMillSystem = new GrainMill(
                audioSystem,
                {
                    progressFill: world.grainMillStation.progressFill,
                    progressBg: world.grainMillStation.progressBg,
                    hopper: world.grainMillStation.hopper,
                },
                {
                    placeBucketAtMill: () => {
                        world.placeGrainMillBucketForMilling(gameAssetBucket.grainBucketTemplate);
                    },
                    clearMillBucket: () => world.clearGrainMillWaitingBucket?.(),
                }
            );
            grainMillSystem.onMillComplete = (ingredients) => {
                if (world.completeGrainMillBucketFill?.(ingredients)) {
                    return;
                }
                const drop =
                    world.grainMillStation?.milledDropPosition?.clone() ??
                    new THREE.Vector3(0, 0, -21);
                world.spawnMilledBatchLoose(ingredients, drop);
            };
            dryStorageSystem = new DryStorageSystem(world, audioSystem);
            brewSystem.onWortBlockedNoFermenter = () => {
                ui.showNotification(
                    'All unlocked bio-tanks are full. Empty one into a keg or dump excess wort in the floor drain.',
                    'rgba(70,35,20,0.94)',
                    4500
                );
            };
            fermentSystem = new FermentSystem(scene, world.fermenters, world.lagerTank, gameState, audioSystem);
            kegSystem = new KegSystem(
                scene,
                world.kegStation,
                world.taps,
                gameState,
                audioSystem,
                assetBucket.kegTemplate,
                world.colliders
            );
            customerSystem = new CustomerSystem(
                scene,
                world.customerSpots,
                gameState,
                audioSystem,
                assetBucket,
                world.tableSeats
            );
            // Combo-punch finisher: land the 2nd swing → find the nearest
            // target in front of the player and launch them across the room.
            // Customers are authoritative locally, so we drive them through
            // `applyKnockback`. Remote players are authoritative on their own
            // tab, so we apply a local-only visual shove (their network state
            // will retake control after the arc fades — see RemotePlayer).
            player.onPunchLanded = (p) => {
                if (!p?.avatarPos || !p.getFacingXZ) return;
                const fwd = new THREE.Vector3();
                p.getFacingXZ(fwd);
                if (fwd.lengthSq() < 1e-6) return;
                fwd.normalize();
                const px = p.avatarPos.x;
                const pz = p.avatarPos.z;

                const customerHit = customerSystem?.findPunchTarget?.(p, 2.5, 0.5);
                if (customerHit) {
                    customerSystem.applyKnockback(customerHit, fwd.x, fwd.z, 9.0);
                    return;
                }
                // No customer — check visible remote players within the same
                // cone. Iterate the map in insertion order; there are at most
                // MAX_PLAYERS_PER_SERVER - 1 (= 3) entries so this is cheap.
                let bestRp = null;
                let bestD = 1e9;
                for (const rp of remotePlayers.values()) {
                    const rx = rp?.targetPos?.x;
                    const rz = rp?.targetPos?.z;
                    if (rx == null || rz == null) continue;
                    const dx = rx - px;
                    const dz = rz - pz;
                    const d = Math.hypot(dx, dz);
                    if (d > 2.6 || d < 0.1) continue;
                    const dot = (fwd.x * dx + fwd.z * dz) / d;
                    if (dot < 0.5) continue;
                    if (d < bestD) { bestD = d; bestRp = rp; }
                }
                if (bestRp) {
                    bestRp.applyKnockback(fwd.x, fwd.z, 9.0);
                }
            };
            waveManager = new WaveManager(gameState, customerSystem, recipeSystem);
            upgradeSystem = new UpgradeSystem(world, gameState, audioSystem, ui);
            placementSystem = new PlacementSystem({
                scene,
                world,
                gameState,
                ui,
                audio: audioSystem,
                camera,
                player,
            });

            ui.setPauseActions({
                resume: () => player?.lock(),
                restartDay: () => {
                    if (
                        !window.confirm(
                            'Restart the current day? Customers and in-progress brews this day are cleared, but money and upgrades stay.'
                        )
                    ) {
                        return;
                    }
                    restartCurrentDay(getPlayCtx());
                    world?.syncOwnedStorePickups?.(gameState, gameAssetBucket);
                    ui.showNotification(
                        'Day restarted — Press [F] when ready for customers',
                        'rgba(20,45,70,0.92)',
                        3500
                    );
                    player?.lock();
                },
                saveExit: () => {
                    const ok = saveGameToStorage(
                        buildSaveSnapshot(world, gameState, waveManager, grainMillSystem),
                        gameState.saveSlot
                    );
                    if (ok) {
                        ui.showNotification('Progress saved', 'rgba(20,80,40,0.9)', 2000);
                    } else {
                        ui.showNotification('Could not save (storage blocked?)', 'rgba(120,30,30,0.9)', 2500);
                    }
                    exitToTitleMenu();
                },
                restart: () => {
                    if (window.confirm('Restart the entire game? The page will reload.')) {
                        window.location.reload();
                    }
                },
            });

            wireWaveCallbacks();
            buildHitboxCaches();
            syncInteractableState();
            scene.updateMatrixWorld(true);
            if (typeof renderer.compile === 'function') {
                try {
                    renderer.compile(scene, camera);
                } catch (compileErr) {
                    console.warn('Shader precompile skipped:', compileErr);
                }
            }
            refreshStartMenuSaveButton();
            gameReady = true;
            try {
                window.__brewGameReady = true;
            } catch (_) {
                /* ignore */
            }
        } catch (err) {
            console.error(err);
            gameReady = false;
            try {
                window.__brewGameReady = false;
            } catch (_) {
                /* ignore */
            }
            world = undefined;
            player = undefined;
            interactionSystem = undefined;
            brewSystem = undefined;
            grainMillSystem = undefined;
            dryStorageSystem = undefined;
            fermentSystem = undefined;
            kegSystem = undefined;
            customerSystem = undefined;
            waveManager = undefined;
            upgradeSystem = undefined;
            while (scene.children.length > 0) {
                scene.remove(scene.children[0]);
            }
            scene.background = new THREE.Color(0x100818);
            scene.environment = null;
            scene.fog = null;
            if (loadingLine) {
                loadingLine.innerHTML =
                    'Could not start the game. Press F5 or Ctrl+Shift+R to reload. Details in console (F12).';
            }
        }
    }

    loadGameAssets(renderer, scene)
        .then((result) => {
            Object.assign(assetBucket, result);
            if (result.envTexture) {
                scene.environment = result.envTexture;
            }
            if (loadingLine) {
                loadingLine.textContent = '';
            }
            initGameWorldAfterAssets();
        })
        .catch((err) => {
            console.warn('Asset load:', err);
            if (loadingLine) {
                loadingLine.textContent =
                    'Some assets failed — run: npm run fetch-assets. Starting with fallbacks.';
            }
            initGameWorldAfterAssets();
        });

    requestAnimationFrame(animate);
}

bootstrap();

function attachStartMenuWhenDomReady() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => wireStartMenuAndSettings());
    } else {
        wireStartMenuAndSettings();
    }
}
attachStartMenuWhenDomReady();
