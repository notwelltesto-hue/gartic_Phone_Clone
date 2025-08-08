const express = require('express');
const expressWs = require('express-ws');
const { v4: uuidv4 } = require('uuid');
const short = require('short-uuid');

const app = express();
app.use(express.json());
app.use(express.static('public'));
const wsInstance = expressWs(app);

// --- Server State: Manages multiple lobbies ---
const lobbies = {};
/*
NEW Lobby Structure:
{
  'lobbyId': {
    type: 'public' | 'private',
    hostId: 'userId',           // The first player is the host
    gameState: 'LOBBY',         // LOBBY | PROMPTING | PLAYING | REVEAL
    players: {
      'userId': {
        username: 'name',
        ws: WebSocket,          // Direct reference to the client
        prompt: ''
      }
    },
    canvasHistory: [] // Will be replaced by albums later
  }
}
*/

// --- HTTP Routes (Unchanged) ---
app.post('/api/lobbies', (req, res) => {
    const { type } = req.body;
    if (type !== 'public' && type !== 'private') {
        return res.status(400).json({ message: 'Invalid lobby type.' });
    }
    const lobbyId = short.generate();
    lobbies[lobbyId] = {
        type: type,
        hostId: null,
        gameState: 'LOBBY',
        players: {},
        canvasHistory: []
    };
    console.log(`Lobby created: ${lobbyId} (Type: ${type})`);
    res.status(201).json({ lobbyId: lobbyId });
});

app.get('/api/lobbies', (req, res) => {
    const publicLobbies = Object.entries(lobbies)
        .filter(([, lobby]) => lobby.type === 'public' && lobby.gameState === 'LOBBY')
        .map(([id, lobby]) => ({
            id: id,
            userCount: Object.keys(lobby.players).length
        }));
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
    if (!lobby) { return ws.close(); }

    const userId = uuidv4();
    ws.id = userId;

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        const player = lobby.players[userId];
        if (!player) return; // Ignore messages from non-joined players

        // --- Game Actions ---
        switch (data.type) {
            case 'join':
                // Check if game has started
                if (lobby.gameState !== 'LOBBY') {
                    ws.send(JSON.stringify({ type: 'error', message: 'Game has already started.' }));
                    ws.close();
                    return;
                }
                // Add player
                lobby.players[userId] = { username: data.username, ws: ws, prompt: '' };
                if (!lobby.hostId) { lobby.hostId = userId; } // First player is host

                // Send initial state to the new player
                ws.send(JSON.stringify({
                    type: 'initial_state',
                    userId: userId,
                    hostId: lobby.hostId,
                    players: getPlayerList(lobby)
                }));
                // Notify everyone else
                broadcast(lobby, { type: 'player_joined', player: { id: userId, username: data.username } }, ws);
                break;

            case 'start_game':
                if (userId === lobby.hostId && lobby.gameState === 'LOBBY') {
                    console.log(`Game starting in lobby ${lobbyId}`);
                    lobby.gameState = 'PROMPTING';
                    broadcast(lobby, { type: 'game_started' });
                }
                break;
            
            case 'submit_prompt':
                if (lobby.gameState === 'PROMPTING' && player) {
                    player.prompt = data.prompt.slice(0, 100); // Sanitize prompt length
                    console.log(`${player.username} submitted prompt: ${player.prompt}`);
                    // Optional: check if all prompts are in to auto-advance
                }
                break;
        }
    });

    ws.on('close', () => {
        if (!lobby.players[userId]) return;

        const username = lobby.players[userId].username;
        console.log(`${username} left lobby ${lobbyId}`);
        delete lobby.players[userId];

        if (Object.keys(lobby.players).length === 0) {
            console.log(`Lobby ${lobbyId} is empty, deleting.`);
            delete lobbies[lobbyId];
        } else {
            // If the host left, assign a new host
            if (lobby.hostId === userId) {
                lobby.hostId = Object.keys(lobby.players)[0];
            }
            broadcast(lobby, { type: 'player_left', userId: userId, newHostId: lobby.hostId });
        }
    });
});

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
