const LS_BGM = 'brewery_audio_bgm';
const LS_SFX = 'brewery_audio_sfx';

/** In order: "space brewery music" 1–4 (filenames avoid spaces for clean URLs). */
const BGM_TRACKS = [
    'assets/audio/music/space_brewery_music_1.mp3',
    'assets/audio/music/space_brewery_music_2.mp3',
    'assets/audio/music/space_brewery_music_3.mp3',
    'assets/audio/music/space_brewery_music_4.mp3',
];

/**
 * SFX: decoded MP3 buffers via Web Audio (after user gesture).
 * Music: HTMLAudioElement (separate from AudioContext).
 * Missing files fall back to the old synthesized cues.
 */
export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.initialized = false;
        this._buffers = new Map();
        this._sfxBus = null;
        this.sfxVolume = 0.55;
        this.bgmVolume = 0.22;
        this._bgm = null;
        /** @type {'title' | 'game' | null} */
        this._bgmMode = null;
        /** Rotated track indices for gameplay (length 4). */
        this._gameBgmOrder = null;
        this._gameBgmOrderIdx = 0;
        this._patronVoiceEl = null;
        this._audioLoaded = false;
        try {
            const b = localStorage.getItem(LS_BGM);
            if (b != null && !Number.isNaN(parseFloat(b))) {
                this.bgmVolume = Math.max(0, Math.min(1, parseFloat(b)));
            }
            const s = localStorage.getItem(LS_SFX);
            if (s != null && !Number.isNaN(parseFloat(s))) {
                this.sfxVolume = Math.max(0, Math.min(1, parseFloat(s)));
            }
        } catch (_) {
            /* ignore */
        }
    }

    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this._sfxBus = this.ctx.createGain();
            this._sfxBus.gain.value = this.sfxVolume;
            this._sfxBus.connect(this.ctx.destination);
            this.initialized = true;
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
        } catch (e) {
            console.warn('Web Audio API not available');
        }
    }

    /**
     * Load decoded SFX. Call after init() (same user gesture is fine).
     */
    async loadGameAudio() {
        if (!this.initialized || !this.ctx || this._audioLoaded) return;
        const base = 'assets/audio/sfx/';
        const files = [
            ['brewStation', `${base}brew_station.mp3`],
            ['fillingFermentor', `${base}filling_fermentor.mp3`],
            ['loadingKeg', `${base}loading_keg.mp3`],
            ['tapPouring', `${base}tap_pouring.mp3`],
        ];
        for (const [key, url] of files) {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(String(res.status));
                const arr = await res.arrayBuffer();
                const buf = await this.ctx.decodeAudioData(arr.slice(0));
                this._buffers.set(key, buf);
            } catch (e) {
                console.warn(`SFX load failed (${url}):`, e?.message || e);
            }
        }
        this._audioLoaded = true;
    }

    _playBuffer(key, when = 0) {
        if (!this.initialized || !this.ctx || !this._sfxBus) return false;
        const buf = this._buffers.get(key);
        if (!buf) return false;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this._sfxBus);
        const t = this.ctx.currentTime + when;
        src.start(t);
        return true;
    }

    pauseBackgroundMusic() {
        if (this._bgm) {
            this._bgm.pause();
        }
    }

    resumeBackgroundMusic() {
        if (this._bgm) {
            this._bgm.play().catch(() => {});
        }
    }

    /** True while the title-menu loop (track 2) is the active BGM mode. */
    isTitleMenuBgmActive() {
        return this._bgmMode === 'title';
    }

    _ensureBgmElement() {
        if (!this._bgm) this._bgm = new Audio();
        return this._bgm;
    }

    _detachBgmEnded() {
        if (this._bgm) {
            this._bgm.onended = null;
        }
    }

    /**
     * Title / main menu: always "space brewery music 2", looped.
     */
    startTitleBackgroundMusic() {
        const url = BGM_TRACKS[1];
        try {
            this._detachBgmEnded();
            const a = this._ensureBgmElement();
            a.pause();
            a.loop = true;
            a.src = url;
            a.volume = this.bgmVolume;
            this._bgmMode = 'title';
            this._gameBgmOrder = null;
            a.play().catch((e) => console.warn('Title BGM play:', e?.message || e));
        } catch (e) {
            console.warn('Title BGM failed:', e);
        }
    }

    /**
     * Gameplay: pick a random starting track, then cycle 1→2→3→4 in order (rotated) until stopped.
     */
    startGameBackgroundMusic() {
        try {
            this._detachBgmEnded();
            const start = Math.floor(Math.random() * BGM_TRACKS.length);
            this._gameBgmOrder = [0, 1, 2, 3].map((i) => (start + i) % BGM_TRACKS.length);
            this._gameBgmOrderIdx = 0;
            this._bgmMode = 'game';
            const a = this._ensureBgmElement();
            a.loop = false;
            a.pause();
            a.src = BGM_TRACKS[this._gameBgmOrder[this._gameBgmOrderIdx]];
            a.volume = this.bgmVolume;
            a.onended = () => this._onGameBgmTrackEnded();
            a.play().catch((e) => console.warn('Game BGM play:', e?.message || e));
        } catch (e) {
            console.warn('Game BGM failed:', e);
        }
    }

    _onGameBgmTrackEnded() {
        if (this._bgmMode !== 'game' || !this._gameBgmOrder?.length || !this._bgm) return;
        this._gameBgmOrderIdx = (this._gameBgmOrderIdx + 1) % this._gameBgmOrder.length;
        const trackIdx = this._gameBgmOrder[this._gameBgmOrderIdx];
        const a = this._bgm;
        a.pause();
        a.src = BGM_TRACKS[trackIdx];
        a.volume = this.bgmVolume;
        a.play().catch((e) => console.warn('Game BGM advance:', e?.message || e));
    }

    setBgmVolume(v) {
        this.bgmVolume = Math.max(0, Math.min(1, v));
        if (this._bgm) this._bgm.volume = this.bgmVolume;
        try {
            localStorage.setItem(LS_BGM, String(this.bgmVolume));
        } catch (_) {
            /* ignore */
        }
    }

    setSfxVolume(v) {
        this.sfxVolume = Math.max(0, Math.min(1, v));
        if (this._sfxBus) this._sfxBus.gain.value = this.sfxVolume;
        if (this._patronVoiceEl) this._patronVoiceEl.volume = this._patronVoiceVolume();
        try {
            localStorage.setItem(LS_SFX, String(this.sfxVolume));
        } catch (_) {
            /* ignore */
        }
    }

    _patronVoiceVolume() {
        return Math.max(0, Math.min(1, this.sfxVolume * 0.92));
    }

    /** One shared HTMLAudio channel so new patron lines replace the previous. */
    _playPatronVoice(url) {
        try {
            if (!this._patronVoiceEl) this._patronVoiceEl = new Audio();
            const a = this._patronVoiceEl;
            a.pause();
            a.currentTime = 0;
            a.src = url;
            a.volume = this._patronVoiceVolume();
            a.play().catch((e) => console.warn('Patron voice:', e?.message || e));
        } catch (e) {
            console.warn('Patron voice failed:', e);
        }
    }

    playCustomerVoiceThankYou() {
        this._playPatronVoice('assets/audio/voice/thank_you.mp3');
    }

    playCustomerVoiceHurry() {
        this._playPatronVoice('assets/audio/voice/can_you_hurry.mp3');
    }

    playCustomerVoiceFinally() {
        this._playPatronVoice('assets/audio/voice/finally.mp3');
    }

    /** Patron walking out angry without being served. */
    playCustomerVoiceLeavingAngry() {
        this._playPatronVoice('assets/audio/voice/screw_this_im_leaving.mp3');
    }

    /** Patron leaving after a satisfied visit. */
    playCustomerVoiceLeavingHappy() {
        this._playPatronVoice('assets/audio/voice/that_was_great_see_you_later.mp3');
    }

    _sfxOut() {
        return this._sfxBus || this.ctx?.destination;
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
        gain.connect(this._sfxOut());
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
        gain.connect(this._sfxOut());
        source.start();
    }

    playBrewStart() {
        if (this._playBuffer('brewStation')) return;
        this._tone(220, 0.15, 'sine', 0.12);
        setTimeout(() => this._tone(330, 0.15, 'sine', 0.12), 100);
        setTimeout(() => this._tone(440, 0.2, 'sine', 0.12), 200);
    }

    playBrewComplete() {
        if (this._playBuffer('brewStation')) return;
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
        if (this._playBuffer('fillingFermentor')) return;
        this._noise(0.6, 0.1);
    }

    playKeg() {
        if (this._playBuffer('loadingKeg')) return;
        this._tone(150, 0.1, 'square', 0.08);
        setTimeout(() => this._tone(200, 0.15, 'square', 0.08), 80);
    }

    playServe() {
        if (this._playBuffer('tapPouring')) return;
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
