document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let ws;
    let myPlayerId = null;
    let hostPlayerId = null;
    let players = {};
    let currentLobbyId = null;
    let clientGameState = 'HOME';
    let currentPromptText = '';
    let promptSubmitted = false;
    let currentTask = null;
    let lastBlinkTime = 0;
    let cursorVisible = true;
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    // --- DOM Elements ---
    const views = {
        home: document.getElementById('home-screen'),
        createModal: document.getElementById('create-lobby-modal'),
        usernameModal: document.getElementById('username-modal'),
        game: document.getElementById('game-container')
    };
    const gameCanvas = document.getElementById('game-canvas'), ctx = gameCanvas.getContext('2d');
    const drawingToolbar = document.getElementById('drawing-toolbar');
    const colorPicker = document.getElementById('color-picker');
    const brushSize = document.getElementById('brush-size');
    const showCreateLobbyBtn = document.getElementById('show-create-lobby-btn');
    const playerList = document.getElementById('player-list');
    const startGameBtn = document.getElementById('start-game-btn');
    const lobbyCodeDisplay = document.getElementById('lobby-code-display');
    const createLobbyModal = document.getElementById('create-lobby-modal');
    const usernameModal = document.getElementById('username-modal');
    const cancelCreateBtn = document.getElementById('cancel-create-btn');
    const createBtns = document.querySelectorAll('.create-btn');
    const joinPrivateBtn = document.getElementById('join-private-btn');
    const privateLobbyCodeInput = document.getElementById('private-lobby-code');
    const joinLobbyBtn = document.getElementById('join-lobby-btn');
    const usernameInput = document.getElementById('username-input');
    const publicLobbyList = document.getElementById('public-lobby-list');
    const refreshLobbiesBtn = document.getElementById('refresh-lobbies-btn');

    // --- Styling Constants ---
    const COLORS = { primary: '#1a73e8', green: '#34a853', gray: '#757575', darkGray: '#424242', lightGray: '#bdbdbd', text: '#212121', white: '#ffffff' };

    // --- Utility and Rendering Functions ---
    function wrapText(context, text, x, y, maxWidth, lineHeight, font, color, alignment = 'center') {
        context.font = font;
        context.fillStyle = color;
        context.textAlign = alignment;
        const words = text.split(' ');
        let line = '';
        let currentY = y;
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = context.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                context.fillText(line, x, currentY);
                line = words[n] + ' ';
                currentY += lineHeight;
            } else {
                line = testLine;
            }
        }
        context.fillText(line, x, currentY);
    }

    function setCanvasSize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = gameCanvas.getBoundingClientRect();
        gameCanvas.width = rect.width * dpr;
        gameCanvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
    }

    function renderGameCanvas() {
        requestAnimationFrame(() => {
            const w = gameCanvas.clientWidth;
            const h = gameCanvas.clientHeight;
            if (!w || !h) return;

            // In drawing mode, we don't clear the whole canvas, just the top text area
            if (clientGameState === 'DRAWING') {
                ctx.clearRect(0, 0, gameCanvas.width, 150);
            } else {
                ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
            }
            
            switch (clientGameState) {
                case 'LOBBY':
                    drawLobbyScreen(w, h);
                    break;
                case 'PROMPTING':
                    drawPromptScreen(w, h);
                    break;
                case 'DRAWING':
                    drawDrawingScreen(w, h, currentTask?.content || "Waiting for task...");
                    break;
            }
        });
    }

    function drawLobbyScreen(w, h) {
        wrapText(ctx, 'Waiting for players...', w / 2, h / 2 - 20, w * 0.8, 40, 'bold 32px Nunito', COLORS.darkGray);
        wrapText(ctx, 'The host will start the game when everyone is ready.', w / 2, h / 2 + 30, w * 0.8, 24, '20px Nunito', COLORS.gray);
    }

    function drawPromptScreen(w, h) {
        wrapText(ctx, 'Write something weird or funny!', w / 2, h * 0.15, w * 0.9, 36, 'bold 28px Nunito', COLORS.darkGray);
        const inputBoxY = h * 0.35;
        const inputBoxHeight = 60;
        ctx.strokeStyle = COLORS.lightGray;
        ctx.lineWidth = 2;
        ctx.strokeRect(w * 0.1, inputBoxY, w * 0.8, inputBoxHeight);
        ctx.font = '24px Nunito';
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'left';
        const now = Date.now();
        if (now - lastBlinkTime > 500) {
            cursorVisible = !cursorVisible;
            lastBlinkTime = now;
        }
        const cursor = (cursorVisible && !promptSubmitted) ? '|' : '';
        ctx.fillText(currentPromptText + cursor, w * 0.1 + 15, inputBoxY + inputBoxHeight / 2 + 8);
        const buttonY = inputBoxY + inputBoxHeight + 30;
        if (!promptSubmitted) {
            const btn = getSubmitButtonRect(w, h, buttonY);
            ctx.fillStyle = currentPromptText ? COLORS.green : '#a5d6a7';
            ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
            wrapText(ctx, 'Submit (Enter)', w / 2, btn.y + 35, btn.w, 30, 'bold 24px Nunito', COLORS.white);
        } else {
            wrapText(ctx, "Submitted! Waiting for others...", w / 2, buttonY + 25, w * 0.8, 30, 'bold 24px Nunito', COLORS.gray);
        }
    }

    function drawDrawingScreen(w, h, prompt) {
        wrapText(ctx, 'Your task to draw:', w / 2, h * 0.05, w * 0.9, 22, '18px Nunito', COLORS.darkGray);
        wrapText(ctx, prompt, w / 2, h * 0.05 + 30, w * 0.9, 30, 'bold 24px Nunito', COLORS.primary);
    }
    
    function drawLine(x0, y0, x1, y1, color, width) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    function getSubmitButtonRect(w, h, y) {
        const btnWidth = w * 0.5;
        const btnHeight = 55;
        return { x: (w - btnWidth) / 2, y, w: btnWidth, h: btnHeight };
    }

    // --- View Management and UI Updates ---
    function showView(viewName) {
        for (const key in views) { views[key].classList.add('hidden'); }
        if (views[viewName]) { views[viewName].classList.remove('hidden'); }
    }
    function updatePlayerList() {
        playerList.innerHTML = '';
        for (const id in players) {
            const player = players[id];
            const li = document.createElement('li');
            li.textContent = player.username;
            if (id === myPlayerId) li.innerHTML += ' <span class="role">(You)</span>';
            if (id === hostPlayerId) li.innerHTML += ' <span class="role">(Host)</span>';
            playerList.appendChild(li);
        }
        if (myPlayerId === hostPlayerId) {
            startGameBtn.classList.remove('hidden');
            startGameBtn.disabled = Object.keys(players).length < 2;
        } else {
            startGameBtn.classList.add('hidden');
        }
    }
    async function fetchPublicLobbies() {
        try {
            const response = await fetch('/api/lobbies');
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

    // --- WebSocket Logic ---
    function connectWebSocket(username, lobbyId) {
        currentLobbyId = lobbyId;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/draw/${lobbyId}`);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'join', username }));
        ws.onmessage = handleWebSocketMessage;
        ws.onclose = () => {
            alert('Connection lost. Returning home.');
            window.location.reload();
        };
    }

    function handleWebSocketMessage(event) {
        const data = JSON.parse(event.data);
        console.log('Received:', data);

        switch (data.type) {
            case 'initial_state':
                myPlayerId = data.userId;
                hostPlayerId = data.hostId;
                players = data.players;
                lobbyCodeDisplay.textContent = currentLobbyId;
                clientGameState = 'LOBBY';
                showView('game');
                requestAnimationFrame(() => {
                    setCanvasSize();
                    renderGameCanvas();
                });
                updatePlayerList();
                break;
            case 'player_joined':
                players[data.player.id] = { username: data.player.username };
                updatePlayerList();
                break;
            case 'player_left':
                delete players[data.userId];
                hostPlayerId = data.newHostId;
                updatePlayerList();
                break;
            case 'game_started':
                clientGameState = 'PROMPTING';
                gameCanvas.style.cursor = 'text';
                drawingToolbar.classList.add('hidden');
                renderGameCanvas();
                break;
            case 'prompt_accepted':
                promptSubmitted = true;
                renderGameCanvas();
                break;
            case 'new_task':
                if (data.task.type === 'draw') {
                    clientGameState = 'DRAWING';
                    currentTask = data.task;
                    gameCanvas.style.cursor = 'crosshair';
                    drawingToolbar.classList.remove('hidden');
                    // Clear canvas for drawing and render the new task prompt
                    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
                    renderGameCanvas();
                }
                break;
            case 'beginPath':
                drawLine(data.x - 0.01, data.y, data.x, data.y, data.color, data.size);
                break;
            case 'draw':
                drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size);
                break;
            case 'error':
                alert(`Server error: ${data.message}`);
                break;
        }
    }
    
    // --- Event Listeners ---
    function getMousePos(e) {
        const rect = gameCanvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    startGameBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'start_game' })));

    gameCanvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        if (clientGameState === 'DRAWING') {
            isDrawing = true;
            [lastX, lastY] = [pos.x, pos.y];
            const data = { type: 'beginPath', x: pos.x, y: pos.y, color: colorPicker.value, size: brushSize.value };
            ws.send(JSON.stringify(data));
            drawLine(pos.x - 0.01, pos.y, pos.x, pos.y, data.color, data.size);
        } else if (clientGameState === 'PROMPTING' && !promptSubmitted && currentPromptText) {
            const rect = gameCanvas.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height;
            const btn = getSubmitButtonRect(w, h, h * 0.35 + 60 + 30);
            if (pos.x > btn.x && pos.x < btn.x + btn.w && pos.y > btn.y && pos.y < btn.y + btn.h) {
                ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentPromptText }));
            }
        }
    });

    gameCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || clientGameState !== 'DRAWING') return;
        const pos = getMousePos(e);
        const data = { type: 'draw', x0: lastX, y0: lastY, x1: pos.x, y1: pos.y, color: colorPicker.value, size: brushSize.value };
        ws.send(JSON.stringify(data));
        drawLine(lastX, lastY, pos.x, pos.y, data.color, data.size);
        [lastX, lastY] = [pos.x, pos.y];
    });

    gameCanvas.addEventListener('mouseup', () => { isDrawing = false; });
    gameCanvas.addEventListener('mouseout', () => { isDrawing = false; });

    window.addEventListener('keydown', (e) => {
        if (clientGameState !== 'PROMPTING' || promptSubmitted) return;
        e.preventDefault();
        if (e.key === 'Backspace') {
            currentPromptText = currentPromptText.slice(0, -1);
        } else if (e.key === 'Enter') {
            if (currentPromptText) ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentPromptText }));
        } else if (e.key.length === 1 && currentPromptText.length < 100) {
            currentPromptText += e.key;
        }
        renderGameCanvas();
    });

    window.addEventListener('resize', () => {
        if (clientGameState !== 'HOME') {
            requestAnimationFrame(() => {
                setCanvasSize();
                renderGameCanvas();
            });
        }
    });

    setInterval(() => { if (clientGameState === 'PROMPTING' && !promptSubmitted) renderGameCanvas() }, 500);

    // --- Home Screen & Modal Logic ---
    showCreateLobbyBtn.addEventListener('click', () => createLobbyModal.classList.remove('hidden'));
    cancelCreateBtn.addEventListener('click', () => createLobbyModal.classList.add('hidden');
    refreshLobbiesBtn.addEventListener('click', fetchPublicLobbies);
    
    createBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const type = e.target.dataset.type;
            const response = await fetch('/api/lobbies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            const data = await response.json();
            if (response.ok) {
                currentLobbyId = data.lobbyId;
                createLobbyModal.classList.add('hidden');
                usernameModal.classList.remove('hidden');
            } else { alert(`Error: ${data.message}`); }
        });
    });

    joinPrivateBtn.addEventListener('click', async () => {
        const code = privateLobbyCodeInput.value.trim();
        if (!code) return alert('Please enter a code.');
        const response = await fetch(`/api/lobbies/${code}`);
        if (response.ok) {
            currentLobbyId = code;
            usernameModal.classList.remove('hidden');
        } else { alert('Invalid lobby code.'); }
    });

    joinLobbyBtn.addEventListener('click', () => {
        const username = usernameInput.value.trim();
        if (!username) return alert('Please enter a username.');
        if (!currentLobbyId) return alert('No lobby selected.');
        usernameModal.classList.add('hidden');
        connectWebSocket(username, currentLobbyId);
    });
    
    publicLobbyList.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI' && e.target.dataset.lobbyId) {
            currentLobbyId = e.target.dataset.lobbyId;
            usernameModal.classList.remove('hidden');
        }
    });

    // --- Initial Setup ---
    showView('home');
    fetchPublicLobbies();
});
