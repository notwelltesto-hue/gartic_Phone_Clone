const express = require('express');
const expressWs = require('express-ws');
const { v4: uuidv4 } = require('uuid');
const short = require('short-uuid');

const app = express();
app.use(express.json());
app.use(express.static('public'));
const wsInstance = expressWs(app);

const lobbies = {};
/*
NEW Lobby Structure:
{
  ...
  gameState: 'LOBBY' | 'PROMPTING' | 'DRAWING' | 'DESCRIBING' | 'REVEAL',
  albums: [ // The core of the game!
    {
      originalAuthor: 'userId',
      steps: [ { type: 'prompt' | 'drawing', content: '...' } ]
    }
  ]
}
*/

// --- HTTP Routes ---
app.post('/api/lobbies', (req, res) => {
    const { type } = req.body;
    if (type !== 'public' && type !== 'private') {
        return res.status(400).json({ message: 'Invalid lobby type.' });
    }
    const lobbyId = short.generate();
    lobbies[lobbyId] = {
        type, hostId: null, gameState: 'LOBBY', players: {}, albums: []
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
            if (lobby.gameState !== 'LOBBY') {
                ws.send(JSON.stringify({ type: 'error', message: 'Game has already started.' }));
                return ws.close();
            }
            lobby.players[userId] = { username: data.username, ws, prompt: '' };
            if (!lobby.hostId) lobby.hostId = userId;
            ws.send(JSON.stringify({ type: 'initial_state', userId, hostId: lobby.hostId, players: getPlayerList(lobby) }));
            broadcast(lobby, { type: 'player_joined', player: { id: userId, username: data.username } }, ws);
            return;
        }

        if (!player) return; // For all other messages, ignore if player not in lobby

        switch (data.type) {
            case 'start_game':
                if (userId === lobby.hostId && lobby.gameState === 'LOBBY' && Object.keys(lobby.players).length >= 2) {
                    lobby.gameState = 'PROMPTING';
                    broadcast(lobby, { type: 'game_started' });
                }
                break;
            
            case 'submit_prompt':
                if (lobby.gameState === 'PROMPTING' && !player.prompt) { // Prevent double submission
                    player.prompt = data.prompt.slice(0, 100);
                    ws.send(JSON.stringify({ type: 'prompt_accepted' }));
                    checkAllPromptsSubmitted(lobby); // Check if game can advance
                }
                break;
        }
    });

    ws.on('close', () => {
        if (!lobby.players[userId]) return;
        const username = lobby.players[userId].username;
        delete lobby.players[userId];

        if (Object.keys(lobby.players).length === 0) {
            console.log(`Lobby ${lobbyId} is empty, deleting.`);
            delete lobbies[lobbyId];
        } else {
            if (lobby.hostId === userId) {
                lobby.hostId = Object.keys(lobby.players)[0];
            }
            broadcast(lobby, { type: 'player_left', userId, newHostId: lobby.hostId });
        }
    });
});

// --- Game Logic Functions ---
function checkAllPromptsSubmitted(lobby) {
    const allSubmitted = Object.values(lobby.players).every(p => p.prompt);
    if (allSubmitted && lobby.gameState === 'PROMPTING') {
        console.log(`All prompts submitted for lobby ${Object.keys(lobbies).find(key => lobbies[key] === lobby)}. Starting drawing round.`);
        startDrawingRound(lobby);
    }
}

function startDrawingRound(lobby) {
    lobby.gameState = 'DRAWING';
    
    const playerIds = Object.keys(lobby.players);
    const shuffledIds = playerIds.sort(() => Math.random() - 0.5);

    lobby.albums = shuffledIds.map(id => ({
        originalAuthor: id,
        steps: [{ type: 'prompt', content: lobby.players[id].prompt }]
    }));

    for (let i = 0; i < shuffledIds.length; i++) {
        const currentPlayerId = shuffledIds[i];
        const nextPlayerIndex = (i + 1) % shuffledIds.length;
        const assignedAlbum = lobby.albums[nextPlayerIndex];

        const task = {
            type: 'new_task',
            task: {
                type: 'draw',
                content: assignedAlbum.steps[0].content
            }
        };
        lobby.players[currentPlayerId].ws.send(JSON.stringify(task));
    }
}

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
