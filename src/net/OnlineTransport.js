/**
 * OnlineTransport — internet multiplayer via the WebSocket relay (server/relay.mjs).
 * Mirrors LocalTransport message shapes so NetManager + gameplay stay unchanged.
 */

const HEARTBEAT_MS = 2000;
const CLIENT_TIMEOUT_MS = 7000;
const SERVER_TIMEOUT_MS = 6000;

function nowMs() {
    return Date.now();
}

function genId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getRelayUrl() {
    if (typeof window === 'undefined') {
        return 'ws://127.0.0.1:8787';
    }
    const raw = window.BREW_RELAY_URL;
    if (raw != null && String(raw).trim() !== '') {
        return String(raw).trim();
    }
    const { protocol, hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        const scheme = protocol === 'https:' ? 'wss' : 'ws';
        return `${scheme}://${hostname}:8787`;
    }
    // GitHub Pages / any hosted HTTPS: no default — ws://127 would be mixed-content blocked.
    return '';
}

export class OnlineTransport {
    constructor() {
        this._ws = null;
        this._relayUrl = getRelayUrl();
        this._serverId = null;
        this._isHost = false;
        this._heartbeatTimer = null;
        this._pruneTimer = null;
        this._discoverInterval = null;
        this._clients = new Map();
        this._onServerList = null;
        this._onRemoteState = null;
        this._onRemoteLeave = null;
        this._onKicked = null;
        this._selfInfo = null;
        this._peerId = genId();
        this._serverInfo = null;
        this._joinResolve = null;
    }

    get isHost() {
        return this._isHost;
    }
    get peerId() {
        return this._peerId;
    }
    get serverInfo() {
        return this._serverInfo;
    }

    // ---------------------------------------------------------------------
    // Discovery
    // ---------------------------------------------------------------------

    startDiscovery(onUpdate) {
        this.stopDiscovery();
        this._onServerList = onUpdate;
        this._openSocketForDiscovery()
            .then(() => {
                if (this._ws) this._ws.onmessage = (ev) => this._onWireMessage(ev);
                this._sendWire({ type: 'hello', peerId: this._peerId });
                this._sendWire({ type: 'lobby-subscribe' });
                const poll = () => {
                    this._sendWire({
                        type: 'lobby-msg',
                        payload: { type: 'list-request' },
                    });
                };
                poll();
                this._discoverInterval = setInterval(poll, HEARTBEAT_MS);
            })
            .catch((err) => {
                console.warn('Online discovery:', err);
                onUpdate?.([]);
            });
    }

    stopDiscovery() {
        if (this._discoverInterval) {
            clearInterval(this._discoverInterval);
            this._discoverInterval = null;
        }
        this._onServerList = null;
        if (!this._isHost && !this._serverId && this._ws) {
            try {
                this._sendWire({ type: 'lobby-unsubscribe' });
            } catch (_) {
                /* ignore */
            }
            this._closeSocket();
        }
    }

    _emitServerList(servers) {
        if (!this._onServerList) return;
        const list = (servers || []).map((s) => ({
            id: s.id,
            name: s.name,
            hostName: s.hostName,
            mode: s.mode || 'online',
            players: s.players,
            max: s.max,
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        this._onServerList(list);
    }

    // ---------------------------------------------------------------------
    // Hosting
    // ---------------------------------------------------------------------

    async host({ serverName, hostName, selfInfo, maxPlayers = 4 }) {
        this.leave();
        this._isHost = true;
        this._serverId = genId();
        this._selfInfo = selfInfo || { name: hostName, colorIndex: 0 };
        this._serverInfo = {
            id: this._serverId,
            name: String(serverName || 'Unnamed Brewery').slice(0, 48),
            hostName: String(hostName || 'Brewer').slice(0, 32),
            mode: 'online',
            players: 1,
            max: maxPlayers,
        };
        this._clients = new Map();

        await this._ensureSocket();
        this._sendWire({ type: 'hello', peerId: this._peerId });
        this._sendWire({ type: 'room-join', serverId: this._serverId });
        this._attachHandlers();

        this._sendAnnounce();
        this._heartbeatTimer = setInterval(() => this._sendAnnounce(), HEARTBEAT_MS);
        this._pruneTimer = setInterval(() => this._pruneClients(), 2000);
        return this._serverInfo;
    }

    _sendAnnounce() {
        if (!this._isHost || !this._serverInfo) return;
        this._serverInfo.players = 1 + this._clients.size;
        this._sendWire({
            type: 'lobby-msg',
            payload: {
                type: 'announce',
                id: this._serverInfo.id,
                name: this._serverInfo.name,
                hostName: this._serverInfo.hostName,
                mode: this._serverInfo.mode,
                players: this._serverInfo.players,
                max: this._serverInfo.max,
            },
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

    join({ serverId, selfInfo, timeoutMs = 8000 }) {
        this.leave();
        this._isHost = false;
        this._serverId = serverId;
        this._selfInfo = selfInfo || { name: 'Brewer', colorIndex: 0 };

        return new Promise((resolve, reject) => {
            let timer;
            const finish = (fn, arg) => {
                if (timer) clearTimeout(timer);
                this._joinResolve = null;
                fn(arg);
            };

            this._joinResolve = {
                resolve: (v) => finish(resolve, v),
                reject: (e) => finish(reject, e),
            };

            timer = setTimeout(() => {
                if (this._joinResolve) {
                    finish(reject, new Error('Server did not respond — host may be offline.'));
                }
            }, timeoutMs);

            this._ensureSocket()
                .then(() => {
                    this._sendWire({ type: 'hello', peerId: this._peerId });
                    this._sendWire({ type: 'room-join', serverId });
                    this._attachHandlers();
                    this._sendServer({
                        type: 'join-request',
                        name: this._selfInfo.name,
                        colorIndex: this._selfInfo.colorIndex,
                    });
                })
                .catch((err) => {
                    finish(reject, err);
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

    /** Mirror of LocalTransport.sendHostEvent — see that file for details. */
    sendHostEvent(payload, { to } = {}) {
        if (!this._isHost || !this._serverId) return;
        this._sendServer({ type: 'host-event', to, payload });
    }

    sendClientRequest(payload) {
        if (this._isHost || !this._serverId) return;
        this._sendServer({ type: 'client-request', payload });
    }

    sendPlayerState(state) {
        if (!this._serverId) return;
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

    leave() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        if (this._pruneTimer) {
            clearInterval(this._pruneTimer);
            this._pruneTimer = null;
        }

        if (this._isHost && this._serverInfo?.id) {
            try {
                this._sendWire({
                    type: 'lobby-msg',
                    payload: { type: 'server-close', id: this._serverInfo.id },
                });
            } catch (_) {
                /* ignore */
            }
        }
        if (this._serverId) {
            try {
                this._sendWire({ type: 'room-leave', serverId: this._serverId });
            } catch (_) {
                /* ignore */
            }
        }

        this._closeSocket();
        this._joinResolve = null;
        this._isHost = false;
        this._serverId = null;
        this._serverInfo = null;
        this._clients = new Map();
    }

    // ---------------------------------------------------------------------
    // WebSocket
    // ---------------------------------------------------------------------

    _openSocketForDiscovery() {
        this._closeSocket();
        return this._connectWs();
    }

    async _ensureSocket() {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) return;
        this._closeSocket();
        await this._connectWs();
    }

    _relayConfigError() {
        if (!this._relayUrl) {
            return new Error(
                'Online relay URL is missing. On GitHub: Settings → Secrets → add BREW_RELAY_WSS_URL (your Railway wss://… URL), then redeploy Pages. See DEPLOY.md.'
            );
        }
        if (
            typeof window !== 'undefined' &&
            window.location.protocol === 'https:' &&
            this._relayUrl.startsWith('ws://')
        ) {
            return new Error(
                'Relay must use wss:// when the game is on HTTPS (not ws://127.0.0.1). Set the BREW_RELAY_WSS_URL secret and redeploy.'
            );
        }
        return null;
    }

    _connectWs() {
        const cfgErr = this._relayConfigError();
        if (cfgErr) return Promise.reject(cfgErr);

        return new Promise((resolve, reject) => {
            let settled = false;
            const ws = new WebSocket(this._relayUrl);
            const done = (err) => {
                if (settled) return;
                settled = true;
                if (err) reject(err);
                else resolve();
            };
            ws.onopen = () => {
                this._ws = ws;
                done(null);
            };
            ws.onerror = () => {
                if (!settled) done(new Error(`Cannot reach relay at ${this._relayUrl}`));
            };
            ws.onclose = () => {
                if (!settled) done(new Error(`Cannot reach relay at ${this._relayUrl}`));
            };
        });
    }

    _closeSocket() {
        if (this._ws) {
            try {
                this._ws.onmessage = null;
                this._ws.close();
            } catch (_) {
                /* ignore */
            }
            this._ws = null;
        }
    }

    _attachHandlers() {
        if (!this._ws) return;
        this._ws.onmessage = (ev) => this._onWireMessage(ev);
    }

    _onWireMessage(ev) {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch {
            return;
        }

        if (msg.type === 'server-list') {
            this._emitServerList(msg.servers);
            return;
        }

        if (msg.type === 'lobby-broadcast') {
            return;
        }

        if (msg.type === 'room-msg' && msg.payload) {
            this._onServerMessage({ data: msg.payload });
        }
    }

    _sendWire(obj) {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
        this._ws.send(JSON.stringify(obj));
    }

    _sendServer(msg) {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN || !this._serverId) return;
        const envelope = { ...msg, ts: nowMs(), from: this._peerId };
        this._sendWire({
            type: 'room-msg',
            serverId: this._serverId,
            payload: envelope,
        });
    }

    // ---------------------------------------------------------------------
    // Same routing logic as LocalTransport._onServerMessage
    // ---------------------------------------------------------------------

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
            if (msg.type === 'join-accept') {
                this._serverInfo = msg.server;
                const jr = this._joinResolve;
                this._joinResolve = null;
                jr?.resolve(msg);
                return;
            }
            if (msg.type === 'join-reject') {
                const jr = this._joinResolve;
                this._joinResolve = null;
                jr?.reject(new Error(msg.reason || 'Join rejected.'));
                return;
            }
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
                for (const p of msg.peers) {
                    if (p.peerId === this._peerId) continue;
                    if (p.state) this._onRemoteState?.(p.peerId, p.state);
                }
                return;
            }
        }
    }

    _handleJoinRequest(msg) {
        if (!this._serverInfo) return;
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
}
