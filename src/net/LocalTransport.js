/**
 * LocalTransport
 * ----------------
 * Cross-tab multiplayer transport using `BroadcastChannel`. Works between any
 * tabs on the same origin (e.g. two tabs of http://localhost:8080), which is
 * the target test setup. Nothing leaves the machine.
 *
 * Two channels are used:
 *  - `brew-sim-lobby`           — host heartbeats + list-requests (server discovery)
 *  - `brew-sim-server-<id>`     — per-server join handshake + player state sync
 *
 * Host responsibilities:
 *   1. Broadcast an `announce` on the lobby channel every HEARTBEAT_MS.
 *   2. Listen on its server channel for `join-request` / `player-state` /
 *      `player-leave`, maintain a roster with lastSeen timestamps, and rebroadcast.
 *   3. Prune clients that haven't sent anything in CLIENT_TIMEOUT_MS.
 *
 * Client responsibilities:
 *   1. Subscribe to the lobby channel and request listings; hosts respond with
 *      a fresh `announce`.
 *   2. After `join-accept`, send `player-state` to the server channel on tick.
 *   3. Emit `player-leave` on disconnect.
 *
 * Message envelope (all channels):
 *   { type: string, ts: number, from: string, ...payload }
 */

const LOBBY_CHANNEL = 'brew-sim-lobby';
const SERVER_CHANNEL_PREFIX = 'brew-sim-server-';
const HEARTBEAT_MS = 2000;
const CLIENT_TIMEOUT_MS = 7000;
const SERVER_TIMEOUT_MS = 6000;

function nowMs() { return Date.now(); }
function genId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class LocalTransport {
    constructor() {
        this._lobby = null;
        this._server = null;
        this._serverId = null;
        this._isHost = false;
        this._heartbeatTimer = null;
        this._pruneTimer = null;
        this._clients = new Map();       // peerId -> { name, colorIndex, lastSeen }
        this._knownServers = new Map();  // serverId -> server info
        this._discoverInterval = null;
        this._onServerList = null;
        this._onRemoteState = null;
        this._onRemoteLeave = null;
        this._onKicked = null;
        this._selfInfo = null;
        this._peerId = genId();
        this._serverInfo = null;
    }

    get peerId() { return this._peerId; }
    get isHost() { return this._isHost; }
    get serverInfo() { return this._serverInfo; }

    // ---------------------------------------------------------------------
    // Discovery (browse only — not yet joined to any server)
    // ---------------------------------------------------------------------

    /**
     * Begin listening to the lobby for announce messages. `onUpdate` is called
     * with an array of { id, name, hostName, mode, players, max } whenever the
     * list changes (debounced to once per poll tick).
     */
    startDiscovery(onUpdate) {
        this.stopDiscovery();
        this._onServerList = onUpdate;
        this._knownServers = new Map();
        this._lobby = this._openLobby();

        const requestList = () => {
            this._sendLobby({ type: 'list-request' });
            this._pruneKnownServers();
            this._emitServerList();
        };
        requestList();
        this._discoverInterval = setInterval(requestList, HEARTBEAT_MS);
    }

    stopDiscovery() {
        if (this._discoverInterval) {
            clearInterval(this._discoverInterval);
            this._discoverInterval = null;
        }
        this._onServerList = null;
        if (!this._isHost && !this._server && this._lobby) {
            this._lobby.close();
            this._lobby = null;
        }
    }

    _pruneKnownServers() {
        const cutoff = nowMs() - SERVER_TIMEOUT_MS;
        let changed = false;
        for (const [id, info] of this._knownServers) {
            if (info.lastSeen < cutoff) {
                this._knownServers.delete(id);
                changed = true;
            }
        }
        return changed;
    }

    _emitServerList() {
        if (!this._onServerList) return;
        const list = Array.from(this._knownServers.values()).map((s) => ({
            id: s.id,
            name: s.name,
            hostName: s.hostName,
            mode: s.mode,
            players: s.players,
            max: s.max,
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        this._onServerList(list);
    }

    // ---------------------------------------------------------------------
    // Hosting
    // ---------------------------------------------------------------------

    /**
     * Start a server. `selfInfo = { name, colorIndex }` represents the host
     * player's own avatar state (used in roster + list announcements).
     */
    host({ serverName, hostName, selfInfo, maxPlayers = 4 }) {
        this.leave();
        this._isHost = true;
        this._serverId = genId();
        this._selfInfo = selfInfo || { name: hostName, colorIndex: 0 };
        this._serverInfo = {
            id: this._serverId,
            name: String(serverName || 'Unnamed Brewery').slice(0, 48),
            hostName: String(hostName || 'Brewer').slice(0, 32),
            mode: 'local',
            players: 1,
            max: maxPlayers,
        };
        this._clients = new Map();

        this._lobby = this._openLobby();
        this._server = this._openServerChannel(this._serverId);
        this._sendAnnounce();
        this._heartbeatTimer = setInterval(() => this._sendAnnounce(), HEARTBEAT_MS);
        this._pruneTimer = setInterval(() => this._pruneClients(), 2000);
        return this._serverInfo;
    }

    _sendAnnounce() {
        if (!this._isHost || !this._serverInfo) return;
        this._serverInfo.players = 1 + this._clients.size;
        this._sendLobby({
            type: 'announce',
            id: this._serverInfo.id,
            name: this._serverInfo.name,
            hostName: this._serverInfo.hostName,
            mode: this._serverInfo.mode,
            players: this._serverInfo.players,
            max: this._serverInfo.max,
        });
    }

    _pruneClients() {
        if (!this._isHost) return;
        const cutoff = nowMs() - CLIENT_TIMEOUT_MS;
        let changed = false;
        for (const [peerId, info] of this._clients) {
            if (info.lastSeen < cutoff) {
                this._clients.delete(peerId);
                changed = true;
                this._onRemoteLeave?.(peerId);
            }
        }
        if (changed) this._sendAnnounce();
    }

    // ---------------------------------------------------------------------
    // Joining
    // ---------------------------------------------------------------------

    /**
     * Join a known server. Returns a promise that resolves with the
     * join-accept payload, or rejects after a timeout.
     */
    join({ serverId, selfInfo, timeoutMs = 4000 }) {
        this.leave();
        this._isHost = false;
        this._serverId = serverId;
        this._selfInfo = selfInfo || { name: 'Brewer', colorIndex: 0 };

        this._server = this._openServerChannel(serverId);

        return new Promise((resolve, reject) => {
            let resolved = false;
            const timer = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                reject(new Error('Server did not respond — host may be offline.'));
            }, timeoutMs);

            const listener = (ev) => {
                const msg = ev.data;
                if (!msg || msg.to !== this._peerId) return;
                if (msg.type === 'join-accept') {
                    resolved = true;
                    clearTimeout(timer);
                    this._server.removeEventListener('message', listener);
                    this._serverInfo = msg.server;
                    resolve(msg);
                } else if (msg.type === 'join-reject') {
                    resolved = true;
                    clearTimeout(timer);
                    this._server.removeEventListener('message', listener);
                    reject(new Error(msg.reason || 'Join rejected.'));
                }
            };
            this._server.addEventListener('message', listener);

            this._sendServer({
                type: 'join-request',
                name: this._selfInfo.name,
                colorIndex: this._selfInfo.colorIndex,
            });
        });
    }

    // ---------------------------------------------------------------------
    // Runtime messaging
    // ---------------------------------------------------------------------

    setCallbacks({ onRemoteState, onRemoteLeave, onKicked, onHostEvent, onClientRequest, onPeerJoined }) {
        this._onRemoteState = onRemoteState || null;
        this._onRemoteLeave = onRemoteLeave || null;
        this._onKicked = onKicked || null;
        this._onHostEvent = onHostEvent || null;
        this._onClientRequest = onClientRequest || null;
        this._onPeerJoined = onPeerJoined || null;
    }

    /**
     * Host → broadcast a gameplay event (shared economy state, purchase
     * approvals, etc.) to every connected client. If `to` is set it's targeted
     * at a single peer (used for initial state on join / rejections).
     * No-op on clients.
     */
    sendHostEvent(payload, { to } = {}) {
        if (!this._isHost || !this._server) return;
        this._sendServer({ type: 'host-event', to, payload });
    }

    /** Client → host request (purchase, spend, etc.). No-op on the host. */
    sendClientRequest(payload) {
        if (this._isHost || !this._server) return;
        this._sendServer({ type: 'client-request', payload });
    }

    /**
     * Broadcast the local player's pose/anim to every other peer in the room.
     *
     * The host's packet is framed as an authoritative `peer-state` so clients
     * can apply it directly. A client's packet is framed as `player-state` so
     * the host can update its roster and then re-emit the authoritative
     * `peer-state` for the other clients.
     */
    sendPlayerState(state) {
        if (!this._server) return;
        if (this._isHost) {
            this._sendServer({
                type: 'peer-state',
                peerId: this._peerId,
                state,
            });
        } else {
            this._sendServer({ type: 'player-state', state });
        }
    }

    /**
     * Leave the current room (or shut down the host's server). Safe to call
     * multiple times. Does not clear discovery listeners — call stopDiscovery()
     * separately.
     */
    leave() {
        if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
        if (this._pruneTimer) { clearInterval(this._pruneTimer); this._pruneTimer = null; }

        if (this._server) {
            try {
                this._sendServer({ type: this._isHost ? 'host-close' : 'player-leave' });
            } catch (_) { /* ignore */ }
            this._server.close();
            this._server = null;
        }
        if (this._isHost && this._lobby) {
            try {
                this._sendLobby({ type: 'server-close', id: this._serverId });
            } catch (_) { /* ignore */ }
            // Keep lobby open only if discovery is still running.
            if (!this._onServerList) {
                this._lobby.close();
                this._lobby = null;
            }
        }
        this._isHost = false;
        this._serverId = null;
        this._serverInfo = null;
        this._clients = new Map();
    }

    // ---------------------------------------------------------------------
    // Internal wiring
    // ---------------------------------------------------------------------

    _openLobby() {
        if (this._lobby) return this._lobby;
        const ch = new BroadcastChannel(LOBBY_CHANNEL);
        ch.addEventListener('message', (ev) => this._onLobbyMessage(ev));
        return ch;
    }

    _openServerChannel(serverId) {
        const ch = new BroadcastChannel(SERVER_CHANNEL_PREFIX + serverId);
        ch.addEventListener('message', (ev) => this._onServerMessage(ev));
        return ch;
    }

    _onLobbyMessage(ev) {
        const msg = ev.data;
        if (!msg || msg.from === this._peerId) return;

        if (msg.type === 'announce') {
            const existing = this._knownServers.get(msg.id);
            const updated = {
                id: msg.id,
                name: msg.name,
                hostName: msg.hostName,
                mode: msg.mode,
                players: msg.players,
                max: msg.max,
                lastSeen: nowMs(),
            };
            this._knownServers.set(msg.id, updated);
            if (!existing ||
                existing.players !== updated.players ||
                existing.name !== updated.name) {
                this._emitServerList();
            }
            return;
        }

        if (msg.type === 'server-close') {
            if (this._knownServers.delete(msg.id)) {
                this._emitServerList();
            }
            return;
        }

        if (msg.type === 'list-request' && this._isHost) {
            this._sendAnnounce();
        }
    }

    _onServerMessage(ev) {
        const msg = ev.data;
        if (!msg || msg.from === this._peerId) return;

        if (this._isHost) {
            if (msg.type === 'join-request') {
                this._handleJoinRequest(msg);
                return;
            }
            if (msg.type === 'player-state') {
                this._updateClient(msg.from, msg.state);
                // Host re-broadcasts authoritative state to all clients.
                this._onRemoteState?.(msg.from, msg.state);
                this._sendServer({ type: 'peer-state', peerId: msg.from, state: msg.state });
                return;
            }
            if (msg.type === 'client-request') {
                this._onClientRequest?.(msg.from, msg.payload);
                return;
            }
            if (msg.type === 'player-leave') {
                if (this._clients.delete(msg.from)) {
                    this._onRemoteLeave?.(msg.from);
                    this._sendServer({ type: 'peer-leave', peerId: msg.from });
                    this._sendAnnounce();
                }
                return;
            }
        } else {
            if (msg.to && msg.to !== this._peerId) return;
            if (msg.type === 'host-close') {
                this._onKicked?.('Host closed the server.');
                this.leave();
                return;
            }
            if (msg.type === 'peer-state' && msg.peerId !== this._peerId) {
                this._onRemoteState?.(msg.peerId, msg.state);
                return;
            }
            if (msg.type === 'peer-leave') {
                this._onRemoteLeave?.(msg.peerId);
                return;
            }
            if (msg.type === 'host-event') {
                this._onHostEvent?.(msg.payload);
                return;
            }
            if (msg.type === 'roster') {
                // Host snapshot of current peers (for display). Any missing
                // peer implicitly left.
                for (const p of msg.peers) {
                    if (p.peerId === this._peerId) continue;
                    if (p.state) this._onRemoteState?.(p.peerId, p.state);
                }
                return;
            }
        }
    }

    _handleJoinRequest(msg) {
        if (this._clients.size + 1 >= this._serverInfo.max) {
            this._sendServer({
                type: 'join-reject',
                to: msg.from,
                reason: 'Server is full.',
            });
            return;
        }
        this._clients.set(msg.from, {
            name: msg.name || 'Brewer',
            colorIndex: msg.colorIndex || 0,
            lastSeen: nowMs(),
            lastState: null,
        });
        this._sendServer({
            type: 'join-accept',
            to: msg.from,
            server: { ...this._serverInfo, players: 1 + this._clients.size },
            hostPeerId: this._peerId,
            hostSelf: this._selfInfo,
        });
        this._sendAnnounce();
        this._onPeerJoined?.(msg.from);
    }

    _updateClient(peerId, state) {
        const info = this._clients.get(peerId);
        if (!info) {
            // Unknown peer — treat as late-joining; accept silently.
            this._clients.set(peerId, {
                name: state?.name || 'Brewer',
                colorIndex: state?.colorIndex || 0,
                lastSeen: nowMs(),
                lastState: state,
            });
        } else {
            info.lastSeen = nowMs();
            info.lastState = state;
            if (state?.name) info.name = state.name;
            if (typeof state?.colorIndex === 'number') info.colorIndex = state.colorIndex;
        }
    }

    _sendLobby(msg) {
        if (!this._lobby) return;
        this._lobby.postMessage({ ...msg, ts: nowMs(), from: this._peerId });
    }

    _sendServer(msg) {
        if (!this._server) return;
        this._server.postMessage({ ...msg, ts: nowMs(), from: this._peerId });
    }
}
