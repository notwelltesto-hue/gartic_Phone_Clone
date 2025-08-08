const express = require('express');
const expressWs = require('express-ws');
const { v4: uuidv4 } = require('uuid'); // Use UUIDs for truly unique user IDs

const app = express();
const wsInstance = expressWs(app);

app.use(express.static('public'));

// --- Server State ---
// The server is now the source of truth for canvas and user data.
const users = {}; // Stores { id: 'username' }
const canvasHistory = []; // Stores all drawing commands

// --- WebSocket Logic ---
app.ws('/draw', (ws, req) => {
    // 1. Assign a unique ID to the new connection
    const userId = uuidv4();
    ws.id = userId;

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);

        // A. Handle a new user joining
        if (data.type === 'join') {
            users[userId] = data.username;
            console.log(`${data.username} (ID: ${userId}) joined.`);

            // Send the entire canvas history and user list to the NEW user only
            ws.send(JSON.stringify({
                type: 'initial_state',
                canvasHistory: canvasHistory,
                users: users
            }));

            // Notify ALL OTHER users that a new person has joined
            wsInstance.getWss().clients.forEach(client => {
                if (client !== ws && client.readyState === client.OPEN) {
                    client.send(JSON.stringify({
                        type: 'user_joined',
                        userId: userId,
                        username: data.username
                    }));
                }
            });
        }
        
        // B. Handle drawing actions
        else if (data.type === 'beginPath' || data.type === 'draw') {
            // Add the drawing command to our history
            canvasHistory.push(data);
            
            // Broadcast the command to all other users
            wsInstance.getWss().clients.forEach(client => {
                if (client !== ws && client.readyState === client.OPEN) {
                    client.send(msg); // Forward the original message
                }
            });
        }
    });

    ws.on('close', () => {
        const username = users[userId];
        console.log(`${username} (ID: ${userId}) disconnected.`);

        // Remove user from our list
        delete users[userId];

        // Notify all remaining users that this person has left
        wsInstance.getWss().clients.forEach(client => {
            if (client.readyState === client.OPEN) {
                client.send(JSON.stringify({ type: 'user_left', userId: userId }));
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
