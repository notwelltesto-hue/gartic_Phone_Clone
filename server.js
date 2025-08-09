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
const REVEAL_PROMPT_TIME = 5000; // 5 seconds
const REVEAL_DRAWING_TIME = 8000; // 8 seconds

// --- HTTP Routes ---
app.post('/api/lobbies', (req, res) => {
    const { type } = req.body;
    const lobbyId = short.generate();
    lobbies[lobbyId] = {
        type,
        hostId: null,
        gameState: 'LOBBY', // LOBBY | PROMPTING | DRAWING | DESCRIBING | REVEAL
        players: {},
        albums: [],
        roundTimer: null,
        shuffledPlayerIds: [],
        revealState: null
    };
    console.log(`Lobby created: ${lobbyId} (Type: ${type})`);
    res.status(201).json({ lobbyId });
});

app.get('/api/lobbies', (req, res) => {
    const publicLobbies = Object.entries(lobbies)
        .filter(([, lobby]) => lobby.type === 'public' && lobby.gameState === 'LOBBY')
        .map(([id, lobby]) => ({ id, userCount: Object.keys(lobby.players).length }));
    res.json(publicLobbies);
});

app.get('/api/lobbies/:lobbyId', (req, res) => {
    if (lobbies[req.params.lobbyId]) {
        res.status(200).json({ message: 'Lobby exists.' });
    } else {
        res.status(404).json({ message: 'Lobby not found.' });
    }
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
        if (!player) return;

        switch(data.type) {
            case 'start_game':
                handleStartGame(lobby, userId);
                break;
            case 'submit_prompt':
                handleSubmitPrompt(lobby, player, data.prompt);
                break;
            case 'submit_drawing':
                handleSubmitDrawing(lobby, player, data.drawingCommands, userId);
                break;
            case 'submit_description':
                handleSubmitDescription(lobby, player, data.description, userId);
                break;
            case 'next_reveal_step':
                handleNextRevealStep(lobby, userId, true); // true means user-forced
                break;
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

    const wasHost = lobby.hostId === userId;
    const lobbyId = Object.keys(lobbies).find(key => lobbies[key] === lobby);
    
    delete lobby.players[userId];
    
    if (Object.keys(lobby.players).length === 0) {
        if (lobby.roundTimer) clearTimeout(lobby.roundTimer);
        delete lobbies[lobbyId];
        console.log(`Lobby ${lobbyId} has been deleted.`);
    } else {
        if (wasHost) {
            lobby.hostId = Object.keys(lobby.players)[0];
        }
        checkRoundCompletion(lobby);
        broadcast(lobby, { type: 'player_left', userId, newHostId: lobby.hostId });
    }
}

// --- Game Logic Handlers ---
function handleStartGame(lobby, userId) {
    if (userId === lobby.hostId && lobby.gameState === 'LOBBY' && Object.keys(lobby.players).length >= 2) {
        lobby.gameState = 'PROMPTING';
        lobby.shuffledPlayerIds = Object.keys(lobby.players).sort(() => 0.5 - Math.random());
        broadcast(lobby, { type: 'game_started' });
    }
}

function handleSubmitPrompt(lobby, player, prompt) {
    if (lobby.gameState === 'PROMPTING' && !player.isDone) {
        player.prompt = prompt.slice(0, 100);
        player.isDone = true;
        player.ws.send(JSON.stringify({ type: 'prompt_accepted' }));
        checkRoundCompletion(lobby);
    }
}

function handleSubmitDrawing(lobby, player, drawingCommands, userId) {
    if (lobby.gameState === 'DRAWING' && !player.isDone) {
        const album = lobby.albums.find(a => a.tasks[userId] === 'draw');
        if (album) {
            album.steps.push({ type: 'drawing', author: player.username, content: drawingCommands });
            player.isDone = true;
            checkRoundCompletion(lobby);
        }
    }
}

function handleSubmitDescription(lobby, player, description, userId) {
    if (lobby.gameState === 'DESCRIBING' && !player.isDone) {
        const album = lobby.albums.find(a => a.tasks[userId] === 'describe');
        if (album) {
            album.steps.push({ type: 'prompt', author: player.username, content: description });
            player.isDone = true;
            checkRoundCompletion(lobby);
        }
    }
}

// --- Round & Reveal Management ---
function checkRoundCompletion(lobby) {
    const playersInGame = Object.values(lobby.players);
    if (playersInGame.length === 0) return;

    const allDone = playersInGame.every(p => p.isDone);
    
    if (allDone) {
        const lobbyId = Object.keys(lobbies).find(key => lobbies[key] === lobby);
        console.log(`[Lobby ${lobbyId}] All players are done. Starting next round.`);
        startNextRound(lobby);
    }
}

function startNextRound(lobby) {
    if (lobby.roundTimer) clearTimeout(lobby.roundTimer);
    Object.values(lobby.players).forEach(p => p.isDone = false);
    const numPlayers = lobby.shuffledPlayerIds.length;
    
    if (lobby.albums.length > 0 && lobby.albums[0].steps.length >= numPlayers) {
        startRevealPhase(lobby);
        return;
    }

    const isFirstRound = lobby.albums.length === 0;
    const nextStepIsDrawing = isFirstRound || lobby.albums[0].steps.length % 2 === 1;

    if (nextStepIsDrawing) {
        startDrawingRound(lobby);
    } else {
        startDescribingRound(lobby);
    }
}

function startDrawingRound(lobby) {
    lobby.gameState = 'DRAWING';
    const playerIds = lobby.shuffledPlayerIds;
    const roundNumber = lobby.albums.length === 0 ? 1 : lobby.albums[0].steps.length;

    if (lobby.albums.length === 0) {
        lobby.albums = playerIds.map(id => ({
            originalAuthor: id,
            steps: [{ type: 'prompt', author: lobby.players[id].username, content: lobby.players[id].prompt }],
            tasks: {}
        }));
    }
    
    for (let i = 0; i < playerIds.length; i++) {
        const currentPlayerId = playerIds[i];
        const assignedAlbumIndex = (i + roundNumber) % playerIds.length;
        const assignedAlbum = lobby.albums[assignedAlbumIndex];
        
        assignedAlbum.tasks = {};
        assignedAlbum.tasks[currentPlayerId] = 'draw';
        
        const task = {
            type: 'new_task',
            task: { type: 'draw', content: assignedAlbum.steps[assignedAlbum.steps.length - 1].content },
            endTime: Date.now() + ROUND_TIME
        };
        lobby.players[currentPlayerId].ws.send(JSON.stringify(task));
    }
    
    lobby.roundTimer = setTimeout(() => {
        Object.entries(lobby.players).forEach(([id, player]) => {
            if (!player.isDone) handleSubmitDrawing(lobby, player, [], id);
        });
    }, ROUND_TIME);
}

function startDescribingRound(lobby) {
    lobby.gameState = 'DESCRIBING';
    const playerIds = lobby.shuffledPlayerIds;
    const roundNumber = lobby.albums[0].steps.length;

    for (let i = 0; i < playerIds.length; i++) {
        const currentPlayerId = playerIds[i];
        const assignedAlbumIndex = (i + roundNumber) % playerIds.length;
        const assignedAlbum = lobby.albums[assignedAlbumIndex];
        
        assignedAlbum.tasks = {};
        assignedAlbum.tasks[currentPlayerId] = 'describe';

        const task = {
            type: 'new_task',
            task: { type: 'describe', content: assignedAlbum.steps[assignedAlbum.steps.length - 1].content },
            endTime: Date.now() + ROUND_TIME
        };
        lobby.players[currentPlayerId].ws.send(JSON.stringify(task));
    }
    
    lobby.roundTimer = setTimeout(() => {
        Object.entries(lobby.players).forEach(([id, player]) => {
            if (!player.isDone) handleSubmitDescription(lobby, player, "...", id);
        });
    }, ROUND_TIME);
}

function startRevealPhase(lobby) {
    lobby.gameState = 'REVEAL';
    if (lobby.roundTimer) clearTimeout(lobby.roundTimer);
    lobby.revealState = { albumIndex: 0, stepIndex: -1 };
    
    const finalAlbums = lobby.albums.map(album => ({
        originalAuthorName: lobby.players[album.originalAuthor]?.username || 'A Player',
        steps: album.steps
    }));
    
    broadcast(lobby, { type: 'reveal_all', albums: finalAlbums });
    
    // Kick off the first step automatically
    handleNextRevealStep(lobby, lobby.hostId, false);
}

function handleNextRevealStep(lobby, userId, userForced = false) {
    if (lobby.gameState !== 'REVEAL' || userId !== lobby.hostId || !lobby.revealState) return;
    if (userForced && lobby.roundTimer) clearTimeout(lobby.roundTimer);

    lobby.revealState.stepIndex++;
    
    const album = lobby.albums[lobby.revealState.albumIndex];
    if (!album || lobby.revealState.stepIndex >= album.steps.length) {
        lobby.revealState.albumIndex++;
        lobby.revealState.stepIndex = 0;
        if (lobby.revealState.albumIndex >= lobby.albums.length) {
            broadcast(lobby, { type: 'game_over' });
            return;
        }
    }
    
    broadcast(lobby, { type: 'update_reveal_step', ...lobby.revealState });
    
    const currentStep = lobby.albums[lobby.revealState.albumIndex].steps[lobby.revealState.stepIndex];
    const delay = currentStep.type === 'prompt' ? REVEAL_PROMPT_TIME : REVEAL_DRAWING_TIME;
    
    lobby.roundTimer = setTimeout(() => {
        handleNextRevealStep(lobby, lobby.hostId, false);
    }, delay);
}

// --- Helper Functions ---
function getPlayerList(lobby) {
    const playerList = {};
    for (const id in lobby.players) {
        playerList[id] = { username: lobby.players[id].username };
    }
    return playerList;
}

function broadcast(lobby, message, excludeWs) {
    const messageStr = JSON.stringify(message);
    for (const id in lobby.players) {
        const player = lobby.players[id];
        if (player.ws !== excludeWs && player.ws.readyState === player.ws.OPEN) {
            player.ws.send(messageStr);
        }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
