import { RECIPES } from './RecipeSystem.js';
import { getIngredientDisplayName } from './Ingredient.js';
import { RecipeManager } from './RecipeManager.js';
import { STORE_OBJECT_DEFS } from './StoreObjects.js';

export class UI {
    constructor(gameState, recipeManager) {
        this.gameState = gameState;
        this.recipeManager = recipeManager ?? new RecipeManager();
        this.elements = {};
        this._buildUI();
        this.cravingsTimeout = null;
        this.notificationQueue = [];
        this.currentNotification = null;

        this._lastMoney = null;
        this._lastScore = null;
        this._lastWaveLine = null;
        this._lastWaveGold = null;
        this._lastWaveMode = null;
        this._lastWaveDay = null;
        this._lastWaveNum = null;
        this._lastCarrying = null;
        this._lastCarryKey = null;
        this._lastKegStr = null;
        this._lastKegKey = null;
        this._lastPromptText = null;

        this.audio = null;
        this._pauseActions = null;
        this._pauseAudioWired = false;
        this._lastPauseVisible = false;
        this._lastStaminaRatio = null;
        this._lastStaminaSprint = null;
        this._lastStaminaBurst = null;
        this._lastPauseDisplay = null;
        this._recipeShopOpen = false;
    }

    attachAudio(audioSystem) {
        this.audio = audioSystem;
        this._syncPauseAudioSliders();
        this._syncStartAudioSliders();
    }

    _syncStartAudioSliders() {
        const bgm = document.getElementById('start-bgm');
        const sfx = document.getElementById('start-sfx');
        if (!this.audio || !bgm || !sfx) return;
        bgm.value = String(Math.round(this.audio.bgmVolume * 100));
        sfx.value = String(Math.round(this.audio.sfxVolume * 100));
    }

    setStartSaveButtonEnabled(hasSave) {
        const b = document.getElementById('btn-continue');
        if (b) {
            b.disabled = !hasSave;
        }
    }

    /** Next `update()` will refresh the carrying line (e.g. after [Q] drop). */
    refreshCarryingBadge() {
        this._lastCarrying = null;
        this._lastCarryKey = null;
    }

    setPauseActions(actions) {
        this._pauseActions = actions;
    }

    /** @returns {boolean} true if Escape was consumed (e.g. closed audio panel) */
    handlePauseEscape() {
        if (!this.elements.pauseAudioPanel || this.elements.pauseAudioPanel.style.display === 'none') {
            return false;
        }
        this.showPauseMainOnly();
        return true;
    }

    showPauseMainOnly() {
        if (!this.elements.pauseMainPanel || !this.elements.pauseAudioPanel) return;
        this.elements.pauseMainPanel.style.display = 'flex';
        this.elements.pauseAudioPanel.style.display = 'none';
    }

    _syncPauseAudioSliders() {
        if (!this.audio || !this.elements.pauseBgm || !this.elements.pauseSfx) return;
        this.elements.pauseBgm.value = String(Math.round(this.audio.bgmVolume * 100));
        this.elements.pauseSfx.value = String(Math.round(this.audio.sfxVolume * 100));
    }

    _wirePauseMenuOnce() {
        if (this._pauseAudioWired) return;
        this._pauseAudioWired = true;

        this.elements.pauseResume.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPauseMainOnly();
            this._pauseActions?.resume?.();
        });
        this.elements.pauseAudioBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.elements.pauseMainPanel.style.display = 'none';
            this.elements.pauseAudioPanel.style.display = 'flex';
            this._syncPauseAudioSliders();
        });
        this.elements.pauseAudioBack.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPauseMainOnly();
        });
        this.elements.pauseRestart.addEventListener('click', (e) => {
            e.stopPropagation();
            this._pauseActions?.restart?.();
        });
        this.elements.pauseRestartDay.addEventListener('click', (e) => {
            e.stopPropagation();
            this._pauseActions?.restartDay?.();
        });
        this.elements.pauseSaveExit.addEventListener('click', (e) => {
            e.stopPropagation();
            this._pauseActions?.saveExit?.();
        });

        const onBgm = () => {
            if (!this.audio) return;
            const v = Number(this.elements.pauseBgm.value) / 100;
            this.audio.setBgmVolume(v);
        };
        const onSfx = () => {
            if (!this.audio) return;
            const v = Number(this.elements.pauseSfx.value) / 100;
            this.audio.setSfxVolume(v);
        };
        this.elements.pauseBgm.addEventListener('input', onBgm);
        this.elements.pauseSfx.addEventListener('input', onSfx);
    }

    _buildUI() {
        const overlay = document.getElementById('ui-overlay');

        // Crosshair
        this.elements.crosshair = document.getElementById('crosshair');

        // Interaction prompt
        this.elements.prompt = this._createDiv('interaction-prompt', `
            position: absolute; bottom: 20%; left: 50%; transform: translateX(-50%);
            color: #fff; font-size: 18px; font-weight: bold; text-align: center;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
            padding: 8px 20px; background: rgba(0,0,0,0.5); border-radius: 8px;
            display: none; pointer-events: none;
        `, overlay);

        // Recipe selection
        this.elements.recipeSelect = this._createDiv('recipe-select', `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            color: #fff; font-size: 16px; text-align: left;
            background: rgba(12,18,32,0.94); border: 2px solid #4499bb;
            border-radius: 12px; padding: 20px 28px;
            display: none; pointer-events: none; min-width: 280px;
        `, overlay);

        // Keg selection
        this.elements.kegSelect = this._createDiv('keg-select', `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            color: #fff; font-size: 16px; text-align: left;
            background: rgba(12,18,32,0.94); border: 2px solid #668899;
            border-radius: 12px; padding: 20px 28px;
            display: none; pointer-events: none; min-width: 280px;
        `, overlay);

        this.elements.recipeShop = this._createDiv('recipe-shop', `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            color: #fff; font-size: 15px; text-align: left;
            background: rgba(10,16,28,0.97); border: 2px solid #66ccaa;
            border-radius: 14px; padding: 22px 26px;
            display: none; pointer-events: none; min-width: 300px; max-width: min(440px, 94vw);
            max-height: 78vh; overflow-y: auto; z-index: 80;
        `, overlay);

        // Carrying indicator
        this.elements.carrying = this._createDiv('carrying-indicator', `
            position: absolute; bottom: 30px; left: 30px;
            color: #fff; font-size: 16px; font-weight: bold;
            background: rgba(0,0,0,0.6); border-radius: 10px;
            padding: 10px 18px; display: none; pointer-events: none;
            border: 2px solid #4499bb;
        `, overlay);

        // Top bar container
        const topBar = this._createDiv('top-bar', `
            position: absolute; top: 0; left: 0; width: 100%;
            display: flex; justify-content: space-between; padding: 15px 25px;
            pointer-events: none;
        `, overlay);

        // Money display
        this.elements.money = this._createDiv('money-display', `
            color: #ffd700; font-size: 22px; font-weight: bold;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
            background: rgba(0,0,0,0.5); padding: 8px 16px; border-radius: 8px;
        `, topBar);

        // Wave info
        this.elements.waveInfo = this._createDiv('wave-info', `
            color: #fff; font-size: 18px; font-weight: bold;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
            text-align: center;
            background: rgba(0,0,0,0.5); padding: 8px 16px; border-radius: 8px;
        `, topBar);

        // Score display
        this.elements.score = this._createDiv('score-display', `
            color: #88ccff; font-size: 18px; font-weight: bold;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
            background: rgba(0,0,0,0.5); padding: 8px 16px; border-radius: 8px;
        `, topBar);

        // Big cravings splash (shown briefly at day start)
        this.elements.cravings = this._createDiv('daily-cravings', `
            position: absolute; top: 70px; left: 50%; transform: translateX(-50%);
            color: #ffd700; font-size: 20px; font-weight: bold; text-align: center;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
            background: rgba(14,22,38,0.92); border: 2px solid #4499bb;
            padding: 15px 30px; border-radius: 12px;
            display: none; pointer-events: none;
            transition: opacity 0.5s;
        `, overlay);

        // Persistent cravings sidebar (always visible during gameplay)
        this.elements.cravingsSidebar = this._createDiv('cravings-sidebar', `
            position: absolute; top: 60px; right: 15px;
            color: #ddd; font-size: 13px; text-align: right;
            background: rgba(15,22,38,0.8); border: 1px solid rgba(80,160,200,0.45);
            padding: 8px 12px; border-radius: 8px;
            pointer-events: none; line-height: 1.7;
            display: none;
        `, overlay);

        // Day transition banner (full-width overlay between days)
        this.elements.dayBanner = this._createDiv('day-banner', `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            display: none; flex-direction: column;
            justify-content: center; align-items: center;
            background: rgba(8,14,24,0.9);
            pointer-events: none; transition: opacity 0.6s;
        `, overlay);

        // Notification popup
        this.elements.notification = this._createDiv('notification', `
            position: absolute; top: 40%; left: 50%; transform: translateX(-50%);
            color: #fff; font-size: 24px; font-weight: bold; text-align: center;
            text-shadow: 2px 2px 6px rgba(0,0,0,0.9);
            padding: 15px 30px; border-radius: 12px;
            display: none; pointer-events: none;
            transition: opacity 0.3s, transform 0.3s;
        `, overlay);

        // Instructions (bottom right)
        this.elements.instructions = this._createDiv('instructions', `
            position: absolute; bottom: 15px; right: 15px;
            color: rgba(255,255,255,0.5); font-size: 12px;
            text-align: right; pointer-events: none; line-height: 1.6;
        `, overlay);
        this.elements.instructions.innerHTML =
            'WASD - Move &nbsp;|&nbsp; Shift - Sprint (needs full stamina)<br>' +
            'Mouse - Look &nbsp;|&nbsp; E - Interact &nbsp;|&nbsp; Q - Drop item &nbsp;|&nbsp; G - Untap Keg<br>' +
            '1-0 - Select &nbsp;|&nbsp; F - Send Customers &nbsp;|&nbsp; ESC - Pause';

        this.elements.staminaWrap = this._createDiv('stamina-wrap', `
            position: absolute; bottom: 88px; left: 30px;
            display: none; flex-direction: column; gap: 4px;
            pointer-events: none; align-items: flex-start;
        `, overlay);
        this.elements.staminaLabel = this._createDiv('stamina-label', `
            color: #88ccff; font-size: 11px; font-weight: bold;
            letter-spacing: 1px; text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
            opacity: 0.85;
        `, this.elements.staminaWrap);
        this.elements.staminaLabel.textContent = 'STAMINA';
        const barOuter = this._createDiv('stamina-bar-outer', `
            width: 160px; height: 12px; background: rgba(0,0,0,0.55);
            border: 1px solid rgba(80,160,200,0.5); border-radius: 4px;
            overflow: hidden; box-sizing: border-box;
        `, this.elements.staminaWrap);
        this.elements.staminaFill = this._createDiv('stamina-fill', `
            width: 100%; height: 100%; background: linear-gradient(90deg, #2a8a9e, #66eeff);
            border-radius: 2px; transform-origin: left center;
            transform: scaleX(1); transition: transform 0.08s linear, filter 0.15s;
        `, barOuter);

        // Keg inventory (bottom center)
        this.elements.kegInventory = this._createDiv('keg-inventory', `
            position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
            color: #ccc; font-size: 14px; text-align: center;
            background: rgba(0,0,0,0.4); padding: 6px 14px; border-radius: 6px;
            pointer-events: none;
        `, overlay);

        // Pause overlay (pointer-events auto so buttons work; blocks clicks to canvas)
        this.elements.pause = document.createElement('div');
        this.elements.pause.id = 'pause-overlay';
        this.elements.pause.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.78); display: none; z-index: 80;
            justify-content: center; align-items: center; flex-direction: column;
            pointer-events: auto;
        `;

        const cardStyle =
            'background: rgba(16,28,48,0.96); padding: 26px 32px; border-radius: 14px; ' +
            'border: 1px solid rgba(100,180,220,0.45); display: flex; flex-direction: column; ' +
            'gap: 12px; align-items: stretch; min-width: 300px; max-width: 92vw; ' +
            'box-shadow: 0 12px 40px rgba(0,0,0,0.5);';

        this.elements.pauseMainPanel = document.createElement('div');
        this.elements.pauseMainPanel.id = 'pause-panel-main';
        this.elements.pauseMainPanel.style.cssText = cardStyle;

        const title = document.createElement('div');
        title.textContent = 'Paused';
        title.style.cssText =
            'font-size: 30px; font-weight: bold; text-align: center; color: #66eeff; margin-bottom: 6px;';
        this.elements.pauseMainPanel.appendChild(title);

        const sub = document.createElement('div');
        sub.textContent = 'Pointer lock released — choose an option';
        sub.style.cssText = 'font-size: 13px; color: #8aa0b8; text-align: center; margin-bottom: 8px;';
        this.elements.pauseMainPanel.appendChild(sub);

        const mkBtn = (id, label) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.id = id;
            b.textContent = label;
            b.style.cssText =
                'font-size:17px;padding:11px 18px;cursor:pointer;border-radius:8px;border:1px solid #5588aa;' +
                'background:#1a3048;color:#e8f4ff;width:100%;';
            return b;
        };

        this.elements.pauseResume = mkBtn('pause-resume', 'Resume');
        this.elements.pauseAudioBtn = mkBtn('pause-audio', 'Audio settings');
        this.elements.pauseRestartDay = mkBtn('pause-restart-day', 'Restart day');
        this.elements.pauseSaveExit = mkBtn('pause-save-exit', 'Save & exit to menu');
        this.elements.pauseRestart = mkBtn('pause-restart', 'Restart game (full reset)');
        this.elements.pauseMainPanel.appendChild(this.elements.pauseResume);
        this.elements.pauseMainPanel.appendChild(this.elements.pauseAudioBtn);
        this.elements.pauseMainPanel.appendChild(this.elements.pauseRestartDay);
        this.elements.pauseMainPanel.appendChild(this.elements.pauseSaveExit);
        this.elements.pauseMainPanel.appendChild(this.elements.pauseRestart);

        this.elements.pauseAudioPanel = document.createElement('div');
        this.elements.pauseAudioPanel.id = 'pause-panel-audio';
        this.elements.pauseAudioPanel.style.cssText = cardStyle + ' display: none;';

        const audioTitle = document.createElement('div');
        audioTitle.textContent = 'Audio';
        audioTitle.style.cssText =
            'font-size: 26px; font-weight: bold; text-align: center; color: #66eeff; margin-bottom: 4px;';
        this.elements.pauseAudioPanel.appendChild(audioTitle);

        const row = (labelText, inputId) => {
            const wrap = document.createElement('label');
            wrap.style.cssText =
                'display: flex; flex-direction: column; gap: 6px; color: #c8d8e8; font-size: 14px;';
            wrap.textContent = labelText;
            const input = document.createElement('input');
            input.type = 'range';
            input.id = inputId;
            input.min = '0';
            input.max = '100';
            input.step = '1';
            input.style.cssText = 'width: 100%; accent-color: #44aacc;';
            wrap.appendChild(input);
            return { wrap, input };
        };

        const bgmRow = row('Music volume', 'pause-bgm');
        this.elements.pauseAudioPanel.appendChild(bgmRow.wrap);
        this.elements.pauseBgm = bgmRow.input;

        const sfxRow = row('Sound effects volume', 'pause-sfx');
        this.elements.pauseAudioPanel.appendChild(sfxRow.wrap);
        this.elements.pauseSfx = sfxRow.input;

        this.elements.pauseAudioBack = mkBtn('pause-audio-back', 'Back');
        this.elements.pauseAudioPanel.appendChild(this.elements.pauseAudioBack);

        this.elements.pause.appendChild(this.elements.pauseMainPanel);
        this.elements.pause.appendChild(this.elements.pauseAudioPanel);
        overlay.appendChild(this.elements.pause);

        this._wirePauseMenuOnce();
    }

    _createDiv(id, style, parent) {
        const div = document.createElement('div');
        div.id = id;
        div.style.cssText = style;
        parent.appendChild(div);
        return div;
    }

    update(currentTarget, player = null, opts = {}) {
        const gs = this.gameState;
        const p = gs.player;
        const canConv = !!opts.canConvince;

        if (player && typeof player.stamina === 'number') {
            const showStamina = gs.started;
            this.elements.staminaWrap.style.display = showStamina ? 'flex' : 'none';
            if (showStamina) {
                const ratio = Math.max(0, Math.min(1, player.stamina / (player.staminaMax || 1)));
                const canBurst = ratio >= 0.995;
                const sprinting = !!player._sprintActive;
                const ratioChanged =
                    this._lastStaminaRatio == null || Math.abs(ratio - this._lastStaminaRatio) > 0.008;
                const modeChanged =
                    sprinting !== this._lastStaminaSprint || canBurst !== this._lastStaminaBurst;
                if (ratioChanged || modeChanged) {
                    if (ratioChanged) this._lastStaminaRatio = ratio;
                    this._lastStaminaSprint = sprinting;
                    this._lastStaminaBurst = canBurst;
                    this.elements.staminaFill.style.transform = `scaleX(${ratio})`;
                    this.elements.staminaFill.style.filter = sprinting
                        ? 'brightness(1.25) saturate(1.2)'
                        : canBurst
                            ? 'brightness(1.05)'
                            : 'brightness(0.55) saturate(0.7)';
                    this.elements.staminaLabel.style.opacity = canBurst ? '1' : '0.65';
                }
            } else {
                this._lastStaminaRatio = null;
                this._lastStaminaSprint = null;
                this._lastStaminaBurst = null;
            }
        }

        if (p.money !== this._lastMoney) {
            this._lastMoney = p.money;
            this.elements.money.textContent = `$${p.money}`;
        }

        if (p.score !== this._lastScore) {
            this._lastScore = p.score;
            this.elements.score.textContent = `Score: ${p.score}`;
        }

        // Avoid rebuilding the wave-line template string every frame — only reformat when
        // one of the inputs actually changed.
        const waveMode = gs.waveActive ? 1 : gs.waitingForPlayer ? 2 : gs.started ? 3 : 0;
        if (
            waveMode !== this._lastWaveMode ||
            gs.dayNumber !== this._lastWaveDay ||
            gs.currentWave !== this._lastWaveNum
        ) {
            this._lastWaveMode = waveMode;
            this._lastWaveDay = gs.dayNumber;
            this._lastWaveNum = gs.currentWave;
            let waveLine = '';
            if (waveMode === 1) waveLine = `Day ${gs.dayNumber} - Wave ${gs.currentWave}`;
            else if (waveMode === 2) waveLine = `Day ${gs.dayNumber} - Press [F] when ready!`;
            else if (waveMode === 3) waveLine = `Day ${gs.dayNumber} - Break`;
            const waveGold = waveMode === 2;
            this._lastWaveLine = waveLine;
            this._lastWaveGold = waveGold;
            this.elements.waveInfo.textContent = waveLine;
            this.elements.waveInfo.style.color = waveGold ? '#ffd700' : '#fff';
        }

        // Compute a cheap "shape key" first. If the shape matches last frame, we skip
        // the string formatting + template allocations entirely.
        let carryKey = '';
        const c = p.carrying;
        if (c) {
            if (c.type === 'ingredient') carryKey = 'i:' + c.ingredientId;
            else if (c.type === 'milledBatch') carryKey = 'm';
            else if (c.type === 'wort')
                carryKey = 'w:' + (c.recipe?.id || '') + ':' + (c.batchValid === false ? '1' : '0');
            else if (c.type === 'beer')
                carryKey =
                    'b:' + (c.recipe?.id || '') +
                    ':' + (c.batchValid === false ? '1' : '0') +
                    ':' + (c.premiumLager ? '1' : '0');
            else if (c.type === 'bucket') {
                const ids = c.ingredientIds || [];
                let n = 0;
                for (let i = 0; i < ids.length; i++) if (ids[i]) n++;
                carryKey = 'k:' + (c.milled ? '1' : '0') + ':' + n;
            }
        }
        if (carryKey !== this._lastCarryKey) {
            this._lastCarryKey = carryKey;
            let carryStr = '';
            if (c) {
                if (c.type === 'ingredient') {
                    carryStr = `Holding: ${getIngredientDisplayName(c.ingredientId)}`;
                } else if (c.type === 'milledBatch') {
                    carryStr = 'Holding: Milled Grain Batch';
                } else if (c.type === 'wort') {
                    const tag = c.batchValid === false ? ' (off batch)' : '';
                    carryStr = `🫗 Carrying: ${c.recipe.name} Wort${tag}`;
                } else if (c.type === 'beer') {
                    const tag = c.batchValid === false ? ' (off batch)' : '';
                    const prem = c.premiumLager ? ' (premium lager)' : '';
                    carryStr = `🍺 Carrying: ${c.recipe.name} Beer${tag}${prem}`;
                } else if (c.type === 'bucket') {
                    const ids = c.ingredientIds || [];
                    let n = 0;
                    for (let i = 0; i < ids.length; i++) if (ids[i]) n++;
                    if (c.milled && n === 3) carryStr = 'Holding: Bucket with milled grist';
                    else
                        carryStr =
                            n === 0
                                ? 'Holding: Empty bucket'
                                : `Holding: Bucket with grist (${n}/3)`;
                }
            }
            this._lastCarrying = carryStr;
            if (carryStr) {
                this.elements.carrying.style.display = 'block';
                this.elements.carrying.textContent = carryStr;
            } else {
                this.elements.carrying.style.display = 'none';
            }
        }

        if (currentTarget && currentTarget.userData) {
            this._showPrompt(currentTarget.userData, p);
        } else if (canConv) {
            const t = '[V] Suggest another beer (patron across the bar)';
            if (t !== this._lastPromptText) {
                this._lastPromptText = t;
                this.elements.prompt.textContent = t;
            }
            this.elements.prompt.style.display = 'block';
        } else if (this._lastPromptText != null) {
            this._lastPromptText = null;
            this.elements.prompt.style.display = 'none';
        }

        // Skip the string/map/join if the keg count hasn't changed and recipe ids are
        // still the same — common case during normal play.
        const kegs = gs.kegs;
        let kegKey = '';
        for (let i = 0; i < kegs.length; i++) {
            kegKey += (i ? ',' : '') + kegs[i].recipe.id;
        }
        if (kegKey !== this._lastKegKey) {
            this._lastKegKey = kegKey;
            let kegStr = '';
            if (kegs.length > 0) {
                let s = 'Kegs: ';
                for (let i = 0; i < kegs.length; i++) {
                    if (i) s += ', ';
                    s += kegs[i].recipe.name;
                }
                kegStr = s;
            }
            this._lastKegStr = kegStr;
            if (kegStr) {
                this.elements.kegInventory.textContent = kegStr;
                this.elements.kegInventory.style.display = 'block';
            } else {
                this.elements.kegInventory.style.display = 'none';
            }
        }

        const nowPaused = gs.paused && gs.started;
        if (nowPaused !== this._lastPauseVisible) {
            this._lastPauseVisible = nowPaused;
            if (nowPaused) this.showPauseMainOnly();
        }
        const pauseDisp = nowPaused ? 'flex' : 'none';
        if (pauseDisp !== this._lastPauseDisplay) {
            this._lastPauseDisplay = pauseDisp;
            this.elements.pause.style.display = pauseDisp;
        }
    }

    _showPrompt(data, player) {
        let text = '';
        const type = data.type;

        // Locked equipment — show purchase prompt
        if (data._locked) {
            text = `Press [E] to Buy — $${data._cost}`;
            this.elements.prompt.textContent = text;
            this.elements.prompt.style.display = 'block';
            return;
        }

        if (type === 'brewStation') {
            if (data._state === 'empty' && player.carrying?.type === 'milledBatch') {
                text = 'Press [E] to load milled grain & choose recipe';
            } else if (
                data._state === 'empty' &&
                player.carrying?.type === 'bucket' &&
                player.carrying.milled
            ) {
                text = 'Press [E] to load milled grain & choose recipe';
            } else if (data._state === 'empty' && data._awaitingRecipe && !player.carrying) {
                text = 'Press [E] to choose beer recipe';
            } else if (data._state === 'empty' && !player.carrying) {
                text = 'Bring a milled grain batch from the mill';
            } else if (data._state === 'empty' && player.carrying) {
                text = 'Brew Station (need milled batch in hands)';
            } else if (data._state === 'brewing') {
                text = 'Brewing in progress...';
            } else if (data._state === 'done' && !player.carrying) {
                text = data._wortNoFermenterSlot
                    ? 'Bio-tanks full — use floor drain or free a tank'
                    : data._badBatch
                        ? 'Press [E] to Collect Wort (bad batch — quality suffers)'
                        : 'Press [E] to Collect Wort';
            } else if (data._state === 'done') {
                text = 'Wort ready! (hands full)';
            }
        } else if (type === 'fermenter') {
            if (data._state === 'empty' && player.carrying?.type === 'wort') {
                text = 'Press [E] to Load Fermenter';
            } else if (data._state === 'fermenting') {
                text = 'Fermenting...';
            } else if (data._state === 'done' && !player.carrying) {
                text = 'Press [E] to Collect Beer';
            } else if (data._state === 'done') {
                text = 'Beer ready! (hands full)';
            } else if (data._state === 'empty') {
                text = 'Fermenter Empty (bring wort)';
            }
        } else if (type === 'lagerTank') {
            if (data._state === 'empty' && player.carrying?.type === 'wort') {
                text =
                    player.carrying.recipe?.id !== 'lager'
                        ? 'Lager Tank — only lager wort'
                        : 'Press [E] to load Lager Tank (premium payout)';
            } else if (data._state === 'fermenting') {
                text = 'Lagering...';
            } else if (data._state === 'done' && !player.carrying) {
                text = 'Press [E] to Collect Premium Lager';
            } else if (data._state === 'done') {
                text = 'Premium lager ready! (hands full)';
            } else if (data._state === 'empty') {
                text = 'Lager Tank — bring lager wort from the mash tun';
            }
        } else if (type === 'kegStation') {
            if (player.carrying?.type === 'beer') {
                text = 'Press [E] to Keg Beer';
            } else if (player.carrying?.type === 'wort') {
                text = 'Keg Station (needs fermented beer, not wort)';
            } else {
                text = 'Keg Station (bring fermented beer)';
            }
        } else if (type === 'tap') {
            const vHint = data._canConvince ? '  |  [V] Suggest another beer on tap' : '';
            if (data._hasKeg && data._canUntap) {
                text = `[E] Serve ${data._beerName || 'Beer'}  |  [G] Untap (full keg)${vHint}`;
            } else if (data._hasKeg) {
                text = `Press [E] to Serve ${data._beerName || 'Beer'}${vHint}`;
            } else if (data._kegsAvailable) {
                text = `Press [E] to Load Tap${vHint}`;
            } else {
                text = `Tap Empty (no kegs available)${vHint}`;
            }
        } else if (type === 'wortDrain') {
            if (player.carrying?.type === 'wort') {
                text = 'Press [E] to dump wort in drain';
            } else {
                text = 'Floor drain (dump wort you cannot use)';
            }
        } else if (type === 'recipeShop') {
            text = 'Press [E] Supply terminal — recipes & tools';
        } else if (type === 'ingredientBin') {
            if (player.carrying?.type === 'bucket') {
                const ids = player.carrying.ingredientIds;
                if (ids?.every(Boolean)) {
                    text = player.carrying.milled
                        ? 'Milled — take this to a brew kettle'
                        : 'Bucket full';
                } else if (ids?.includes(data.ingredientId)) {
                    text = 'That ingredient is already in the bucket';
                } else {
                    text = `Press [E] to add ${getIngredientDisplayName(data.ingredientId)} to bucket`;
                }
            } else if (!player.carrying) {
                text = `Press [E] to pick up ${getIngredientDisplayName(data.ingredientId)}`;
            } else {
                text = 'Hands full — [Q] to drop item';
            }
        } else if (type === 'grainMill') {
            if (data._millState === 'milling') {
                text = 'Milling grain...';
            } else if (player.carrying?.type === 'ingredient') {
                text = 'Press [E] to add grain to mill';
            } else if (player.carrying?.type === 'bucket') {
                if (player.carrying.milled) {
                    text = 'Milled grist — take this to a brew kettle';
                } else {
                    const ids = player.carrying.ingredientIds;
                    const full = ids?.length === 3 && ids.every(Boolean);
                    const empty = ids?.length === 3 && !ids.some(Boolean);
                    const partial = ids?.some(Boolean) && !full;
                    if (partial) {
                        text = 'Finish filling the bucket first';
                    } else if (full && data._millFilled === 0) {
                        text = 'Press [E] to dump bucket into the mill';
                    } else if (empty && data._millFilled >= 3) {
                        text = 'Press [E] to start milling (bucket ok in hand)';
                    } else if (empty) {
                        text = 'Fill the bucket from the ingredient bins';
                    } else {
                        text = 'Empty the mill hopper before dumping the bucket';
                    }
                }
            } else if (!player.carrying && data._millFilled >= 3) {
                text = 'Press [E] to mill grain (3/3)';
            } else if (!player.carrying) {
                text = `Grain mill ${data._millFilled}/3 — pick up malt & hops`;
            } else {
                text = 'Grain mill (drop item with [Q] if needed)';
            }
        } else if (type === 'looseGrainBucket') {
            if (data.millLocked) {
                text = 'Milling grain...';
            } else if (!player.carrying) {
                text = data.milled
                    ? 'Press [E] to pick up bucket (milled grist)'
                    : 'Press [E] to pick up ingredient bucket';
            } else {
                text = 'Hands full';
            }
        } else if (type === 'looseIngredient') {
            if (!player.carrying) {
                text = `Press [E] to pick up ${getIngredientDisplayName(data.ingredientId)}`;
            } else {
                text = 'Hands full';
            }
        } else if (type === 'looseMilledBatch') {
            if (!player.carrying) {
                text = 'Press [E] to pick up Milled Grain Batch';
            } else {
                text = 'Hands full';
            }
        } else if (type === 'dryStorageSlot') {
            const rn = data._rackNum ?? '?';
            const sn = data._slotNum ?? '?';
            if (player.carrying?.type === 'milledBatch') {
                text = data._filled
                    ? `Dry ${rn} slot ${sn} full`
                    : `Press [E] to stash milled batch (Dry ${rn}, slot ${sn}/8)`;
            } else if (player.carrying) {
                text = `Dry storage: milled batches only (Dry ${rn} slot ${sn})`;
            } else if (data._filled) {
                text = `Press [E] to take milled batch (Dry ${rn}, slot ${sn}/8)`;
            } else {
                text = `Empty slot ${sn}/8 — stash a milled batch here`;
            }
        }

        if (text) {
            if (text !== this._lastPromptText) {
                this._lastPromptText = text;
                this.elements.prompt.textContent = text;
            }
            this.elements.prompt.style.display = 'block';
        } else if (this._lastPromptText != null) {
            this._lastPromptText = null;
            this.elements.prompt.style.display = 'none';
        }
    }

    showRecipeSelection(stationIndex) {
        const unlocked = RECIPES.filter((r) => this.gameState.unlockedRecipeIds?.includes(r.id));
        let html = '<div style="font-size:20px;color:#ffd700;margin-bottom:12px;">Select Recipe:</div>';
        if (unlocked.length === 0) {
            html += '<div style="color:#f88;">No recipes unlocked — visit the recipe kiosk.</div>';
        }
        const cravingIds = new Set((this.gameState.dailyCravings || []).map((c) => c.id));
        unlocked.forEach((r, i) => {
            const colorHex = '#' + r.color.toString(16).padStart(6, '0');
            const keyLabel = i < 9 ? i + 1 : i === 9 ? 0 : '—';
            const wanted = cravingIds.has(r.id);
            const badge = wanted
                ? `<span style="color:#4caf50;font-size:11px;margin-left:4px;">WANTED</span>`
                : '';
            html += `<div style="margin:5px 0;padding:3px 0;${wanted ? 'background:rgba(76,175,80,0.08);border-radius:4px;padding-left:4px;' : ''}">` +
                `<span style="color:#ffd700;font-weight:bold;">[${keyLabel}]</span> ` +
                `<span style="display:inline-block;width:14px;height:14px;background:${colorHex};` +
                `border-radius:3px;vertical-align:middle;margin-right:6px;border:1px solid #666;"></span>` +
                `<span style="color:#fff;">${r.name}</span> ` +
                `<span style="color:#aaa;font-size:13px;">- ${r.description}</span>${badge}</div>`;
        });
        html += '<div style="color:#888;font-size:13px;margin-top:10px;">Number to select · [Esc] or [Tab] to close · walk away cancels</div>';
        this.elements.recipeSelect.innerHTML = html;
        this.elements.recipeSelect.style.display = 'block';
    }

    hideRecipeSelection() {
        this.elements.recipeSelect.style.display = 'none';
    }

    isRecipeShopOpen() {
        return this._recipeShopOpen;
    }

    openRecipeShop() {
        this._recipeShopOpen = true;
        this.gameState.recipeShopOpen = true;
        this.gameState.supplyTerminalView = 'home';
        this._renderRecipeShopContent();
        this.elements.recipeShop.style.display = 'block';
        this.elements.recipeShop.style.pointerEvents = 'auto';
        try {
            document.exitPointerLock?.();
        } catch (_) {
            /* ignore */
        }
    }

    /**
     * @param {boolean} [clearPauseFlagNow] — pass true when leaving play (title menu); otherwise
     *   `gameState.recipeShopOpen` stays true until pointer lock returns so the pause overlay does not flash.
     */
    closeRecipeShop(clearPauseFlagNow = false) {
        this._recipeShopOpen = false;
        this.elements.recipeShop.style.display = 'none';
        this.elements.recipeShop.style.pointerEvents = 'none';
        if (clearPauseFlagNow || this.gameState._pointerLockFailed) {
            this.gameState.recipeShopOpen = false;
        }
    }

    refreshRecipeShopContent() {
        if (this._recipeShopOpen) this._renderRecipeShopContent();
    }

    _renderRecipeShopContent() {
        const gs = this.gameState;
        if (!gs.supplyTerminalView) gs.supplyTerminalView = 'home';
        const view = gs.supplyTerminalView;
        const ownedRecipes = new Set(gs.unlockedRecipeIds || []);
        const ownedObjects = new Set(gs.ownedObjectIds || []);

        let html =
            '<div style="font-size:20px;color:#66eecc;margin-bottom:10px;">Supply Terminal</div>';

        if (view === 'home') {
            html +=
                '<div style="color:#9ab;font-size:13px;margin-bottom:16px;line-height:1.45;">' +
                'Choose what to browse. Pick a category, then use number keys to buy. ' +
                'The ingredient bucket is filled by visiting each bin along the wall.</div>' +
                '<div style="color:#ccd;font-size:15px;margin-bottom:12px;font-weight:600;">Main menu</div>' +
                '<div style="margin:12px 0;padding:12px 0;border-top:1px solid rgba(80,140,120,0.25);border-bottom:1px solid rgba(80,140,120,0.25);">' +
                '<div style="margin:10px 0;line-height:1.5;">' +
                '<span style="color:#ffd700;font-weight:bold;">[1]</span> ' +
                '<span style="color:#fff;">Tools</span> ' +
                '<span style="color:#8ab;font-size:13px;">— buckets &amp; equipment</span>' +
                '</div>' +
                '<div style="margin:10px 0;line-height:1.5;">' +
                '<span style="color:#ffd700;font-weight:bold;">[2]</span> ' +
                '<span style="color:#fff;">Recipes</span> ' +
                '<span style="color:#8ab;font-size:13px;">— unlock beer styles for the board</span>' +
                '</div>' +
                '</div>' +
                '<div style="color:#888;font-size:12px;margin-top:14px;">' +
                '[Esc] or [Tab] close — click game to look again' +
                '</div>';
            this.elements.recipeShop.innerHTML = html;
            return;
        }

        const backLine =
            '<div style="color:#9ac;font-size:12px;margin:14px 0 10px;">' +
            '<span style="color:#ffd700;font-weight:bold;">[Backspace]</span> Back to main menu' +
            '</div>';

        if (view === 'recipes') {
            html +=
                '<div style="color:#aac;font-size:13px;margin-bottom:8px;">Recipes</div>' +
                '<div style="color:#9ab;font-size:13px;margin-bottom:12px;line-height:1.45;">' +
                'Unlocked beers can appear as daily cravings on the board.</div>';

            html += '<div style="color:#aaa;font-size:12px;margin:10px 0 6px;">Owned</div>';
            RECIPES.filter((r) => ownedRecipes.has(r.id)).forEach((r) => {
                const colorHex = '#' + r.color.toString(16).padStart(6, '0');
                html +=
                    `<div style="margin:4px 0;opacity:0.9;">` +
                    `<span style="display:inline-block;width:12px;height:12px;background:${colorHex};` +
                    `border-radius:3px;margin-right:6px;vertical-align:middle;border:1px solid #555;"></span>` +
                    `<span style="color:#8d8;">${r.name}</span>` +
                    (r.unlockCost <= 0 ? ` <span style="color:#666;font-size:11px;">(starter)</span>` : '') +
                    `</div>`;
            });

            const locked = RECIPES.filter((r) => !ownedRecipes.has(r.id));
            if (locked.length === 0) {
                html += '<div style="color:#8c8;margin-top:12px;">All recipes owned.</div>';
            } else {
                html +=
                    '<div style="color:#aaa;font-size:12px;margin:12px 0 6px;">For sale — number keys</div>';
                locked.forEach((r, i) => {
                    const colorHex = '#' + r.color.toString(16).padStart(6, '0');
                    const keyLabel = i < 9 ? i + 1 : i === 9 ? 0 : null;
                    const keyHtml =
                        keyLabel != null
                            ? `<span style="color:#ffd700;font-weight:bold;">[${keyLabel}]</span> `
                            : '';
                    html +=
                        `<div style="margin:6px 0;padding:6px 0;border-bottom:1px solid rgba(80,120,100,0.25);">` +
                        keyHtml +
                        `<span style="display:inline-block;width:12px;height:12px;background:${colorHex};` +
                        `border-radius:3px;margin-right:6px;vertical-align:middle;border:1px solid #555;"></span>` +
                        `<span style="color:#fff;">${r.name}</span> ` +
                        `<span style="color:#88ccff;">$${r.unlockCost ?? 0}</span></div>`;
                });
            }
            html += backLine;
            html +=
                '<div style="color:#888;font-size:12px;margin-top:8px;">' +
                '[Esc] or [Tab] closes the terminal' +
                '</div>';
            this.elements.recipeShop.innerHTML = html;
            return;
        }

        /* tools */
        html +=
            '<div style="color:#aac;font-size:13px;margin-bottom:8px;">Tools</div>' +
            '<div style="color:#9ab;font-size:13px;margin-bottom:12px;line-height:1.45;">' +
            'One-time purchases. Extra bio-tanks and bar taps appear in the world when bought. ' +
            'The ingredient bucket appears by the bins when bought.</div>';

        html += '<div style="color:#aaa;font-size:12px;margin:10px 0 6px;">Catalog</div>';
        STORE_OBJECT_DEFS.forEach((obj, i) => {
            const have = ownedObjects.has(obj.id);
            const keyLabel = i < 9 ? i + 1 : i === 9 ? 0 : null;
            const keyHtml =
                keyLabel != null && !have
                    ? `<span style="color:#ffd700;font-weight:bold;">[${keyLabel}]</span> `
                    : '';
            html +=
                `<div style="margin:8px 0;padding:6px 0;border-bottom:1px solid rgba(80,100,120,0.25);">` +
                keyHtml +
                `<span style="color:#fff;">${obj.name}</span> ` +
                (have
                    ? '<span style="color:#6c8;">(owned)</span>'
                    : `<span style="color:#88ccff;">$${obj.cost}</span>`) +
                `<div style="color:#8ab;font-size:12px;margin-top:4px;">${obj.blurb}</div></div>`;
        });
        html += backLine;
        html +=
            '<div style="color:#888;font-size:12px;margin-top:8px;">' +
            '[Esc] or [Tab] closes the terminal' +
            '</div>';
        this.elements.recipeShop.innerHTML = html;
    }

    showKegSelection(kegs) {
        if (kegs.length === 0) {
            this.elements.kegSelect.style.display = 'none';
            return;
        }
        let html = '<div style="font-size:20px;color:#ccc;margin-bottom:12px;">Select Keg for Tap:</div>';
        kegs.forEach((k, i) => {
            const colorHex = '#' + k.recipe.color.toString(16).padStart(6, '0');
            html += `<div style="margin:6px 0;">` +
                `<span style="color:#ffd700;font-weight:bold;">[${i + 1}]</span> ` +
                `<span style="display:inline-block;width:14px;height:14px;background:${colorHex};` +
                `border-radius:3px;vertical-align:middle;margin-right:6px;border:1px solid #666;"></span>` +
                `${k.recipe.name} (${k.servings} servings)</div>`;
        });
        html += '<div style="color:#888;font-size:13px;margin-top:10px;">Number to select · [Esc] or [Tab] to close</div>';
        this.elements.kegSelect.innerHTML = html;
        this.elements.kegSelect.style.display = 'block';
    }

    hideKegSelection() {
        this.elements.kegSelect.style.display = 'none';
    }

    showDailyCravings(cravings) {
        const rm = this.recipeManager;
        const body = rm?.formatCravingsWithRecipes(cravings) || '';
        this.elements.cravings.innerHTML =
            `<div style="font-size:14px;color:#ccc;margin-bottom:8px;">TODAY'S CRAVINGS — MEMORIZE</div>` +
            `<div style="font-size:15px;line-height:1.45;max-width:min(420px,92vw);">${body}</div>`;
        this.elements.cravings.style.display = 'block';
        this.elements.cravings.style.opacity = '1';

        clearTimeout(this.cravingsTimeout);
        const always = rm?.showRecipesAlways;
        const sec = rm?.chalkboardSeconds ?? 16;
        if (!always) {
            this.cravingsTimeout = setTimeout(() => {
                this.elements.cravings.style.opacity = '0';
                setTimeout(() => {
                    this.elements.cravings.style.display = 'none';
                }, 500);
            }, sec * 1000);
        }

        this.updateCravingsSidebar(cravings);
    }

    updateCravingsSidebar(cravings) {
        if (!cravings || cravings.length === 0) {
            this.elements.cravingsSidebar.style.display = 'none';
            return;
        }
        const rm = this.recipeManager;
        const reveal = rm?.showRecipesAlways;
        const items = rm
            ? rm.formatCravingsSidebar(cravings, reveal)
            : cravings.map((c) => `<span style="color:#ffd700;">${c.name}</span>`).join('<br>');
        this.elements.cravingsSidebar.innerHTML =
            `<div style="color:#66aacc;font-size:11px;font-weight:bold;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px;">Today's Cravings</div>` +
            items;
        this.elements.cravingsSidebar.style.display = 'block';
    }

    showDayTransition(dayNumber, summary) {
        const banner = this.elements.dayBanner;
        let summaryHtml = '';
        if (summary) {
            summaryHtml = `
                <div style="font-size:16px;color:#ccc;margin-top:16px;line-height:1.8;">
                    <span style="color:#ffd700;">Earned: $${summary.moneyEarned}</span><br>
                    <span style="color:#88ccff;">Total: $${summary.totalMoney}</span><br>
                    <span style="color:#aaa;">Waves survived: ${summary.wavesCompleted}</span>
                </div>
            `;
        }

        const cravings = this.gameState.dailyCravings;
        const rm = this.recipeManager;
        const cravingsBlock = rm
            ? rm.formatCravingsWithRecipes(cravings)
            : cravings.map((c) => `<span style="color:#ffd700;">${c.name}</span>`).join('<br>');

        banner.innerHTML = `
            <div style="font-size:42px;font-weight:bold;color:#ffd700;text-shadow:3px 3px 8px rgba(0,0,0,0.9);margin-bottom:8px;">
                Day ${dayNumber}
            </div>
            ${summaryHtml}
            <div style="margin-top:24px;padding:16px 28px;background:rgba(14,22,38,0.88);border:2px solid #4499bb;border-radius:12px;text-align:center;">
                <div style="font-size:13px;color:#66ccff;font-weight:bold;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">New Cravings & Recipes</div>
                <div style="font-size:15px;line-height:1.5;text-align:left;display:inline-block;">${cravingsBlock}</div>
            </div>
            <div style="font-size:14px;color:rgba(255,255,255,0.4);margin-top:20px;">Memorize the grain bills — the chalkboard will clear!</div>
        `;

        banner.style.display = 'flex';
        banner.style.opacity = '1';

        clearTimeout(this._dayBannerTimeout);
        this._dayBannerTimeout = setTimeout(() => {
            banner.style.opacity = '0';
            setTimeout(() => { banner.style.display = 'none'; }, 600);
        }, 5000);
    }

    showNotification(text, color = 'rgba(14,22,38,0.92)', duration = 2000) {
        this.elements.notification.textContent = text;
        this.elements.notification.style.background = color;
        this.elements.notification.style.display = 'block';
        this.elements.notification.style.opacity = '1';

        setTimeout(() => {
            this.elements.notification.style.opacity = '0';
            setTimeout(() => {
                this.elements.notification.style.display = 'none';
            }, 300);
        }, duration);
    }
}
