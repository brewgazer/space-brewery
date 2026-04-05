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
import { UI } from './src/UI.js';
import { AudioSystem } from './src/AudioSystem.js';
import { UpgradeSystem } from './src/UpgradeSystem.js';
import { loadGameAssets } from './src/AssetLoader.js';

// --- Renderer (tuned for smooth play on typical hardware) ---
const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
document.body.appendChild(renderer.domElement);

// --- Scene & Camera ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x140c08);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 80);

// --- Game State ---
const gameState = {
    started: false,
    paused: false,
    player: { carrying: null, money: 0, score: 0 },
    kegs: [],
    dailyCravings: [],
    currentWave: 0,
    dayNumber: 1,
    waveActive: false,
    waitingForPlayer: false
};
window.gameState = gameState;

const recipeSystem = new RecipeSystem();
const audioSystem = new AudioSystem();
const ui = new UI(gameState);

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
let brewHitboxes;
let fermHitboxes;
let tapHitboxes;

function wireWaveCallbacks() {
    waveManager.onWaveStart = (num) => {
        ui.showNotification(`Wave ${num}!`, 'rgba(150,60,10,0.9)');
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
        ui.showNotification('Brew up! Press [F] when ready for customers', 'rgba(80,50,10,0.9)', 3000);
    };
}

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
}

function syncInteractableState() {
    world.brewStations.forEach((s, i) => {
        if (brewHitboxes[i]) {
            brewHitboxes[i].userData._state = s.state;
            brewHitboxes[i].userData._locked = !s.unlocked;
            brewHitboxes[i].userData._cost = s.cost;
        }
    });
    world.fermenters.forEach((f, i) => {
        if (fermHitboxes[i]) {
            fermHitboxes[i].userData._state = f.state;
            fermHitboxes[i].userData._locked = !f.unlocked;
            fermHitboxes[i].userData._cost = f.cost;
        }
    });
    world.taps.forEach((t, i) => {
        if (tapHitboxes[i]) {
            tapHitboxes[i].userData._hasKeg = !!t.keg;
            tapHitboxes[i].userData._beerName = t.keg?.recipe?.name || '';
            tapHitboxes[i].userData._kegsAvailable = gameState.kegs.length > 0;
            tapHitboxes[i].userData._canUntap = !!t.keg && t.keg.servings >= kegSystem.maxServingsPerKeg;
            tapHitboxes[i].userData._locked = !t.unlocked;
            tapHitboxes[i].userData._cost = t.cost;
        }
    });
}

function handleInteraction(target) {
    if (!target) return;
    const data = target.userData;

    if (data._locked) {
        upgradeSystem.tryPurchase(data.type, data.index);
        return;
    }

    if (data.type === 'brewStation') {
        brewSystem.interact(data.index, gameState.player);
    } else if (data.type === 'fermenter') {
        fermentSystem.interact(data.index, gameState.player);
    } else if (data.type === 'kegStation') {
        kegSystem.interactKegStation(gameState.player);
    } else if (data.type === 'tap') {
        kegSystem.interactTap(data.index, gameState.player, customerSystem);
    }
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

    if (brewSystem.selectingRecipe !== null) {
        const station = world.brewStations[brewSystem.selectingRecipe];
        if (camera.position.distanceTo(station.position) > 5) {
            brewSystem.cancelSelection();
            ui.hideRecipeSelection();
        }
    }
    if (kegSystem.selectingKeg !== null) {
        const tap = world.taps[kegSystem.selectingKeg];
        if (camera.position.distanceTo(tap.position) > 5) {
            kegSystem.cancelSelection();
            ui.hideKegSelection();
        }
    }
}

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);

    if (gameState.started && !gameState.paused) {
        player.update(delta);
        interactionSystem.update();
        brewSystem.update(delta);
        fermentSystem.update(delta);
        customerSystem.update(delta);
        waveManager.update(delta);

        syncInteractableState();
        checkSelectionUI();
        kegSystem.updateTapLabels();
        ui.update(interactionSystem.currentTarget);
    } else if (gameState.paused) {
        ui.update(null);
    }

    renderer.render(scene, camera);
}

const startScreen = document.getElementById('start-screen');
const loadingLine = document.getElementById('loading-line');

document.addEventListener('keydown', (e) => {
    if (!gameReady || !gameState.started || gameState.paused) return;

    if (e.code === 'KeyE') {
        handleInteraction(interactionSystem.currentTarget);
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

    if (e.key >= '0' && e.key <= '9') {
        const idx = e.key === '0' ? 9 : parseInt(e.key) - 1;
        if (brewSystem.selectingRecipe !== null) {
            brewSystem.selectRecipe(idx);
            ui.hideRecipeSelection();
        } else if (kegSystem.selectingKeg !== null) {
            kegSystem.selectKeg(idx);
            ui.hideKegSelection();
        }
    }

    if (e.code === 'Escape') {
        brewSystem.cancelSelection();
        kegSystem.cancelSelection();
        ui.hideRecipeSelection();
        ui.hideKegSelection();
    }
});

document.addEventListener('click', () => {
    if (!gameReady) return;
    if (!gameState.started) {
        gameState.started = true;
        startScreen.style.display = 'none';
        player.lock();
        audioSystem.init();
        gameState.dailyCravings = recipeSystem.generateDailyCravings(1);
        ui.showDailyCravings(gameState.dailyCravings);
        ui.updateCravingsSidebar(gameState.dailyCravings);
        waveManager.startDay();
        audioSystem.playDayStart();
    } else if (gameState.paused) {
        player.lock();
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
});

async function bootstrap() {
    if (loadingLine) {
        loadingLine.textContent = 'Loading 3D models, textures & lighting…';
    }

    let assets;
    try {
        assets = await loadGameAssets(renderer, scene);
    } catch (err) {
        console.error(err);
        if (loadingLine) {
            loadingLine.textContent = 'Asset load error — try npm run fetch-assets & refresh.';
        }
        assets = { textures: {}, patronTemplate: null, envTexture: null };
    }

    world = new World(scene, assets);
    player = new Player(camera, scene, world.colliders);
    interactionSystem = new InteractionSystem(camera, world.interactables);
    brewSystem = new BrewSystem(scene, world.brewStations, gameState, audioSystem);
    fermentSystem = new FermentSystem(scene, world.fermenters, gameState, audioSystem);
    kegSystem = new KegSystem(scene, world.kegStation, world.taps, gameState, audioSystem);
    customerSystem = new CustomerSystem(
        scene,
        world.customerSpots,
        gameState,
        audioSystem,
        assets.patronTemplate
    );
    waveManager = new WaveManager(gameState, customerSystem, recipeSystem);
    upgradeSystem = new UpgradeSystem(world, gameState, audioSystem, ui);

    wireWaveCallbacks();
    buildHitboxCaches();

    if (loadingLine) {
        loadingLine.textContent = '';
    }
    gameReady = true;
    requestAnimationFrame(animate);
}

bootstrap();
