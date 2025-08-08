const express = require('express');
const expressWs = require('express-ws');

const app = express();
// This line extends express with WebSocket capabilities
const wsInstance = expressWs(app);

app.use(express.static('public'));

// Use a Set for the lobby for efficient adding/deleting of users.
const lobby = wsInstance.getWss().clients;

app.ws('/draw', (ws, req) => {
  ws.on('message', (msg) => {
    // We just broadcast any message received to all other clients.
    // The client-side will be responsible for the logic.
    lobby.forEach(client => {
      if (client !== ws && client.readyState === client.OPEN) {
        client.send(msg);
      }
    });
  });

  ws.on('close', () => {
    console.log('Client disconnected.');
    // Announce that a user has left to the remaining users.
    const leaveMessage = JSON.stringify({ type: 'user_leave', id: ws.id });
     lobby.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(leaveMessage);
      }
    });
  });

  // Assign a unique ID to each user for tracking
  ws.id = Date.now();
  console.log('Client connected with ID:', ws.id);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
