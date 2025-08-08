// --- Views & Modals ---
const views = {
    home: document.getElementById('home-screen'),
    createModal: document.getElementById('create-lobby-modal'),
    usernameModal: document.getElementById('username-modal'),
    app: document.getElementById('app-container')
};

// --- Home Screen Elements ---
const showCreateLobbyBtn = document.getElementById('show-create-lobby-btn');
const privateLobbyCodeInput = document.getElementById('private-lobby-code');
const joinPrivateBtn = document.getElementById('join-private-btn');
const publicLobbyList = document.getElementById('public-lobby-list');
const refreshLobbiesBtn = document.getElementById('refresh-lobbies-btn');

// --- Create Modal Elements ---
const createBtns = document.querySelectorAll('.create-btn');
const cancelCreateBtn = document.getElementById('cancel-create-btn');

// --- Username Modal Elements ---
const usernameInput = document.getElementById('username-input');
const joinLobbyBtn = document.getElementById('join-lobby-btn');

// --- App Elements ---
const lobbyCodeDisplay = document.getElementById('lobby-code-display');
const canvas = document.getElementById('drawing-canvas');
const userList = document.getElementById('user-list');
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const brushSizeValue = document.getElementById('brush-size-value');
const ctx = canvas.getContext('2d');

// --- State ---
let currentLobbyId = null;
let isDrawing = false;
let ws;
let connectedUsers = {};
let canvasHistory = [];

// --- View Management ---
function showView(viewName) {
    Object.values(views).forEach(view => view.style.display = 'none');
    if(views[viewName]) {
        views[viewName].style.display = 'flex';
    }
}

// --- API Calls ---
async function fetchPublicLobbies() {
    try {
        const response = await fetch('/api/lobbies');
        if (!response.ok) throw new Error('Failed to fetch');
        const lobbies = await response.json();
        publicLobbyList.innerHTML = '';
        if (lobbies.length === 0) {
            publicLobbyList.innerHTML = '<li>No public lobbies found.</li>';
        } else {
            lobbies.forEach(lobby => {
                const li = document.createElement('li');
                li.textContent = `Lobby ${lobby.id} (${lobby.userCount} users)`;
                li.dataset.lobbyId = lobby.id;
                publicLobbyList.appendChild(li);
            });
        }
    } catch (error) {
        console.error('Failed to fetch lobbies:', error);
        publicLobbyList.innerHTML = '<li>Error loading lobbies.</li>';
    }
}

// --- THIS IS THE UPDATED FUNCTION ---
async function createLobby(event) {
    const button = event.target;
    const type = button.dataset.type;
    const originalText = button.textContent;

    // 1. Provide visual feedback
    button.disabled = true;
    button.textContent = 'Creating...';

    try {
        console.log(`[CLIENT] Sending request to create lobby of type: ${type}`);
        const response = await fetch('/api/lobbies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: type })
        });

        console.log(`[CLIENT] Received response with status: ${response.status}`);

        // 2. Check if the server responded successfully
        if (response.ok) {
            const data = await response.json();
            console.log('[CLIENT] Successfully parsed response data:', data);

            if (data.lobbyId) {
                // SUCCESS: Proceed to the next step
                currentLobbyId = data.lobbyId;
                views.createModal.style.display = 'none';
                showView('usernameModal');
            } else {
                console.error('[CLIENT] Response was OK, but no lobbyId was found in data.');
                alert('An unexpected server error occurred: Lobby ID was not returned.');
            }
        } else {
            // 3. Handle server errors gracefully
            const errorText = await response.text();
            console.error(`[CLIENT] Server responded with an error: ${response.status}`, errorText);
            alert(`Failed to create lobby. The server said: ${errorText}`);
        }
    } catch (error) {
        console.error('[CLIENT] A network error occurred:', error);
        alert('A network error occurred. Please check your connection and the developer console for more info.');
    } finally {
        // 4. Always restore the button's state
        button.disabled = false;
        button.textContent = originalText;
    }
}

// --- Event Handlers ---
window.addEventListener('load', () => {
    showView('home');
    fetchPublicLobbies();
});

showCreateLobbyBtn.addEventListener('click', () => {
    views.createModal.style.display = 'flex';
});

cancelCreateBtn.addEventListener('click', () => {
    views.createModal.style.display = 'none';
});

// --- THIS EVENT LISTENER IS UPDATED ---
createBtns.forEach(btn => {
    btn.addEventListener('click', createLobby); // Pass the whole event
});

refreshLobbiesBtn.addEventListener('click', fetchPublicLobbies);

publicLobbyList.addEventListener('click', (e) => {
    if (e.target.tagName === 'LI' && e.target.dataset.lobbyId) {
        currentLobbyId = e.target.dataset.lobbyId;
        showView('usernameModal');
    }
});

joinPrivateBtn.addEventListener('click', async () => {
    const code = privateLobbyCodeInput.value.trim();
    if (!code) {
        alert('Please enter a lobby code.');
        return;
    }
    try {
        const response = await fetch(`/api/lobbies/${code}`);
        if (response.ok) {
            currentLobbyId = code;
            showView('usernameModal');
        } else {
            alert('Invalid lobby code. Please check the code and try again.');
            privateLobbyCodeInput.value = '';
        }
    } catch (error) {
        console.error('Error validating lobby code:', error);
        alert('Could not connect to the server to validate the code.');
    }
});

joinLobbyBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
        alert('Please enter a username.');
        return;
    }
    if (!currentLobbyId) {
        alert('No lobby selected!');
        return;
    }
    lobbyCodeDisplay.textContent = currentLobbyId;
    showView('app');
    setCanvasSize();
    connectWebSocket(username, currentLobbyId);
});

// --- WebSocket Logic (UNCHANGED) ---
function connectWebSocket(username, lobbyId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/draw/${lobbyId}`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', username }));
    ws.onmessage = handleWebSocketMessage;
    ws.onclose = () => {
        alert('Connection lost. Please refresh and rejoin.');
        showView('home');
    };
}

function handleWebSocketMessage(event) {
    const data = JSON.parse(event.data);
    switch (data.type) {
        case 'initial_state':
            connectedUsers = data.users;
            canvasHistory = data.canvasHistory;
            redrawCanvas(canvasHistory);
            updateUserList();
            break;
        case 'user_joined':
            connectedUsers[data.userId] = data.username;
            updateUserList();
            break;
        case 'user_left':
            delete connectedUsers[data.userId];
            updateUserList();
            break;
        case 'beginPath':
        case 'draw':
            canvasHistory.push(data);
            drawFromData(data);
            break;
    }
}

// --- UI Logic (UNCHANGED) ---
function updateUserList() {
    userList.innerHTML = '';
    Object.values(connectedUsers).forEach(username => {
        const userItem = document.createElement('li');
        userItem.textContent = username;
        userList.appendChild(userItem);
    });
}

function setCanvasSize() {
    const mainContent = document.getElementById('main-content');
    const toolbar = document.getElementById('toolbar');
    canvas.width = mainContent.clientWidth;
    canvas.height = mainContent.clientHeight - toolbar.offsetHeight;
}

// --- Drawing Event Handlers & Functions (UNCHANGED) ---
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);
brushSize.addEventListener('input', () => brushSizeValue.textContent = brushSize.value);
window.addEventListener('resize', () => {
    if (views.app.style.display === 'flex') {
        setCanvasSize();
        redrawCanvas(canvasHistory);
    }
});

function startDrawing(e) {
    isDrawing = true;
    const { x, y } = getMousePos(e);
    const command = { type: 'beginPath', x: x, y: y, color: colorPicker.value, size: brushSize.value };
    ws.send(JSON.stringify(command));
    canvasHistory.push(command);
    drawFromData(command);
}

function draw(e) {
    if (!isDrawing) return;
    const { x, y } = getMousePos(e);
    const command = { type: 'draw', x: x, y: y };
    ws.send(JSON.stringify(command));
    canvasHistory.push(command);
    drawFromData(command);
}

function stopDrawing() { isDrawing = false; }

function drawFromData(data) {
    if (data.type === 'beginPath') {
        ctx.strokeStyle = data.color;
        ctx.lineWidth = data.size;
        ctx.beginPath();
        ctx.moveTo(data.x, data.y);
    } else if (data.type === 'draw') {
        ctx.lineTo(data.x, y);
        ctx.stroke();
    }
}

function redrawCanvas(history) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const command of history) {
        drawFromData(command);
    }
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}
