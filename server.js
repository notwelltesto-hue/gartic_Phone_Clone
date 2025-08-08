const express = require('express');
const expressWs = require('express-ws');
const { v4: uuidv4 } = require('uuid');
const short = require('short-uuid');

const app = express();
app.use(express.json());
app.use(express.static('public'));
const wsInstance = expressWs(app);

const lobbies = {};
const ROUND_TIME = 60000; // 60 seconds

// --- HTTP Routes (Unchanged) ---
app.post('/api/lobbies', (req, res) => {
    const { type } = req.body;
    const lobbyId = short.generate();
    lobbies[lobbyId] = { type, hostId: null, gameState: 'LOBBY', players: {}, albums: [], roundTimer: null };
    res.status(201).json({ lobbyId });
});
app.get('/api/lobbies', (req, res) => {
    const publicLobbies = Object.entries(lobbies).filter(([,l]) => l.type === 'public' && l.gameState === 'LOBBY').map(([id, l]) => ({ id, userCount: Object.keys(l.players).length }));
    res.json(publicLobbies);
});
app.get('/api/lobbies/:lobbyId', (req, res) => { if (lobbies[req.params.lobbyId]) res.status(200).json({ message: 'Lobby exists.' }); else res.status(404).json({ message: 'Lobby not found.' }); });

// --- WebSocket Route ---
app.ws('/draw/:lobbyId', (ws, req) => {
    const { lobbyId } = req.params;
    const lobby = lobbies[lobbyId];
    if (!lobby) return ws.close();
    const userId = uuidv4();
    ws.id = userId;

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        const player = lobby.players[userId];
        if (data.type === 'join') { handlePlayerJoin(lobby, ws, userId, data.username); return; }
        if (!player) return;
        switch(data.type) {
            case 'start_game': handleStartGame(lobby, userId); break;
            case 'submit_prompt': handleSubmitPrompt(lobby, player, data.prompt); break;
            case 'submit_drawing': handleSubmitDrawing(lobby, player, data.drawingCommands, userId); break;
            case 'beginPath': case 'draw': if (lobby.gameState === 'DRAWING') broadcast(lobby, data, ws); break;
        }
    });

    ws.on('close', () => handlePlayerLeave(lobby, userId));
});

// --- Player Connection ---
function handlePlayerJoin(lobby, ws, userId, username) {
    if (lobby.gameState !== 'LOBBY') { ws.send(JSON.stringify({ type: 'error', message: 'Game has already started.' })); return ws.close(); }
    lobby.players[userId] = { username, ws, isDone: false };
    if (!lobby.hostId) lobby.hostId = userId;
    ws.send(JSON.stringify({ type: 'initial_state', userId, hostId: lobby.hostId, players: getPlayerList(lobby) }));
    broadcast(lobby, { type: 'player_joined', player: { id: userId, username } }, ws);
}
function handlePlayerLeave(lobby, userId) {
    if (!lobby.players[userId]) return;
    const wasHost = lobby.hostId === userId;
    delete lobby.players[userId];
    if (Object.keys(lobby.players).length === 0) { if (lobby.roundTimer) clearTimeout(lobby.roundTimer); delete lobbies[Object.keys(lobbies).find(key => lobbies[key] === lobby)]; } else { if (wasHost) lobby.hostId = Object.keys(lobby.players)[0]; checkRoundCompletion(lobby, true); broadcast(lobby, { type: 'player_left', userId, newHostId: lobby.hostId }); }
}

// --- Game Logic ---
function handleStartGame(lobby, userId) { if (userId === lobby.hostId && lobby.gameState === 'LOBBY' && Object.keys(lobby.players).length >= 2) { lobby.gameState = 'PROMPTING'; broadcast(lobby, { type: 'game_started' }); } }
function handleSubmitPrompt(lobby, player, prompt) { if (lobby.gameState === 'PROMPTING' && !player.isDone) { player.prompt = prompt.slice(0, 100); player.isDone = true; player.ws.send(JSON.stringify({ type: 'prompt_accepted' })); checkRoundCompletion(lobby); } }
function handleSubmitDrawing(lobby, player, drawingCommands, userId) {
    if (lobby.gameState === 'DRAWING' && !player.isDone) {
        const album = lobby.albums.find(a => a.tasks[userId] === 'draw');
        if (album) {
            album.steps.push({ type: 'drawing', content: drawingCommands }); // Store command array
            player.isDone = true;
            checkRoundCompletion(lobby);
        }
    }
}

// --- Round Management ---
function checkRoundCompletion(lobby, playerLeft = false) {
    // A player leaving can also trigger round completion
    const allDone = Object.values(lobby.players).every(p => p.isDone);
    if (allDone && Object.keys(lobby.players).length > 0) {
        startNextRound(lobby);
    }
}

function startNextRound(lobby) {
    if (lobby.roundTimer) clearTimeout(lobby.roundTimer);
    Object.values(lobby.players).forEach(p => p.isDone = false);
    const numPlayers = Object.keys(lobby.players).length;
    if (lobby.albums.length > 0 && lobby.albums[0].steps.length >= numPlayers) {
        startRevealPhase(lobby);
        return;
    }
    startDrawingRound(lobby);
}

function startDrawingRound(lobby) {
    lobby.gameState = 'DRAWING';
    const playerIds = Object.keys(lobby.players);
    const shuffledIds = playerIds.sort(() => 0.5 - Math.random());
    if (lobby.albums.length === 0) { lobby.albums = shuffledIds.map(id => ({ originalAuthor: id, steps: [{ type: 'prompt', content: lobby.players[id].prompt }], tasks: {} })); }
    for (let i = 0; i < shuffledIds.length; i++) {
        const currentPlayerId = shuffledIds[i], assignedAlbumIndex = (i + 1) % shuffledIds.length, assignedAlbum = lobby.albums[assignedAlbumIndex];
        assignedAlbum.tasks[currentPlayerId] = 'draw';
        const task = { type: 'new_task', task: { type: 'draw', content: assignedAlbum.steps[assignedAlbum.steps.length - 1].content }, endTime: Date.now() + ROUND_TIME };
        lobby.players[currentPlayerId].ws.send(JSON.stringify(task));
    }
    // FIX: Authoritative timer that forces the round to end
    lobby.roundTimer = setTimeout(() => {
        console.log(`Lobby ${Object.keys(lobbies).find(key => lobbies[key] === lobby)} timer expired.`);
        Object.entries(lobby.players).forEach(([id, player]) => {
            if (!player.isDone) {
                // Forcefully submit an empty drawing for players who didn't finish
                handleSubmitDrawing(lobby, player, [], id);
            }
        });
    }, ROUND_TIME);
}

function startRevealPhase(lobby) {
    lobby.gameState = 'REVEAL';
    if (lobby.roundTimer) clearTimeout(lobby.roundTimer);
    const finalAlbums = lobby.albums.map(album => ({ originalAuthorName: lobby.players[album.originalAuthor]?.username || 'A mystery player', steps: album.steps }));
    broadcast(lobby, { type: 'reveal_all', albums: finalAlbums });
}

// --- Helpers ---
function getPlayerList(lobby) { const pList = {}; for (const id in lobby.players) pList[id] = { username: lobby.players[id].username }; return pList; }
function broadcast(lobby, message, excludeWs) { const msg = JSON.stringify(message); for (const id in lobby.players) { const p = lobby.players[id]; if (p.ws !== excludeWs && p.ws.readyState === p.ws.OPEN) p.ws.send(msg); } }

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
