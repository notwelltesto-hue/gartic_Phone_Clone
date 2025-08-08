const express = require('express');
const expressWs = require('express-ws');
const { v4: uuidv4 } = require('uuid'); // For unique user IDs
const short = require('short-uuid');   // For short, friendly lobby codes

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies for POST requests
app.use(express.static('public'));
const wsInstance = expressWs(app);

// --- Server State: Manages multiple lobbies ---
const lobbies = {};

// --- HTTP Routes for Lobby Management ---

// 1. Create a new lobby
app.post('/api/lobbies', (req, res) => {
    const { type } = req.body;
    if (type !== 'public' && type !== 'private') {
        return res.status(400).json({ message: 'Invalid lobby type.' });
    }

    const lobbyId = short.generate();
    lobbies[lobbyId] = {
        type: type,
        users: {},
        canvasHistory: []
    };
    console.log(`Lobby created: ${lobbyId} (Type: ${type})`);
    res.status(201).json({ lobbyId: lobbyId });
});

// 2. Get a list of all public lobbies
app.get('/api/lobbies', (req, res) => {
    const publicLobbies = Object.entries(lobbies)
        .filter(([id, lobby]) => lobby.type === 'public')
        .map(([id, lobby]) => ({
            id: id,
            userCount: Object.keys(lobby.users).length
        }));
    res.json(publicLobbies);
});

// 3. NEW: A route to check if a specific lobby exists
app.get('/api/lobbies/:lobbyId', (req, res) => {
    const { lobbyId } = req.params;
    if (lobbies[lobbyId]) {
        res.status(200).json({ message: 'Lobby exists.' });
    } else {
        res.status(404).json({ message: 'Lobby not found.' });
    }
});


// --- WebSocket Route for Drawing in a Lobby ---
app.ws('/draw/:lobbyId', (ws, req) => {
    const { lobbyId } = req.params;
    const lobby = lobbies[lobbyId];

    if (!lobby) {
        ws.close();
        return;
    }

    const userId = uuidv4();
    ws.id = userId;

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        const currentLobby = lobbies[lobbyId];

        if (data.type === 'join') {
            currentLobby.users[userId] = data.username;
            console.log(`${data.username} joined lobby ${lobbyId}`);

            ws.send(JSON.stringify({
                type: 'initial_state',
                canvasHistory: currentLobby.canvasHistory,
                users: currentLobby.users
            }));

            broadcastToLobby(lobbyId, {
                type: 'user_joined',
                userId: userId,
                username: data.username
            }, ws);
        }
        else if (data.type === 'beginPath' || data.type === 'draw') {
            currentLobby.canvasHistory.push(data);
            broadcastToLobby(lobbyId, data, ws);
        }
    });

    ws.on('close', () => {
        const username = lobby.users[userId];
        if (username) {
            console.log(`${username} left lobby ${lobbyId}`);
            delete lobby.users[userId];
            broadcastToLobby(lobbyId, { type: 'user_left', userId: userId });
        }
    });
});

function broadcastToLobby(lobbyId, message, excludeWs) {
    const messageStr = JSON.stringify(message);
    const lobby = lobbies[lobbyId];
    if (!lobby) return;

    wsInstance.getWss().clients.forEach(client => {
        if (client.readyState === client.OPEN && lobby.users[client.id] && client !== excludeWs) {
            client.send(messageStr);
        }
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
