const express = require('express');
const expressWs = require('express-ws');
const { v4: uuidv4 } = require('uuid');
const short = require('short-uuid');

const app = express();
app.use(express.json());
app.use(express.static('public'));
const wsInstance = expressWs(app);

const lobbies = {};
const ROUND_TIME = 60000; // 60 seconds in milliseconds

// --- HTTP Routes (Unchanged) ---
app.post('/api/lobbies', (req, res) => {
    const { type } = req.body;
    const lobbyId = short.generate();
    lobbies[lobbyId] = {
        type, hostId: null, gameState: 'LOBBY', players: {}, albums: [], roundTimer: null
    };
    res.status(201).json({ lobbyId });
});
app.get('/api/lobbies', (req, res) => {
    const publicLobbies = Object.entries(lobbies)
        .filter(([,l]) => l.type === 'public' && l.gameState === 'LOBBY')
        .map(([id, l]) => ({ id, userCount: Object.keys(l.players).length }));
    res.json(publicLobbies);
});
app.get('/api/lobbies/:lobbyId', (req, res) => {
    if (lobbies[req.params.lobbyId]) res.status(200).json({ message: 'Lobby exists.' });
    else res.status(404).json({ message: 'Lobby not found.' });
});

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
        if (data.type === 'join') {
            handlePlayerJoin(lobby, ws, userId, data.username);
            return;
        }
        if (!player) return; // All other actions require a joined player
        switch(data.type) {
            case 'start_game': handleStartGame(lobby, userId); break;
            case 'submit_prompt': handleSubmitPrompt(lobby, player, data.prompt); break;
            case 'submit_drawing': handleSubmitDrawing(lobby, player, data.drawing, userId); break;
        }
    });

    ws.on('close', () => handlePlayerLeave(lobby, userId));
});

// --- Player Connection Handlers ---
function handlePlayerJoin(lobby, ws, userId, username) {
    if (lobby.gameState !== 'LOBBY') {
        ws.send(JSON.stringify({ type: 'error', message: 'Game has already started.' }));
        return ws.close();
    }
    lobby.players[userId] = { username, ws, isDone: false };
    if (!lobby.hostId) lobby.hostId = userId;
    ws.send(JSON.stringify({ type: 'initial_state', userId, hostId: lobby.hostId, players: getPlayerList(lobby) }));
    broadcast(lobby, { type: 'player_joined', player: { id: userId, username } }, ws);
}
function handlePlayerLeave(lobby, userId) {
    if (!lobby.players[userId]) return;
    delete lobby.players[userId];
    if (Object.keys(lobby.players).length === 0) {
        if (lobby.roundTimer) clearTimeout(lobby.roundTimer);
        delete lobbies[Object.keys(lobbies).find(key => lobbies[key] === lobby)];
    } else {
        if (lobby.hostId === userId) lobby.hostId = Object.keys(lobby.players)[0];
        broadcast(lobby, { type: 'player_left', userId, newHostId: lobby.hostId });
    }
}

// --- Game Logic Handlers ---
function handleStartGame(lobby, userId) {
    if (userId === lobby.hostId && lobby.gameState === 'LOBBY' && Object.keys(lobby.players).length >= 2) {
        lobby.gameState = 'PROMPTING';
        broadcast(lobby, { type: 'game_started' });
    }
}
function handleSubmitPrompt(lobby, player, prompt) {
    if (lobby.gameState === 'PROMPTING' && !player.prompt) {
        player.prompt = prompt.slice(0, 100);
        player.isDone = true;
        player.ws.send(JSON.stringify({ type: 'prompt_accepted' }));
        checkRoundCompletion(lobby);
    }
}
function handleSubmitDrawing(lobby, player, drawing, userId) {
    if (lobby.gameState === 'DRAWING' && !player.isDone) {
        const album = lobby.albums.find(a => a.tasks[userId] === 'draw');
        if (album) {
            album.steps.push({ type: 'drawing', content: drawing });
            player.isDone = true;
            checkRoundCompletion(lobby);
        }
    }
}

// --- Round Management ---
function checkRoundCompletion(lobby) {
    const allDone = Object.values(lobby.players).every(p => p.isDone);
    if (allDone) {
        startNextRound(lobby);
    }
}

function startNextRound(lobby) {
    if (lobby.roundTimer) clearTimeout(lobby.roundTimer);
    Object.values(lobby.players).forEach(p => p.isDone = false); // Reset for next round

    const numPlayers = Object.keys(lobby.players).length;
    // The first round is always drawing. After that, it's describing, drawing, etc.
    const isDrawingRound = lobby.albums.length === 0 || lobby.albums[0].steps.length % 2 === 1;

    if (lobby.albums.length > 0 && lobby.albums[0].steps.length >= numPlayers) {
        startRevealPhase(lobby);
        return;
    }

    if (isDrawingRound) {
        startDrawingRound(lobby);
    } // Future: else { startDescribingRound(lobby); }
}

function startDrawingRound(lobby) {
    lobby.gameState = 'DRAWING';
    const playerIds = Object.keys(lobby.players);
    const shuffledIds = playerIds.sort(() => 0.5 - Math.random());

    if (lobby.albums.length === 0) { // First drawing round
        lobby.albums = shuffledIds.map(id => ({
            originalAuthor: id,
            steps: [{ type: 'prompt', content: lobby.players[id].prompt }],
            tasks: {}
        }));
    }

    for (let i = 0; i < shuffledIds.length; i++) {
        const currentPlayerId = shuffledIds[i];
        const assignedAlbumIndex = (i + 1) % shuffledIds.length;
        const assignedAlbum = lobby.albums[assignedAlbumIndex];
        assignedAlbum.tasks[currentPlayerId] = 'draw';
        
        const task = {
            type: 'new_task',
            task: { type: 'draw', content: assignedAlbum.steps[0].content },
            endTime: Date.now() + ROUND_TIME
        };
        lobby.players[currentPlayerId].ws.send(JSON.stringify(task));
    }

    lobby.roundTimer = setTimeout(() => startNextRound(lobby), ROUND_TIME);
}

function startRevealPhase(lobby) {
    lobby.gameState = 'REVEAL';
    if (lobby.roundTimer) clearTimeout(lobby.roundTimer);
    // Sanitize albums before sending (remove WebSocket objects)
    const finalAlbums = lobby.albums.map(album => ({
        originalAuthorName: lobby.players[album.originalAuthor]?.username || 'A mystery player',
        steps: album.steps
    }));
    broadcast(lobby, { type: 'reveal_all', albums: finalAlbums });
}

// --- Helpers ---
function getPlayerList(lobby) { const pList = {}; for (const id in lobby.players) pList[id] = { username: lobby.players[id].username }; return pList; }
function broadcast(lobby, message, excludeWs) { const msg = JSON.stringify(message); for (const id in lobby.players) { const p = lobby.players[id]; if (p.ws !== excludeWs && p.ws.readyState === p.ws.OPEN) p.ws.send(msg); } }

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
