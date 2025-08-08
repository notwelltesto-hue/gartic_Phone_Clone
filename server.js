const express = require('express');
const expressWs = require('express-ws');

const app = express();
const wsInstance = expressWs(app);

app.use(express.static('public'));

let lobby = new Set();

app.ws('/draw', (ws, req) => {
  // For this basic example, we'll just add the user to a single global lobby
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    // When a user joins, add them to the lobby and store their username
    if (data.type === 'join') {
      ws.username = data.username;
      lobby.add(ws);
      console.log(`${ws.username} joined the lobby.`);
    }

    // When a user draws, broadcast the drawing data to everyone in the lobby
    if (data.type === 'draw') {
      lobby.forEach(client => {
        if (client !== ws && client.readyState === ws.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    }
  });

  ws.on('close', () => {
    // Remove the user from the lobby upon disconnection
    lobby.delete(ws);
    if (ws.username) {
      console.log(`${ws.username} left the lobby.`);
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
