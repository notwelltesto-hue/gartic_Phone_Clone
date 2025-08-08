const usernameContainer = document.getElementById('username-container');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const canvasContainer = document.getElementById('canvas-container');
const connectionStatus = document.getElementById('connection-status');
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');

let drawing = false;
let ws;

joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        usernameContainer.style.display = 'none';
        canvasContainer.style.display = 'block';
        connectWebSocket(username);
    }
});

function connectWebSocket(username) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/draw`);

    ws.onopen = () => {
        connectionStatus.textContent = `Connected as: ${username}`;
        ws.send(JSON.stringify({ type: 'join', username: username }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'draw') {
            drawOnCanvas(data.x, data.y, data.prevX, data.prevY);
        }
    };

    ws.onclose = () => {
        connectionStatus.textContent = 'Disconnected from lobby.';
    };

    ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        connectionStatus.textContent = 'Connection error.';
    };
}

canvas.addEventListener('mousedown', (e) => {
    drawing = true;
    const { x, y } = getMousePos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
});

canvas.addEventListener('mouseup', () => {
    drawing = false;
});

canvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const { x, y } = getMousePos(e);
    const { prevX, prevY } = getPreviousMousePos(e);
    drawOnCanvas(x, y, prevX, prevY);
    ws.send(JSON.stringify({ type: 'draw', x, y, prevX, prevY }));
});

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function getPreviousMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        prevX: e.clientX - rect.left - e.movementX,
        prevY: e.clientY - rect.top - e.movementY
    };
}

function drawOnCanvas(x, y, prevX, prevY) {
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
}
