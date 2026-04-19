/**
 * Minimal WebSocket relay for Space Brewery online multiplayer.
 * Mirrors BroadcastChannel-style lobby + room fan-out so the client can reuse
 * the same message shapes as LocalTransport.
 *
 * Usage: node server/relay.mjs
 * Env: PORT (default 8787)
 */

import http from 'http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const SERVER_TIMEOUT_MS = 6000;

/** @type {Map<string, { info: object, lastSeen: number }>} */
const lobbyServers = new Map();
/** @type {Map<string, import('ws').WebSocket>} */
const hostByServerId = new Map();
/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map();
/** @type {Set<import('ws').WebSocket>} */
const lobbySockets = new Set();

function genId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pruneLobby() {
    const now = Date.now();
    for (const [id, v] of lobbyServers) {
        if (now - v.lastSeen > SERVER_TIMEOUT_MS) {
            lobbyServers.delete(id);
            hostByServerId.delete(id);
        }
    }
}

function broadcastLobby(obj) {
    const s = JSON.stringify(obj);
    for (const ws of lobbySockets) {
        if (ws.readyState === 1) ws.send(s);
    }
}

function broadcastRoom(serverId, obj) {
    const set = rooms.get(serverId);
    if (!set) return;
    const s = JSON.stringify(obj);
    for (const ws of set) {
        if (ws.readyState === 1) ws.send(s);
    }
}

function addToRoom(serverId, ws) {
    if (!rooms.has(serverId)) rooms.set(serverId, new Set());
    rooms.get(serverId).add(ws);
    if (!ws._brewRooms) ws._brewRooms = new Set();
    ws._brewRooms.add(serverId);
}

function removeFromRoom(serverId, ws) {
    rooms.get(serverId)?.delete(ws);
    ws._brewRooms?.delete(serverId);
    const set = rooms.get(serverId);
    if (set && set.size === 0) rooms.delete(serverId);
}

function cleanupHost(ws) {
    for (const [sid, hws] of [...hostByServerId.entries()]) {
        if (hws !== ws) continue;
        hostByServerId.delete(sid);
        lobbyServers.delete(sid);
        broadcastLobby({
            type: 'lobby-broadcast',
            payload: {
                type: 'server-close',
                id: sid,
                ts: Date.now(),
                from: ws.peerId || 'unknown',
            },
        });
        const peerId = ws.peerId || 'unknown';
        const kick = JSON.stringify({
            type: 'room-msg',
            serverId: sid,
            payload: {
                type: 'host-close',
                ts: Date.now(),
                from: peerId,
            },
        });
        const set = rooms.get(sid);
        if (set) {
            for (const c of set) {
                if (c.readyState === 1) c.send(kick);
            }
            rooms.delete(sid);
        }
    }
}

// HTTP: so opening the Railway HTTPS URL in a browser shows help text instead of "Upgrade Required".
// WebSockets: same port, upgraded via handleUpgrade (what the game uses as wss://).
const server = http.createServer((req, res) => {
    const host = req.headers.host || 'localhost';
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
        'Space Brewery — multiplayer relay (WebSockets only)\n\n' +
            'This URL is not the game. Open your GitHub Pages link to play.\n' +
            'In-game: Find game → Online (relay).\n\n' +
            `Configure the game with: wss://${host}\n`
    );
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    ws.peerId = null;

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (msg.type === 'hello') {
            ws.peerId = typeof msg.peerId === 'string' && msg.peerId ? msg.peerId : genId();
            return;
        }
        if (!ws.peerId) return;

        switch (msg.type) {
            case 'lobby-subscribe':
                lobbySockets.add(ws);
                break;
            case 'lobby-unsubscribe':
                lobbySockets.delete(ws);
                break;
            case 'lobby-msg': {
                const p = msg.payload;
                if (!p || typeof p !== 'object') break;
                if (p.type === 'list-request') {
                    pruneLobby();
                    const servers = Array.from(lobbyServers.values()).map((x) => x.info);
                    servers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
                    if (ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'server-list', servers }));
                    }
                    break;
                }
                if (p.type === 'announce') {
                    const info = {
                        id: p.id,
                        name: p.name,
                        hostName: p.hostName,
                        mode: p.mode || 'online',
                        players: p.players,
                        max: p.max,
                    };
                    lobbyServers.set(p.id, { info, lastSeen: Date.now() });
                    hostByServerId.set(p.id, ws);
                    broadcastLobby({ type: 'lobby-broadcast', payload: p });
                    break;
                }
                if (p.type === 'server-close') {
                    lobbyServers.delete(p.id);
                    hostByServerId.delete(p.id);
                    broadcastLobby({ type: 'lobby-broadcast', payload: p });
                    break;
                }
                break;
            }
            case 'room-join':
                if (msg.serverId) addToRoom(msg.serverId, ws);
                break;
            case 'room-leave':
                if (msg.serverId) removeFromRoom(msg.serverId, ws);
                break;
            case 'room-msg': {
                const { serverId, payload } = msg;
                if (!serverId || !payload) break;
                addToRoom(serverId, ws);
                broadcastRoom(serverId, { type: 'room-msg', serverId, payload });
                break;
            }
            default:
                break;
        }
    });

    ws.on('close', () => {
        lobbySockets.delete(ws);
        cleanupHost(ws);
        if (ws._brewRooms) {
            for (const sid of [...ws._brewRooms]) {
                removeFromRoom(sid, ws);
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Brew relay listening on 0.0.0.0:${PORT} (HTTP help + WebSocket)`);
});
