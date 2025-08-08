document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let ws;
    let currentLobbyId = null;
    let myPlayerId = null;
    let hostPlayerId = null;
    let players = {};

    // --- DOM Elements ---
    // Views
    const views = {
        home: document.getElementById('home-screen'),
        createModal: document.getElementById('create-lobby-modal'),
        usernameModal: document.getElementById('username-modal'),
        game: document.getElementById('game-container'),
    };
    // Game Sub-Views
    const gameViews = {
        waiting: document.getElementById('waiting-room-view'),
        prompting: document.getElementById('prompt-view'),
        drawing: document.getElementById('drawing-view'),
    };
    // Home/Modal Elements
    const showCreateLobbyBtn = document.getElementById('show-create-lobby-btn');
    const createLobbyModal = document.getElementById('create-lobby-modal');
    const usernameModal = document.getElementById('username-modal');
    const cancelCreateBtn = document.getElementById('cancel-create-btn');
    const createBtns = document.querySelectorAll('.create-btn');
    const joinPrivateBtn = document.getElementById('join-private-btn');
    const privateLobbyCodeInput = document.getElementById('private-lobby-code');
    const joinLobbyBtn = document.getElementById('join-lobby-btn');
    const usernameInput = document.getElementById('username-input');

    // Game Elements
    const playerList = document.getElementById('player-list');
    const startGameBtn = document.getElementById('start-game-btn');
    const lobbyCodeDisplay = document.getElementById('lobby-code-display');
    const promptInput = document.getElementById('prompt-input');
    const submitPromptBtn = document.getElementById('submit-prompt-btn');
    const promptSubmittedMsg = document.getElementById('prompt-submitted-msg');

    // --- View Management ---
    function showView(viewName) {
        for (const key in views) { views[key].classList.add('hidden'); }
        if (views[viewName]) { views[viewName].classList.remove('hidden'); }
    }

    function showGameView(viewName) {
        for (const key in gameViews) { gameViews[key].classList.add('hidden'); }
        if (gameViews[viewName]) { gameViews[viewName].classList.remove('hidden'); }
    }

    // --- UI Updates ---
    function updatePlayerList() {
        playerList.innerHTML = '';
        for (const id in players) {
            const player = players[id];
            const li = document.createElement('li');
            li.textContent = player.username;
            if (id === myPlayerId) {
                li.innerHTML += ' <span class="role">(You)</span>';
                li.style.fontWeight = 'bold';
            }
            if (id === hostPlayerId) {
                li.innerHTML += ' <span class="role">(Host)</span>';
            }
            playerList.appendChild(li);
        }

        // Show/hide start button
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
            alert('Connection lost or rejected. Returning to home screen.');
            showView('home');
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
                showView('game');
                showGameView('waiting');
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
                showGameView('prompting');
                break;

            case 'prompt_accepted':
                promptInput.classList.add('hidden');
                submitPromptBtn.classList.add('hidden');
                promptSubmittedMsg.classList.remove('hidden');
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
    
    submitPromptBtn.addEventListener('click', () => {
        const prompt = promptInput.value.trim();
        if (prompt) {
            ws.send(JSON.stringify({ type: 'submit_prompt', prompt: prompt }));
        }
    });

    // --- Home Screen & Modal Logic ---
    showCreateLobbyBtn.addEventListener('click', () => {
        createLobbyModal.classList.remove('hidden');
    });
    cancelCreateBtn.addEventListener('click', () => {
        createLobbyModal.classList.add('hidden');
    });
    createBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const type = e.target.dataset.type;
            const response = await fetch('/api/lobbies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: type })
            });
            const data = await response.json();
            if (response.ok) {
                currentLobbyId = data.lobbyId;
                createLobbyModal.classList.add('hidden');
                usernameModal.classList.remove('hidden');
            } else {
                alert(`Error: ${data.message}`);
            }
        });
    });
    joinPrivateBtn.addEventListener('click', async () => {
        const code = privateLobbyCodeInput.value.trim();
        if (!code) return alert('Please enter a code.');
        const response = await fetch(`/api/lobbies/${code}`);
        if (response.ok) {
            currentLobbyId = code;
            usernameModal.classList.remove('hidden');
        } else {
            alert('Invalid lobby code.');
        }
    });
    joinLobbyBtn.addEventListener('click', () => {
        const username = usernameInput.value.trim();
        if (!username) return alert('Please enter a username.');
        if (!currentLobbyId) return alert('No lobby selected.');
        usernameModal.classList.add('hidden');
        connectWebSocket(username, currentLobbyId);
    });

    // --- Initial Setup ---
    showView('home');
});
