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

    // --- DOM Elements ---
    const views = {
        home: document.getElementById('home-screen'),
        createModal: document.getElementById('create-lobby-modal'),
        usernameModal: document.getElementById('username-modal'),
        game: document.getElementById('game-container'),
    };
    const gameCanvas = document.getElementById('game-canvas');
    const ctx = gameCanvas.getContext('2d');
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

    // --- Canvas UI Rendering ---
    function setCanvasSize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = gameCanvas.parentElement.getBoundingClientRect();
        const size = Math.min(rect.width - 40, rect.height - 40, 900);
        gameCanvas.width = size * dpr;
        gameCanvas.height = size * dpr;
        ctx.scale(dpr, dpr);
        gameCanvas.style.width = `${size}px`;
        gameCanvas.style.height = `${size}px`;
    }

    function renderGameCanvas() {
        const w = gameCanvas.width / window.devicePixelRatio;
        const h = gameCanvas.height / window.devicePixelRatio;
        ctx.clearRect(0, 0, w, h);
        
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
    }

    function drawLobbyScreen(w, h) {
        ctx.fillStyle = '#757575';
        ctx.font = 'bold 32px Nunito';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for players...', w / 2, h / 2);
        ctx.font = '20px Nunito';
        ctx.fillText('The host will start the game.', w / 2, h / 2 + 40);
    }

    function drawPromptScreen(w, h) {
        ctx.fillStyle = '#424242';
        ctx.font = 'bold 28px Nunito';
        ctx.textAlign = 'center';
        ctx.fillText('Write something weird or funny!', w / 2, h * 0.2);

        // Text input box simulation
        ctx.strokeStyle = '#bdbdbd';
        ctx.lineWidth = 2;
        ctx.strokeRect(w * 0.1, h * 0.4, w * 0.8, 50);
        
        ctx.fillStyle = '#212121';
        ctx.font = '24px Nunito';
        ctx.textAlign = 'left';
        ctx.fillText(currentPromptText + (Date.now() % 1000 < 500 && !promptSubmitted ? '|' : ''), w * 0.1 + 10, h * 0.4 + 35);
        
        if (!promptSubmitted) {
            const btn = getSubmitButtonRect(w, h);
            ctx.fillStyle = currentPromptText ? '#34a853' : '#a5d6a7';
            ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 24px Nunito';
            ctx.textAlign = 'center';
            ctx.fillText('Submit', w / 2, btn.y + 35);
        } else {
            ctx.fillStyle = '#757575';
            ctx.font = 'bold 24px Nunito';
            ctx.textAlign = 'center';
            ctx.fillText("Submitted! Waiting for others...", w / 2, h * 0.65);
        }
    }

    function drawDrawingScreen(w, h, prompt) {
        ctx.fillStyle = '#424242';
        ctx.font = '18px Nunito';
        ctx.textAlign = 'center';
        ctx.fillText('Your task to draw:', w / 2, h * 0.05);
        ctx.font = 'bold 24px Nunito';
        ctx.fillText(prompt, w / 2, h * 0.05 + 35);
        // Drawing logic will go here later
    }

    function getSubmitButtonRect(w, h) {
        return { x: w * 0.3, y: h * 0.6, w: w * 0.4, h: 50 };
    }

    // --- View Management ---
    function showView(viewName) {
        for (const key in views) { views[key].classList.add('hidden'); }
        if (views[viewName]) { views[viewName].classList.remove('hidden'); }
    }

    // --- UI Updates ---
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
                setCanvasSize();
                renderGameCanvas();
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
                    renderGameCanvas();
                }
                break;
            case 'error':
                alert(`Server error: ${data.message}`);
                break;
        }
    }
    
    // --- Event Listeners ---
    startGameBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'start_game' }));
    });
    
    window.addEventListener('keydown', (e) => {
        if (clientGameState !== 'PROMPTING' || promptSubmitted) return;
        if (e.key === 'Backspace') {
            currentPromptText = currentPromptText.slice(0, -1);
        } else if (e.key === 'Enter') {
            if(currentPromptText) ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentPromptText }));
        } else if (e.key.length === 1 && currentPromptText.length < 100) {
            currentPromptText += e.key;
        }
        renderGameCanvas();
    });

    gameCanvas.addEventListener('mousedown', (e) => {
        if (clientGameState !== 'PROMPTING' || promptSubmitted) return;
        const rect = gameCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const w = gameCanvas.width / window.devicePixelRatio;
        const h = gameCanvas.height / window.devicePixelRatio;
        const btn = getSubmitButtonRect(w, h);

        if (mouseX > btn.x && mouseX < btn.x + btn.w && mouseY > btn.y && mouseY < btn.y + btn.h) {
            if (currentPromptText) ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentPromptText }));
        }
    });

    // --- Home Screen & Modal Logic ---
    showCreateLobbyBtn.addEventListener('click', () => createLobbyModal.classList.remove('hidden'));
    cancelCreateBtn.addEventListener('click', () => createLobbyModal.classList.add('hidden'));
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
    window.addEventListener('resize', () => {
        if(clientGameState !== 'HOME') {
            setCanvasSize();
            renderGameCanvas();
        }
    });
    setInterval(() => { if (clientGameState === 'PROMPTING') renderGameCanvas(); }, 500); // For cursor blink

    // --- Initial Setup ---
    showView('home');
});
