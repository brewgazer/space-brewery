import { RECIPES } from './RecipeSystem.js';

export class UI {
    constructor(gameState) {
        this.gameState = gameState;
        this.elements = {};
        this._buildUI();
        this.cravingsTimeout = null;
        this.notificationQueue = [];
        this.currentNotification = null;

        this._lastMoney = null;
        this._lastScore = null;
        this._lastWaveLine = null;
        this._lastWaveGold = null;
        this._lastCarrying = null;
        this._lastKegStr = null;
        this._lastPromptText = null;
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
            background: rgba(20,10,5,0.92); border: 2px solid #b87333;
            border-radius: 12px; padding: 20px 28px;
            display: none; pointer-events: none; min-width: 280px;
        `, overlay);

        // Keg selection
        this.elements.kegSelect = this._createDiv('keg-select', `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            color: #fff; font-size: 16px; text-align: left;
            background: rgba(20,10,5,0.92); border: 2px solid #888;
            border-radius: 12px; padding: 20px 28px;
            display: none; pointer-events: none; min-width: 280px;
        `, overlay);

        // Carrying indicator
        this.elements.carrying = this._createDiv('carrying-indicator', `
            position: absolute; bottom: 30px; left: 30px;
            color: #fff; font-size: 16px; font-weight: bold;
            background: rgba(0,0,0,0.6); border-radius: 10px;
            padding: 10px 18px; display: none; pointer-events: none;
            border: 2px solid #b87333;
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
            background: rgba(40,20,5,0.9); border: 2px solid #b87333;
            padding: 15px 30px; border-radius: 12px;
            display: none; pointer-events: none;
            transition: opacity 0.5s;
        `, overlay);

        // Persistent cravings sidebar (always visible during gameplay)
        this.elements.cravingsSidebar = this._createDiv('cravings-sidebar', `
            position: absolute; top: 60px; right: 15px;
            color: #ddd; font-size: 13px; text-align: right;
            background: rgba(30,15,5,0.75); border: 1px solid rgba(184,115,51,0.4);
            padding: 8px 12px; border-radius: 8px;
            pointer-events: none; line-height: 1.7;
            display: none;
        `, overlay);

        // Day transition banner (full-width overlay between days)
        this.elements.dayBanner = this._createDiv('day-banner', `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            display: none; flex-direction: column;
            justify-content: center; align-items: center;
            background: rgba(10,5,2,0.85);
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
            'WASD - Move &nbsp;|&nbsp; Mouse - Look<br>' +
            'E - Interact &nbsp;|&nbsp; G - Untap Keg<br>' +
            '1-0 - Select &nbsp;|&nbsp; F - Send Customers<br>' +
            'ESC - Pause';

        // Keg inventory (bottom center)
        this.elements.kegInventory = this._createDiv('keg-inventory', `
            position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
            color: #ccc; font-size: 14px; text-align: center;
            background: rgba(0,0,0,0.4); padding: 6px 14px; border-radius: 6px;
            pointer-events: none;
        `, overlay);

        // Pause overlay
        this.elements.pause = this._createDiv('pause-overlay', `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); display: none;
            justify-content: center; align-items: center;
            font-size: 48px; color: #fff; font-weight: bold;
            text-shadow: 3px 3px 8px rgba(0,0,0,0.8);
            pointer-events: none;
        `, overlay);
        this.elements.pause.textContent = 'PAUSED - Click to Resume';
    }

    _createDiv(id, style, parent) {
        const div = document.createElement('div');
        div.id = id;
        div.style.cssText = style;
        parent.appendChild(div);
        return div;
    }

    update(currentTarget) {
        const gs = this.gameState;
        const p = gs.player;

        if (p.money !== this._lastMoney) {
            this._lastMoney = p.money;
            this.elements.money.textContent = `$${p.money}`;
        }

        if (p.score !== this._lastScore) {
            this._lastScore = p.score;
            this.elements.score.textContent = `Score: ${p.score}`;
        }

        let waveLine = '';
        if (gs.waveActive) {
            waveLine = `Day ${gs.dayNumber} - Wave ${gs.currentWave}`;
        } else if (gs.waitingForPlayer) {
            waveLine = `Day ${gs.dayNumber} - Press [F] when ready!`;
        } else if (gs.started) {
            waveLine = `Day ${gs.dayNumber} - Break`;
        }
        const waveGold = !!gs.waitingForPlayer;
        if (waveLine !== this._lastWaveLine || waveGold !== this._lastWaveGold) {
            this._lastWaveLine = waveLine;
            this._lastWaveGold = waveGold;
            this.elements.waveInfo.textContent = waveLine;
            this.elements.waveInfo.style.color = waveGold ? '#ffd700' : '#fff';
        }

        let carryStr = '';
        if (p.carrying) {
            const icon = p.carrying.type === 'wort' ? '🫗' : '🍺';
            const label = p.carrying.type === 'wort' ? 'Wort' : 'Beer';
            carryStr = `${icon} Carrying: ${p.carrying.recipe.name} ${label}`;
        }
        if (carryStr !== this._lastCarrying) {
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
        } else if (this._lastPromptText != null) {
            this._lastPromptText = null;
            this.elements.prompt.style.display = 'none';
        }

        const kegStr = gs.kegs.length > 0
            ? `Kegs: ${gs.kegs.map(k => k.recipe.name).join(', ')}`
            : '';
        if (kegStr !== this._lastKegStr) {
            this._lastKegStr = kegStr;
            if (kegStr) {
                this.elements.kegInventory.textContent = kegStr;
                this.elements.kegInventory.style.display = 'block';
            } else {
                this.elements.kegInventory.style.display = 'none';
            }
        }

        if (gs.paused && gs.started) {
            this.elements.pause.style.display = 'flex';
        } else {
            this.elements.pause.style.display = 'none';
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
            if (data._state === 'empty' && !player.carrying) {
                text = 'Press [E] to Brew';
            } else if (data._state === 'empty' && player.carrying) {
                text = 'Brew Station (hands full)';
            } else if (data._state === 'brewing') {
                text = 'Brewing in progress...';
            } else if (data._state === 'done' && !player.carrying) {
                text = 'Press [E] to Collect Wort';
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
        } else if (type === 'kegStation') {
            if (player.carrying?.type === 'beer') {
                text = 'Press [E] to Keg Beer';
            } else if (player.carrying?.type === 'wort') {
                text = 'Keg Station (needs fermented beer, not wort)';
            } else {
                text = 'Keg Station (bring fermented beer)';
            }
        } else if (type === 'tap') {
            if (data._hasKeg && data._canUntap) {
                text = `[E] Serve ${data._beerName || 'Beer'}  |  [G] Untap (full keg)`;
            } else if (data._hasKeg) {
                text = `Press [E] to Serve ${data._beerName || 'Beer'}`;
            } else if (data._kegsAvailable) {
                text = 'Press [E] to Load Tap';
            } else {
                text = 'Tap Empty (no kegs available)';
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
        let html = '<div style="font-size:20px;color:#ffd700;margin-bottom:12px;">Select Recipe:</div>';
        const cravingIds = new Set((this.gameState.dailyCravings || []).map(c => c.id));
        RECIPES.forEach((r, i) => {
            const colorHex = '#' + r.color.toString(16).padStart(6, '0');
            const keyLabel = i < 9 ? (i + 1) : 0;
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
        html += '<div style="color:#888;font-size:13px;margin-top:10px;">Press number to select, or walk away to cancel</div>';
        this.elements.recipeSelect.innerHTML = html;
        this.elements.recipeSelect.style.display = 'block';
    }

    hideRecipeSelection() {
        this.elements.recipeSelect.style.display = 'none';
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
        html += '<div style="color:#888;font-size:13px;margin-top:10px;">Press number to select</div>';
        this.elements.kegSelect.innerHTML = html;
        this.elements.kegSelect.style.display = 'block';
    }

    hideKegSelection() {
        this.elements.kegSelect.style.display = 'none';
    }

    showDailyCravings(cravings) {
        const list = cravings.map(c => c.name).join(', ');
        this.elements.cravings.innerHTML =
            `<div style="font-size:14px;color:#ccc;margin-bottom:6px;">TODAY'S CRAVINGS</div>` +
            `<div>${list}</div>`;
        this.elements.cravings.style.display = 'block';
        this.elements.cravings.style.opacity = '1';

        clearTimeout(this.cravingsTimeout);
        this.cravingsTimeout = setTimeout(() => {
            this.elements.cravings.style.opacity = '0';
            setTimeout(() => {
                this.elements.cravings.style.display = 'none';
            }, 500);
        }, 6000);

        this.updateCravingsSidebar(cravings);
    }

    updateCravingsSidebar(cravings) {
        if (!cravings || cravings.length === 0) {
            this.elements.cravingsSidebar.style.display = 'none';
            return;
        }
        const items = cravings.map(c =>
            `<span style="color:#ffd700;">${c.name}</span> <span style="color:#999;font-size:11px;">${c.description}</span>`
        ).join('<br>');
        this.elements.cravingsSidebar.innerHTML =
            `<div style="color:#b87333;font-size:11px;font-weight:bold;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px;">Today's Cravings</div>` +
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
        const cravingsList = cravings.map(c =>
            `<span style="color:#ffd700;font-size:20px;">${c.name}</span> <span style="color:#999;font-size:14px;">— ${c.description}</span>`
        ).join('<br>');

        banner.innerHTML = `
            <div style="font-size:42px;font-weight:bold;color:#ffd700;text-shadow:3px 3px 8px rgba(0,0,0,0.9);margin-bottom:8px;">
                Day ${dayNumber}
            </div>
            ${summaryHtml}
            <div style="margin-top:24px;padding:16px 28px;background:rgba(40,20,5,0.8);border:2px solid #b87333;border-radius:12px;text-align:center;">
                <div style="font-size:13px;color:#b87333;font-weight:bold;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">New Cravings</div>
                ${cravingsList}
            </div>
            <div style="font-size:14px;color:rgba(255,255,255,0.4);margin-top:20px;">Customers want new beers — brew accordingly!</div>
        `;

        banner.style.display = 'flex';
        banner.style.opacity = '1';

        clearTimeout(this._dayBannerTimeout);
        this._dayBannerTimeout = setTimeout(() => {
            banner.style.opacity = '0';
            setTimeout(() => { banner.style.display = 'none'; }, 600);
        }, 5000);
    }

    showNotification(text, color = 'rgba(40,20,5,0.9)', duration = 2000) {
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
