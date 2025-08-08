document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let ws;
    let myPlayerId = null, hostPlayerId = null, currentLobbyId = null;
    let players = {};
    let clientGameState = 'HOME';
    let currentTask = null;
    let promptSubmitted = false;
    let isDrawing = false, lastX = 0, lastY = 0;
    let roundEndTime = 0, timerInterval;
    let revealData = { albums: [], albumIndex: 0, stepIndex: 0 };

    // --- DOM Elements ---
    const views = { home: document.getElementById('home-screen'), createModal: document.getElementById('create-lobby-modal'), usernameModal: document.getElementById('username-modal'), game: document.getElementById('game-container') };
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

    // --- Dynamic UI ---
    let doneButton = document.getElementById('done-button');
    if (!doneButton) {
        doneButton = document.createElement('button');
        doneButton.id = 'done-button';
        document.getElementById('main-content').appendChild(doneButton);
    }
    let timerDisplay = document.getElementById('timer-display');
    if (!timerDisplay) {
        timerDisplay = document.createElement('div');
        timerDisplay.id = 'timer-display';
        document.getElementById('main-content').appendChild(timerDisplay);
    }
    
    // --- Text-to-Speech ---
    function speak(text) {
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel(); // Cancel any previous speech
            const utterance = new SpeechSynthesisUtterance(text);
            speechSynthesis.speak(utterance);
        }
    }

    // --- Rendering Logic ---
    function setCanvasSize() { const dpr = window.devicePixelRatio || 1; const rect = gameCanvas.getBoundingClientRect(); gameCanvas.width = rect.width * dpr; gameCanvas.height = rect.height * dpr; ctx.scale(dpr, dpr); }
    function renderGameCanvas() { requestAnimationFrame(() => { const w = gameCanvas.clientWidth, h = gameCanvas.clientHeight; if (!w || !h) return; switch (clientGameState) { case 'LOBBY': case 'PROMPTING': ctx.clearRect(0,0,w,h); break; case 'DRAWING': ctx.clearRect(0, 0, w, 150); break; case 'REVEAL': ctx.clearRect(0,0,w,h); break;} switch (clientGameState) { case 'LOBBY': drawLobbyScreen(w, h); break; case 'PROMPTING': drawPromptScreen(w, h); break; case 'DRAWING': drawDrawingScreen(w, h); break; case 'REVEAL': drawRevealScreen(); break;} }); }
    function drawLobbyScreen(w, h) { /* ... same as previous step ... */ }
    function drawPromptScreen(w, h) { /* ... same as previous step ... */ }
    function drawDrawingScreen(w, h) { if (currentTask) wrapText(ctx, currentTask.content, w/2, h*0.05 + 30, w*0.9, 30, 'bold 24px Nunito', '#1a73e8'); }
    function drawRevealScreen() {
        const w = gameCanvas.clientWidth, h = gameCanvas.clientHeight;
        if (!revealData.albums.length) return;
        const album = revealData.albums[revealData.albumIndex];
        const step = album.steps[revealData.stepIndex];
        wrapText(ctx, `Album ${revealData.albumIndex + 1}/${revealData.albums.length} (by ${album.originalAuthorName})`, w/2, 30, w*0.9, 20, '16px Nunito', '#757575');
        wrapText(ctx, `Step ${revealData.stepIndex + 1}/${album.steps.length}`, w/2, 55, w*0.9, 20, '16px Nunito', '#757575');
        if (step.type === 'prompt') {
            wrapText(ctx, step.content, w/2, h/2, w*0.8, 40, 'bold 32px Nunito', '#424242');
        } else if (step.type === 'drawing') {
            const img = new Image();
            img.onload = () => { const ar = img.width/img.height, w_ = w*0.8, h_ = w_/ar; ctx.drawImage(img, w*0.1, (h-h_)/2, w_, h_); };
            img.src = step.content;
        }
    }

    // --- Timer Logic ---
    function startTimer() { if (timerInterval) clearInterval(timerInterval); timerDisplay.classList.remove('hidden'); timerInterval = setInterval(() => { const remaining = Math.round((roundEndTime - Date.now()) / 1000); if (remaining >= 0) timerDisplay.textContent = remaining; else stopTimer(); }, 1000); }
    function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerDisplay.classList.add('hidden'); }

    // --- WebSocket Logic ---
    function handleWebSocketMessage(event) {
        const data = JSON.parse(event.data);
        console.log('Received:', data);
        switch (data.type) {
            case 'initial_state':
                myPlayerId = data.userId; hostPlayerId = data.hostId; players = data.players;
                lobbyCodeDisplay.textContent = currentLobbyId;
                clientGameState = 'LOBBY';
                showView('game');
                requestAnimationFrame(() => { setCanvasSize(); renderGameCanvas(); });
                updatePlayerList();
                break;
            case 'game_started':
                clientGameState = 'PROMPTING';
                gameCanvas.style.cursor = 'text';
                drawingToolbar.classList.add('hidden');
                doneButton.classList.add('hidden');
                renderGameCanvas();
                break;
            case 'new_task':
                currentTask = data.task;
                roundEndTime = data.endTime;
                startTimer();
                doneButton.classList.remove('hidden');
                doneButton.textContent = 'Done';
                if (data.task.type === 'draw') {
                    clientGameState = 'DRAWING';
                    gameCanvas.style.cursor = 'crosshair';
                    drawingToolbar.classList.remove('hidden');
                    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
                    renderGameCanvas();
                } // Future: else if for describing
                break;
            case 'reveal_all':
                clientGameState = 'REVEAL';
                revealData = { albums: data.albums, albumIndex: 0, stepIndex: 0 };
                stopTimer();
                drawingToolbar.classList.add('hidden');
                doneButton.classList.add('hidden');
                gameCanvas.style.cursor = 'pointer';
                renderGameCanvas();
                speak(revealData.albums[0].steps[0].content);
                break;
            // ... Other cases like player_joined, player_left, prompt_accepted are the same
        }
    }
    
    // --- Event Listeners ---
    doneButton.addEventListener('click', () => {
        if (clientGameState === 'DRAWING') {
            const drawingDataUrl = gameCanvas.toDataURL('image/png');
            ws.send(JSON.stringify({ type: 'submit_drawing', drawing: drawingDataUrl }));
            doneButton.textContent = 'Waiting...';
            doneButton.disabled = true;
        }
    });
    
    gameCanvas.addEventListener('mousedown', (e) => {
        if (clientGameState === 'REVEAL') {
            const pos = getMousePos(e);
            if (pos.x > gameCanvas.clientWidth / 2) revealData.stepIndex++;
            else revealData.stepIndex--;
            const album = revealData.albums[revealData.albumIndex];
            if (revealData.stepIndex >= album.steps.length) {
                revealData.albumIndex = (revealData.albumIndex + 1) % revealData.albums.length;
                revealData.stepIndex = 0;
            } else if (revealData.stepIndex < 0) {
                revealData.albumIndex = (revealData.albumIndex - 1 + revealData.albums.length) % revealData.albums.length;
                revealData.stepIndex = revealData.albums[revealData.albumIndex].steps.length - 1;
            }
            renderGameCanvas();
            const newStep = revealData.albums[revealData.albumIndex].steps[revealData.stepIndex];
            if (newStep.type === 'prompt') speak(newStep.content);
        }
        // ... drawing and prompt mousedown logic from previous step ...
    });
    
    // --- All other functions and listeners should be copied from the previous complete step ---
    // This includes: wrapText, drawLobbyScreen, drawPromptScreen, getSubmitButtonRect, showView, updatePlayerList,
    // fetchPublicLobbies, connectWebSocket, all home/modal event listeners, all drawing event listeners, etc.
});
```*(Please ensure you copy the complete, unchanged functions like `wrapText`, `drawLobbyScreen`, `drawPromptScreen`, the modal event listeners, the full WebSocket handler, and the drawing listeners from the previous full response to make this `app.js` file whole.)*
