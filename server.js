const express = require('express');
const expressWs = require('express-ws');
const { v4: uuidv4 } = require('uuid'); // For unique user IDs
const short = require('short-uuid');   // For short, friendly lobby codes

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies for POST requests
app.use(express.static('public'));
const wsInstance = expressWs(app);

// --- Server State: Manages multiple lobbies ---
// The 'lobbies' object is now the single source of truth.
const lobbies = {};
/*
Lobby structure:
{
  'lobbyId': {
    type: 'public' | 'private',
    users: { 'userId': 'username' },
    canvasHistory: [],
    // Note: The 'clients' set is managed by express-ws implicitly
  }
}
*/

// --- HTTP Routes for Lobby Management ---

// 1. Create a new lobby
app.post('/api/lobbies', (req, res) => {
    const { type } = req.body; // Expects { "type": "public" | "private" }
    if (type !== 'public' && type !== 'private') {
        return res.status(400).json({ message: 'Invalid lobby type.' });
    }

    const lobbyId = short.generate(); // Generate a friendly, short ID
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

// --- WebSocket Route for Drawing in a Lobby ---
// The URL now includes the specific lobby ID to join.
app.ws('/draw/:lobbyId', (ws, req) => {
    const { lobbyId } = req.params;
    const lobby = lobbies[lobbyId];

    // If lobby doesn't exist, close connection
    if (!lobby) {
        console.log(`Connection rejected for non-existent lobby: ${lobbyId}`);
        ws.close();
        return;
    }

    const userId = uuidv4();
    ws.id = userId;

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        const currentLobby = lobbies[lobbyId]; // Ensure we're always acting on the correct lobby

        if (data.type === 'join') {
            currentLobby.users[userId] = data.username;
            console.log(`${data.username} joined lobby ${lobbyId}`);

            // Send history and user list to the new user
            ws.send(JSON.stringify({
                type: 'initial_state',
                canvasHistory: currentLobby.canvasHistory,
                users: currentLobby.users
            }));

            // Notify everyone else in the same lobby
            broadcastToLobby(lobbyId, {
                type: 'user_joined',
                userId: userId,
                username: data.username
            }, ws); // Exclude the sender
        }
        else if (data.type === 'beginPath' || data.type === 'draw') {
            currentLobby.canvasHistory.push(data);
            broadcastToLobby(lobbyId, data, ws); // Broadcast drawing to the lobby
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

// Helper function to broadcast messages to a specific lobby
function broadcastToLobby(lobbyId, message, excludeWs) {
    const messageStr = JSON.stringify(message);
    // Iterate through all clients on the server
    wsInstance.getWss().clients.forEach(client => {
        // Check if the client is in our target lobby and isn't the excluded client
        if (client.readyState === client.OPEN && lobbies[lobbyId]?.users[client.id] && client !== excludeWs) {
            client.send(messageStr);
        }
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
