// --- DOM Elements ---
const usernameContainer = document.getElementById('username-container');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const appContainer = document.getElementById('app-container');
const canvas = document.getElementById('drawing-canvas');
const userList = document.getElementById('user-list');

// --- Toolbar Elements ---
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const brushSizeValue = document.getElementById('brush-size-value');

// --- State ---
const ctx = canvas.getContext('2d');
let isDrawing = false;
let ws;
let connectedUsers = {}; // This will now be managed by the server

// --- WebSocket Logic ---
function connectWebSocket(username) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/draw`);

    ws.onopen = () => {
        console.log('Connected to server.');
        // Just send a simple join message. The server handles the rest.
        ws.send(JSON.stringify({ type: 'join', username: username }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            // Case 1: The server is giving us the initial state
            case 'initial_state':
                connectedUsers = data.users;
                redrawCanvas(data.canvasHistory);
                updateUserList();
                break;

            // Case 2: A new user has joined
            case 'user_joined':
                connectedUsers[data.userId] = data.username;
                updateUserList();
                break;

            // Case 3: A user has left
            case 'user_left':
                delete connectedUsers[data.userId];
                updateUserList();
                break;
            
            // Case 4: Drawing actions from others
            case 'beginPath':
                drawFromData(data);
                break;
            case 'draw':
                drawFromData(data);
                break;
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from server.');
        alert('Connection lost. Please refresh.');
    };
}

// --- Drawing Logic ---
function startDrawing(e) {
    isDrawing = true;
    const { x, y } = getMousePos(e);
    const command = {
        type: 'beginPath',
        x: x, y: y,
        color: colorPicker.value,
        size: brushSize.value
    };
    ws.send(JSON.stringify(command)); // Send command to server
    drawFromData(command); // Draw on your own canvas
}

function draw(e) {
    if (!isDrawing) return;
    const { x, y } = getMousePos(e);
    const command = { type: 'draw', x: x, y: y };
    ws.send(JSON.stringify(command));
    drawFromData(command);
}

// A single function to handle drawing based on command data
function drawFromData(data) {
    if (data.type === 'beginPath') {
        ctx.strokeStyle = data.color;
        ctx.lineWidth = data.size;
        ctx.beginPath();
        ctx.moveTo(data.x, data.y);
    } else if (data.type === 'draw') {
        ctx.lineTo(data.x, data.y);
        ctx.stroke();
    }
}

// Function to redraw the entire canvas from history
function redrawCanvas(history) {
    for (const command of history) {
        drawFromData(command);
    }
}

function stopDrawing() { isDrawing = false; }
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

// --- UI Logic ---
function joinLobby() {
    const username = usernameInput.value.trim();
    if (username) {
        usernameContainer.style.display = 'none';
        appContainer.style.display = 'flex';
        setCanvasSize();
        connectWebSocket(username);
    } else {
        alert('Please enter a username.');
    }
}

function updateUserList() {
    userList.innerHTML = ''; // Clear the list
    Object.values(connectedUsers).forEach(username => {
        const userItem = document.createElement('li');
        userItem.textContent = username;
        userList.appendChild(userItem);
    });
}

function setCanvasSize() {
    // Get the actual computed style of the canvas container
    const mainContent = document.getElementById('main-content');
    const toolbar = document.getElementById('toolbar');
    
    // Set canvas logical size to its display size
    canvas.width = mainContent.clientWidth;
    canvas.height = mainContent.clientHeight - toolbar.offsetHeight;
}

// --- Event Listeners ---
joinBtn.addEventListener('click', joinLobby);
usernameInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') joinLobby();
});
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);
brushSize.addEventListener('input', () => brushSizeValue.textContent = brushSize.value);
window.addEventListener('resize', () => {
    setCanvasSize();
    redrawCanvas(canvasHistory); // Redraw after resize
});
