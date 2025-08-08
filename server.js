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
Lobby structure is now more robust:
{
  'lobbyId': {
    type: 'public' | 'private',
    users: { 'userId': 'username' },
    canvasHistory: [],
    clients: new Set() // <-- Each lobby now manages its own clients
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
        users: {},
        canvasHistory: [],
        clients: new Set() // Initialize the client set
    };
    console.log(`Lobby created: ${lobbyId} (Type: ${type})`);
    res.status(201).json({ lobbyId: lobbyId });
});

app.get('/api/lobbies', (req, res) => {
    const publicLobbies = Object.entries(lobbies)
        .filter(([id, lobby]) => lobby.type === 'public')
        .map(([id, lobby]) => ({
            id: id,
            userCount: lobby.clients.size // Use the size of the client set
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

// --- WebSocket Route for Drawing in a Lobby ---
app.ws('/draw/:lobbyId', (ws, req) => {
    const { lobbyId } = req.params;
    const lobby = lobbies[lobbyId];

    if (!lobby) {
        console.log(`Connection rejected for non-existent lobby: ${lobbyId}`);
        ws.close();
        return;
    }

    // --- On Connection ---
    const userId = uuidv4();
    ws.id = userId;
    lobby.clients.add(ws); // Add the WebSocket connection to the lobby's client set

    // --- On Message ---
    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        const currentLobby = lobbies[lobbyId];
        if (!currentLobby) return; // Safety check

        if (data.type === 'join') {
            currentLobby.users[userId] = data.username;
            console.log(`${data.username} joined lobby ${lobbyId}`);

            ws.send(JSON.stringify({
                type: 'initial_state',
                canvasHistory: currentLobby.canvasHistory,
                users: currentLobby.users
            }));

            broadcastToLobby(currentLobby, {
                type: 'user_joined',
                userId: userId,
                username: data.username
            }, ws);
        } else if (data.type === 'beginPath' || data.type === 'draw') {
            currentLobby.canvasHistory.push(data);
            broadcastToLobby(currentLobby, data, ws);
        }
    });

    // --- On Close ---
    ws.on('close', () => {
        const currentLobby = lobbies[lobbyId];
        if (!currentLobby) return; // Safety check

        const username = currentLobby.users[userId];
        console.log(`${username} has left lobby ${lobbyId}.`);
        
        // Clean up
        currentLobby.clients.delete(ws);
        delete currentLobby.users[userId];

        // If lobby is now empty, delete it
        if (currentLobby.clients.size === 0) {
            console.log(`Lobby ${lobbyId} is empty and has been deleted.`);
            delete lobbies[lobbyId];
        } else {
            // Otherwise, notify remaining members
            broadcastToLobby(currentLobby, { type: 'user_left', userId: userId });
        }
    });
});

// --- Refactored Broadcast Function ---
function broadcastToLobby(lobby, message, excludeWs) {
    const messageStr = JSON.stringify(message);
    // Loop directly through the lobby's own client set - much more efficient!
    lobby.clients.forEach(client => {
        if (client.readyState === client.OPEN && client !== excludeWs) {
            client.send(messageStr);
        }
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
