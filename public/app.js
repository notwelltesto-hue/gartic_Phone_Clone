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

// --- Canvas & Drawing State ---
const ctx = canvas.getContext('2d');
let isDrawing = false;
let ws;
const connectedUsers = {};

// --- Utility Functions ---
function setCanvasSize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}

// --- WebSocket Logic ---
function connectWebSocket(username) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/draw`);

    ws.onopen = () => {
        console.log('Connected to WebSocket server.');
        const joinMessage = { type: 'user_join', username: username };
        ws.send(JSON.stringify(joinMessage));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Drawing actions
        if (data.type === 'beginPath') {
            ctx.strokeStyle = data.color;
            ctx.lineWidth = data.size;
            ctx.beginPath();
            ctx.moveTo(data.x, data.y);
        } else if (data.type === 'draw') {
            ctx.lineTo(data.x, data.y);
            ctx.stroke();
        }

        // User management
        else if (data.type === 'user_join') {
            connectedUsers[data.id] = data.username;
            updateUserList();
            // Send my info to the new user
            ws.send(JSON.stringify({ type: 'user_join', username: usernameInput.value }));
        } else if (data.type === 'user_leave') {
            delete connectedUsers[data.id];
            updateUserList();
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from server.');
        alert('Connection lost. Please refresh the page.');
    };
}

// --- Drawing Event Handlers ---
function startDrawing(e) {
    isDrawing = true;
    const { x, y } = getMousePos(e);
    
    // Draw on own canvas
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = brushSize.value;
    ctx.beginPath();
    ctx.moveTo(x, y);

    // Send data to other users
    ws.send(JSON.stringify({
        type: 'beginPath',
        x: x,
        y: y,
        color: colorPicker.value,
        size: brushSize.value
    }));
}

function draw(e) {
    if (!isDrawing) return;
    const { x, y } = getMousePos(e);
    
    // Draw on own canvas
    ctx.lineTo(x, y);
    ctx.stroke();

    // Send data to other users
    ws.send(JSON.stringify({ type: 'draw', x: x, y: y }));
}

function stopDrawing() {
    isDrawing = false;
}

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
    userList.innerHTML = '';
    for (const id in connectedUsers) {
        const userItem = document.createElement('li');
        userItem.textContent = connectedUsers[id];
        userList.appendChild(userItem);
    }
}

// --- Event Listeners ---
joinBtn.addEventListener('click', joinLobby);
usernameInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') joinLobby();
});

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing); // Stop drawing if mouse leaves canvas

brushSize.addEventListener('input', () => {
    brushSizeValue.textContent = brushSize.value;
});

window.addEventListener('resize', setCanvasSize);
