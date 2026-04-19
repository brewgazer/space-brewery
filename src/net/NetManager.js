/**
 * NetManager — single entry point the rest of the game uses to interact with
 * multiplayer. Swaps transports by mode.
 *
 *   offline  — no networking; all methods are no-ops.
 *   local    — LocalTransport (BroadcastChannel). Works across tabs/windows on
 *              the same origin. Great for the 2-tab test the user wants.
 *   online   — OnlineTransport (WebSocket relay; run `npm run relay` locally).
 *
 * The manager owns two responsibilities the transports shouldn't:
 *  - Throttling outbound player-state broadcasts to ~12Hz.
 *  - Remembering the latest state from every remote peer so the scene's remote
 *    avatars can be updated on the game loop.
 */

import { LocalTransport } from './LocalTransport.js';
import { OnlineTransport } from './OnlineTransport.js';

const STATE_SEND_INTERVAL_MS = 80;      // ~12.5 Hz
const REMOTE_STALE_MS = 5000;
/**
 * Hard cap on room size. The brewery economy scales for a solo brewer, so
 * opening it up to larger groups makes everything trivially easy — 4 is the
 * sweet spot the game is balanced around.
 */
export const MAX_PLAYERS_PER_SERVER = 4;

/** @typedef {{ x:number, z:number, yaw:number, walking:boolean, sprinting:boolean, name:string, colorIndex:number }} PlayerNetState */

export class NetManager {
    constructor() {
        this._transport = null;
        this._mode = 'offline';
        this._remotes = new Map();       // peerId -> { state, lastSeen }
        this._remoteListeners = new Set();
        this._lastSendMs = 0;
        this._active = false;
        this._selfName = 'Brewer';
        this._selfColorIndex = 0;
        this._status = 'idle';           // 'idle' | 'hosting' | 'joined' | 'error'
        this._statusMessage = '';
        this._serverListListeners = new Set();
        this._hostEventListeners = new Set();
        this._clientRequestListeners = new Set();
        this._peerJoinedListeners = new Set();
    }

    get mode() { return this._mode; }
    get active() { return this._active; }
    get status() { return this._status; }
    get statusMessage() { return this._statusMessage; }
    get isHost() { return !!this._transport?.isHost; }
    get serverInfo() { return this._transport?.serverInfo || null; }
    get peerId() { return this._transport?.peerId || null; }

    setSelf({ name, colorIndex }) {
        if (name != null) this._selfName = String(name).slice(0, 24) || 'Brewer';
        if (typeof colorIndex === 'number') this._selfColorIndex = colorIndex;
    }

    // ---------------------------------------------------------------------
    // Discovery
    // ---------------------------------------------------------------------

    onServerList(cb) {
        this._serverListListeners.add(cb);
        return () => this._serverListListeners.delete(cb);
    }

    startBrowsing(mode = 'local') {
        this.stopBrowsing();
        if (mode === 'offline') {
            this._emitServerList([]);
            return;
        }
        const t = mode === 'online' ? new OnlineTransport() : new LocalTransport();
        this._browseTransport = t;
        t.startDiscovery((list) => this._emitServerList(list));
    }

    stopBrowsing() {
        if (this._browseTransport) {
            this._browseTransport.stopDiscovery();
            // Only close it if it's not the same transport we're using for a
            // live session.
            if (this._browseTransport !== this._transport) {
                this._browseTransport.leave?.();
            }
            this._browseTransport = null;
        }
    }

    _emitServerList(list) {
        for (const cb of this._serverListListeners) {
            try { cb(list); } catch (err) { console.warn('server-list listener', err); }
        }
    }

    // ---------------------------------------------------------------------
    // Session lifecycle
    // ---------------------------------------------------------------------

    /**
     * Start a hosted session. `mode` must be 'local' or 'online'. Returns the
     * server info on success (Promise when online — connects to relay first).
     */
    async hostServer({ mode, serverName }) {
        this.leave();
        if (mode === 'offline') {
            this._mode = 'offline';
            this._status = 'idle';
            return null;
        }
        const transport = mode === 'online' ? new OnlineTransport() : new LocalTransport();
        this._mode = mode;
        this._transport = transport;
        this._bindTransport(transport);
        const info = await Promise.resolve(
            transport.host({
                serverName,
                hostName: this._selfName,
                selfInfo: { name: this._selfName, colorIndex: this._selfColorIndex },
                maxPlayers: MAX_PLAYERS_PER_SERVER,
            })
        );
        this._active = true;
        this._status = 'hosting';
        this._statusMessage = `Hosting “${info.name}” (${mode})`;
        return info;
    }

    /** Join an existing server by info `{ id, name, hostName, mode }`. */
    async joinServer({ mode, serverId }) {
        this.leave();
        const transport = mode === 'online' ? new OnlineTransport() : new LocalTransport();
        this._mode = mode;
        this._transport = transport;
        this._bindTransport(transport);
        try {
            const res = await transport.join({
                serverId,
                selfInfo: { name: this._selfName, colorIndex: this._selfColorIndex },
            });
            this._active = true;
            this._status = 'joined';
            this._statusMessage = `Joined “${res.server?.name || 'server'}”`;
            // Seed remote host avatar immediately.
            if (res.hostPeerId && res.hostSelf) {
                this._setRemoteState(res.hostPeerId, {
                    name: res.hostSelf.name,
                    colorIndex: res.hostSelf.colorIndex,
                    x: 0, z: 0, yaw: 0, walking: false, sprinting: false,
                });
            }
            return res;
        } catch (err) {
            this._transport = null;
            this._mode = 'offline';
            this._status = 'error';
            this._statusMessage = err?.message || String(err);
            throw err;
        }
    }

    goOffline() {
        this.leave();
        this._mode = 'offline';
        this._status = 'idle';
        this._statusMessage = '';
    }

    leave() {
        if (this._transport) {
            this._transport.leave();
            this._transport = null;
        }
        this._active = false;
        this._remotes.clear();
        this._status = 'idle';
        this._statusMessage = '';
    }

    // ---------------------------------------------------------------------
    // Per-frame integration
    // ---------------------------------------------------------------------

    onRemote(cb) {
        this._remoteListeners.add(cb);
        return () => this._remoteListeners.delete(cb);
    }

    /**
     * Call every frame while in a session with the local player pose. Sends
     * at a fixed cadence to keep the channel cheap.
     */
    tickSendLocalState(player) {
        if (!this._active || !this._transport || !player) return;
        const tnow = performance.now();
        if (tnow - this._lastSendMs < STATE_SEND_INTERVAL_MS) return;
        this._lastSendMs = tnow;
        const walking =
            (player.moveForward || player.moveBackward ||
             player.moveLeft || player.moveRight) && !player._suppressLocoAnim;
        const state = {
            x: player.avatarPos.x,
            z: player.avatarPos.z,
            yaw: player.euler?.y || 0,
            walking: !!walking,
            sprinting: !!player._sprintActive,
            name: this._selfName,
            colorIndex: this._selfColorIndex,
        };
        this._transport.sendPlayerState(state);
    }

    /** Returns remote peers with non-stale state, keyed by peerId. */
    getRemotes() {
        const cutoff = Date.now() - REMOTE_STALE_MS;
        const out = [];
        for (const [peerId, info] of this._remotes) {
            if (info.lastSeen >= cutoff) out.push({ peerId, state: info.state });
        }
        return out;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    _bindTransport(t) {
        t.setCallbacks({
            onRemoteState: (peerId, state) => this._setRemoteState(peerId, state),
            onRemoteLeave: (peerId) => this._removeRemote(peerId),
            onKicked: (reason) => {
                this._status = 'error';
                this._statusMessage = reason || 'Disconnected';
                this._active = false;
                this._remotes.clear();
                for (const cb of this._remoteListeners) {
                    try { cb({ kind: 'kicked', reason }); } catch (_) { /* ignore */ }
                }
            },
            onHostEvent: (payload) => {
                for (const cb of this._hostEventListeners) {
                    try { cb(payload); } catch (err) { console.warn('host-event listener', err); }
                }
            },
            onClientRequest: (peerId, payload) => {
                for (const cb of this._clientRequestListeners) {
                    try { cb(peerId, payload); } catch (err) { console.warn('client-request listener', err); }
                }
            },
            onPeerJoined: (peerId) => {
                for (const cb of this._peerJoinedListeners) {
                    try { cb(peerId); } catch (err) { console.warn('peer-joined listener', err); }
                }
            },
        });
    }

    /** Client: fires when the host broadcasts a gameplay event (economy state, purchase ack, …). */
    onHostEvent(cb) {
        this._hostEventListeners.add(cb);
        return () => this._hostEventListeners.delete(cb);
    }

    /** Host: fires when a client sends a request (purchase/spend). */
    onClientRequest(cb) {
        this._clientRequestListeners.add(cb);
        return () => this._clientRequestListeners.delete(cb);
    }

    /** Host: fires when a new peer successfully joins — useful for pushing initial state. */
    onPeerJoined(cb) {
        this._peerJoinedListeners.add(cb);
        return () => this._peerJoinedListeners.delete(cb);
    }

    sendHostEvent(payload, opts = {}) {
        this._transport?.sendHostEvent?.(payload, opts);
    }

    sendClientRequest(payload) {
        this._transport?.sendClientRequest?.(payload);
    }

    _setRemoteState(peerId, state) {
        if (!peerId || peerId === this.peerId) return;
        this._remotes.set(peerId, { state, lastSeen: Date.now() });
        for (const cb of this._remoteListeners) {
            try { cb({ kind: 'state', peerId, state }); } catch (_) { /* ignore */ }
        }
    }

    _removeRemote(peerId) {
        if (!this._remotes.delete(peerId)) return;
        for (const cb of this._remoteListeners) {
            try { cb({ kind: 'leave', peerId }); } catch (_) { /* ignore */ }
        }
    }
}
