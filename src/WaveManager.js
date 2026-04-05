export class WaveManager {
    constructor(gameState, customerSystem, recipeSystem) {
        this.gameState = gameState;
        this.customerSystem = customerSystem;
        this.recipeSystem = recipeSystem;

        this.waveNumber = 0;
        this.customersToSpawn = 0;
        this.customersSpawned = 0;
        this.spawnTimer = 0;
        this.spawnInterval = 8;
        this.basePatience = 45;
        this.waveActive = false;
        this.betweenWaves = false;
        this.betweenWaveTimer = 0;
        this.dayActive = false;
        this.wavesPerDay = 5;
        this.wavesCompleted = 0;

        this.waitingForPlayer = false;

        // Day-start stats for end-of-day summary
        this.dayStartMoney = 0;
        this.dayCustomersServed = 0;
        this.dayCustomersLost = 0;

        this.onWaveStart = null;
        this.onWaveEnd = null;
        this.onDayEnd = null;
        this.onDayStart = null;
        this.onWaitingForPlayer = null;
    }

    startDay() {
        this.dayActive = true;
        this.wavesCompleted = 0;
        this.waveNumber = 0;
        this.waitingForPlayer = true;
        this.betweenWaves = false;
        this.waveActive = false;

        this.dayStartMoney = this.gameState.player.money;
        this.dayCustomersServed = 0;
        this.dayCustomersLost = 0;

        // Scale waves per day: 5 base + 1 every 3 days, capped at 10
        const day = this.gameState.dayNumber;
        this.wavesPerDay = Math.min(10, 5 + Math.floor((day - 1) / 3));

        if (this.onDayStart) this.onDayStart(day);
        if (this.onWaitingForPlayer) this.onWaitingForPlayer();
    }

    playerReady() {
        if (!this.waitingForPlayer) return;
        this.waitingForPlayer = false;
        this._startNextWave();
    }

    _startNextWave() {
        this.waveNumber++;
        this.waveActive = true;
        this.betweenWaves = false;
        this.customersSpawned = 0;
        this.spawnTimer = 0;

        const wave = this.waveNumber;
        const day = this.gameState.dayNumber;

        // Cross-day scaling: each day adds baseline difficulty
        const dayBonus = (day - 1) * 0.6;

        this.customersToSpawn = 2 + Math.floor((wave + dayBonus) * 1.3);
        this.spawnInterval = Math.max(2.5, 8 - (wave + dayBonus) * 0.4);
        this.basePatience = Math.max(15, 45 - (wave + dayBonus) * 1.8);

        this.gameState.currentWave = this.waveNumber;
        this.gameState.waveActive = true;

        if (this.onWaveStart) this.onWaveStart(this.waveNumber);
    }

    update(delta) {
        if (!this.dayActive) return;
        if (this.waitingForPlayer) return;

        if (this.betweenWaves) {
            this.betweenWaveTimer -= delta;
            if (this.betweenWaveTimer <= 0) {
                if (this.wavesCompleted >= this.wavesPerDay) {
                    this._endDay();
                } else {
                    this.waitingForPlayer = true;
                    if (this.onWaitingForPlayer) this.onWaitingForPlayer();
                }
            }
            return;
        }

        if (!this.waveActive) return;

        if (this.customersSpawned < this.customersToSpawn) {
            this.spawnTimer -= delta;
            if (this.spawnTimer <= 0) {
                this._spawnCustomer();
                this.spawnTimer = this.spawnInterval * (0.7 + Math.random() * 0.6);
            }
        }

        if (this.customersSpawned >= this.customersToSpawn &&
            this.customerSystem.customers.length === 0) {
            this._endWave();
        }
    }

    _spawnCustomer() {
        const cravings = this.gameState.dailyCravings;
        if (cravings.length === 0) return;

        const recipe = cravings[Math.floor(Math.random() * cravings.length)];
        const patience = this.basePatience * (0.8 + Math.random() * 0.4);

        if (this.customerSystem.spawnCustomer(recipe, patience)) {
            this.customersSpawned++;
        }
    }

    _endWave() {
        this.waveActive = false;
        this.gameState.waveActive = false;
        this.wavesCompleted++;
        this.betweenWaves = true;
        this.betweenWaveTimer = 5;

        if (this.onWaveEnd) this.onWaveEnd(this.waveNumber);
    }

    _endDay() {
        this.dayActive = false;

        const summary = {
            day: this.gameState.dayNumber,
            moneyEarned: this.gameState.player.money - this.dayStartMoney,
            totalMoney: this.gameState.player.money,
            wavesCompleted: this.wavesCompleted,
        };

        this.gameState.dayNumber++;
        this.gameState.dailyCravings = this.recipeSystem.generateDailyCravings(
            this.gameState.dayNumber
        );

        if (this.onDayEnd) this.onDayEnd(this.gameState.dayNumber, summary);

        setTimeout(() => {
            this.startDay();
        }, 6000);
    }
}
