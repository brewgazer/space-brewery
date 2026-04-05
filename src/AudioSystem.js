export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.initialized = false;
    }

    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.initialized = true;
        } catch (e) {
            console.warn('Web Audio API not available');
        }
    }

    _tone(freq, duration, type = 'sine', volume = 0.15) {
        if (!this.initialized) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    _noise(duration, volume = 0.08) {
        if (!this.initialized) return;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, this.ctx.currentTime);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        source.start();
    }

    playBrewStart() {
        this._tone(220, 0.15, 'sine', 0.12);
        setTimeout(() => this._tone(330, 0.15, 'sine', 0.12), 100);
        setTimeout(() => this._tone(440, 0.2, 'sine', 0.12), 200);
    }

    playBrewComplete() {
        this._tone(523, 0.12, 'sine', 0.15);
        setTimeout(() => this._tone(659, 0.12, 'sine', 0.15), 100);
        setTimeout(() => this._tone(784, 0.25, 'sine', 0.15), 200);
    }

    playFermentComplete() {
        this._tone(392, 0.15, 'triangle', 0.12);
        setTimeout(() => this._tone(523, 0.15, 'triangle', 0.12), 120);
        setTimeout(() => this._tone(659, 0.3, 'triangle', 0.12), 240);
    }

    playPour() {
        this._noise(0.6, 0.1);
    }

    playKeg() {
        this._tone(150, 0.1, 'square', 0.08);
        setTimeout(() => this._tone(200, 0.15, 'square', 0.08), 80);
    }

    playServe() {
        this._noise(0.3, 0.06);
        setTimeout(() => this._tone(600, 0.1, 'sine', 0.1), 200);
    }

    playCashRegister() {
        this._tone(1200, 0.05, 'square', 0.08);
        setTimeout(() => this._tone(1500, 0.08, 'square', 0.1), 60);
        setTimeout(() => this._tone(2000, 0.12, 'square', 0.08), 120);
    }

    playCustomerAngry() {
        this._tone(300, 0.2, 'sawtooth', 0.06);
        setTimeout(() => this._tone(200, 0.3, 'sawtooth', 0.06), 200);
    }

    playPickup() {
        this._tone(500, 0.08, 'sine', 0.1);
        setTimeout(() => this._tone(700, 0.1, 'sine', 0.1), 60);
    }

    playError() {
        this._tone(200, 0.15, 'square', 0.08);
        setTimeout(() => this._tone(150, 0.2, 'square', 0.08), 150);
    }

    playWaveStart() {
        for (let i = 0; i < 3; i++) {
            setTimeout(() => this._tone(440 + i * 110, 0.15, 'triangle', 0.1), i * 150);
        }
    }

    playDayStart() {
        const notes = [262, 330, 392, 523];
        notes.forEach((n, i) => {
            setTimeout(() => this._tone(n, 0.2, 'sine', 0.12), i * 150);
        });
    }
}
