document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let ws;
    let myPlayerId = null, hostPlayerId = null, currentLobbyId = null;
    let players = {};
    let clientGameState = 'HOME';
    let currentTask = null;
    let currentPromptText = '';
    let promptSubmitted = false;
    let isDrawing = false, lastX = 0, lastY = 0;
    let roundEndTime = 0, timerInterval;
    let revealData = { albums: [], albumIndex: 0, stepIndex: 0 };
    let lastBlinkTime = 0, cursorVisible = true;

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

    // --- Dynamic UI Creation ---
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
            speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            speechSynthesis.speak(utterance);
        }
    }

    // --- Rendering Logic ---
    function setCanvasSize() { const dpr = window.devicePixelRatio || 1; const rect = gameCanvas.getBoundingClientRect(); gameCanvas.width = rect.width * dpr; gameCanvas.height = rect.height * dpr; ctx.scale(dpr, dpr); }
    function renderGameCanvas() { requestAnimationFrame(() => { const w = gameCanvas.clientWidth, h = gameCanvas.clientHeight; if (!w || !h) return; switch (clientGameState) { case 'LOBBY': case 'PROMPTING': case 'REVEAL': ctx.clearRect(0,0,gameCanvas.width,gameCanvas.height); break; case 'DRAWING': ctx.clearRect(0, 0, gameCanvas.width, 150); break;} switch (clientGameState) { case 'LOBBY': drawLobbyScreen(w, h); break; case 'PROMPTING': drawPromptScreen(w, h); break; case 'DRAWING': drawDrawingScreen(w, h); break; case 'REVEAL': drawRevealScreen(); break;} }); }
    function drawLobbyScreen(w, h) { wrapText(ctx, 'Waiting for players...', w/2, h/2 - 20, w*0.8, 40, 'bold 32px Nunito', '#424242'); wrapText(ctx, 'The host will start the game.', w/2, h/2 + 30, w*0.8, 24, '20px Nunito', '#757575'); }
    function drawPromptScreen(w, h) {
        wrapText(ctx, 'Write something weird or funny!', w/2, h*0.15, w*0.9, 36, 'bold 28px Nunito', '#424242');
        const inputBoxY = h * 0.35, inputBoxHeight = 60;
        ctx.strokeStyle = '#bdbdbd'; ctx.lineWidth = 2;
        ctx.strokeRect(w*0.1, inputBoxY, w*0.8, inputBoxHeight);
        ctx.font = '24px Nunito'; ctx.fillStyle = '#212121'; ctx.textAlign = 'left';
        if (Date.now() - lastBlinkTime > 500) { cursorVisible = !cursorVisible; lastBlinkTime = Date.now(); }
        const cursor = (cursorVisible && !promptSubmitted) ? '|' : '';
        ctx.fillText(currentPromptText + cursor, w * 0.1 + 15, inputBoxY + inputBoxHeight / 2 + 8);
        const buttonY = inputBoxY + inputBoxHeight + 30;
        if (!promptSubmitted) {
            const btn = getSubmitButtonRect(w, h, buttonY);
            ctx.fillStyle = currentPromptText ? '#34a853' : '#a5d6a7';
            ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
            wrapText(ctx, 'Submit (Enter)', w/2, btn.y+35, btn.w, 30, 'bold 24px Nunito', '#ffffff');
        } else {
            wrapText(ctx, "Submitted! Waiting for others...", w/2, buttonY + 25, w*0.8, 30, 'bold 24px Nunito', '#757575');
        }
    }
    function drawDrawingScreen(w, h) { if (currentTask) { wrapText(ctx, 'Your task to draw:', w/2, h*0.05, w*0.9, 22, '18px Nunito', '#424242'); wrapText(ctx, currentTask.content, w/2, h*0.05 + 30, w*0.9, 30, 'bold 24px Nunito', '#1a73e8'); } }
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
            img.onload = () => { const ar = img.width/img.height; let w_ = w*0.8, h_ = w_/ar; if (h_ > h*0.8) {h_ = h*0.8; w_ = h_*ar;} ctx.drawImage(img, (w-w_)/2, (h-h_)/2, w_, h_); };
            img.src = step.content;
        }
    }
    function drawLine(x0, y0, x1, y1, color, width) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke(); }
    function getSubmitButtonRect(w, h, y) { const btnW = w * 0.5, btnH = 55; return { x: (w - btnW)/2, y: y, w: btnW, h: btnH }; }

    // --- Timer Logic ---
    function startTimer() { if (timerInterval) clearInterval(timerInterval); timerDisplay.classList.remove('hidden'); timerInterval = setInterval(() => { const remaining = Math.round((roundEndTime - Date.now())/1000); if (remaining >= 0) timerDisplay.textContent = remaining; else stopTimer(); }, 1000); }
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
            case 'player_joined': players[data.player.id] = { username: data.player.username }; updatePlayerList(); break;
            case 'player_left': delete players[data.userId]; hostPlayerId = data.newHostId; updatePlayerList(); break;
            case 'game_started':
                clientGameState = 'PROMPTING';
                promptSubmitted = false; currentPromptText = '';
                gameCanvas.style.cursor = 'text';
                drawingToolbar.classList.add('hidden');
                doneButton.classList.add('hidden');
                renderGameCanvas();
                break;
            case 'prompt_accepted': promptSubmitted = true; renderGameCanvas(); break;
            case 'new_task':
                currentTask = data.task;
                roundEndTime = data.endTime;
                startTimer();
                doneButton.classList.remove('hidden');
                doneButton.textContent = 'Done';
                doneButton.disabled = false;
                if (data.task.type === 'draw') {
                    clientGameState = 'DRAWING';
                    gameCanvas.style.cursor = 'crosshair';
                    drawingToolbar.classList.remove('hidden');
                    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
                    renderGameCanvas();
                }
                break;
            case 'reveal_all':
                clientGameState = 'REVEAL';
                revealData = { albums: data.albums, albumIndex: 0, stepIndex: 0 };
                stopTimer();
                drawingToolbar.classList.add('hidden');
                doneButton.classList.add('hidden');
                gameCanvas.style.cursor = 'pointer';
                renderGameCanvas();
                if(revealData.albums.length > 0) speak(revealData.albums[0].steps[0].content);
                break;
            case 'beginPath': drawLine(data.x - 0.01, data.y, data.x, data.y, data.color, data.size); break;
            case 'draw': drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size); break;
            case 'error': alert(`Server error: ${data.message}`); break;
        }
    }
    function connectWebSocket(username, lobbyId) { currentLobbyId = lobbyId; const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'; ws = new WebSocket(`${proto}//${window.location.host}/draw/${lobbyId}`); ws.onopen = () => ws.send(JSON.stringify({ type: 'join', username })); ws.onmessage = handleWebSocketMessage; ws.onclose = () => { alert('Connection lost.'); window.location.reload(); }; }
    
    // --- Event Listeners ---
    function getMousePos(e) { const rect = gameCanvas.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }
    
    startGameBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'start_game' })));
    doneButton.addEventListener('click', () => {
        if (clientGameState === 'DRAWING') {
            const drawingDataUrl = gameCanvas.toDataURL('image/png');
            ws.send(JSON.stringify({ type: 'submit_drawing', drawing: drawingDataUrl }));
            doneButton.textContent = 'Waiting...';
            doneButton.disabled = true;
        }
    });
    
    gameCanvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        if (clientGameState === 'DRAWING') {
            isDrawing = true;
            [lastX, lastY] = [pos.x, pos.y];
            const data = { type: 'beginPath', x: pos.x, y: pos.y, color: colorPicker.value, size: brushSize.value };
            ws.send(JSON.stringify(data));
            drawLine(pos.x - 0.01, pos.y, pos.x, pos.y, data.color, data.size);
        } else if (clientGameState === 'PROMPTING' && !promptSubmitted && currentPromptText) {
            const rect = gameCanvas.getBoundingClientRect(), w = rect.width, h = rect.height;
            const btn = getSubmitButtonRect(w, h, h * 0.35 + 60 + 30);
            if (pos.x > btn.x && pos.x < btn.x + btn.w && pos.y > btn.y && pos.y < btn.y + btn.h) ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentPromptText }));
        } else if (clientGameState === 'REVEAL') {
            if (pos.x > gameCanvas.clientWidth / 2) revealData.stepIndex++; else revealData.stepIndex--;
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
        if (e.key === 'Backspace') currentPromptText = currentPromptText.slice(0, -1);
        else if (e.key === 'Enter') { if (currentPromptText) ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentPromptText })); }
        else if (e.key.length === 1 && currentPromptText.length < 100) currentPromptText += e.key;
        renderGameCanvas();
    });

    window.addEventListener('resize', () => { if (clientGameState !== 'HOME') { requestAnimationFrame(() => { setCanvasSize(); renderGameCanvas(); }); } });
    setInterval(() => { if (clientGameState === 'PROMPTING' && !promptSubmitted) renderGameCanvas() }, 500);

    // --- Home Screen & Modal Logic ---
    function showView(viewName) { for (const key in views) views[key].classList.add('hidden'); if(views[viewName]) views[viewName].classList.remove('hidden'); }
    function updatePlayerList() { playerList.innerHTML = ''; for (const id in players) { const p = players[id]; const li = document.createElement('li'); li.textContent = p.username; if (id === myPlayerId) li.innerHTML += ' <span class="role">(You)</span>'; if (id === hostPlayerId) li.innerHTML += ' <span class="role">(Host)</span>'; playerList.appendChild(li); } if (myPlayerId === hostPlayerId) { startGameBtn.classList.remove('hidden'); startGameBtn.disabled = Object.keys(players).length < 2; } else { startGameBtn.classList.add('hidden'); } }
    async function fetchPublicLobbies() { try { const res = await fetch('/api/lobbies'); const lobs = await res.json(); publicLobbyList.innerHTML = ''; if (lobs.length === 0) publicLobbyList.innerHTML = '<li>No public lobbies found.</li>'; else lobs.forEach(l => { const li = document.createElement('li'); li.textContent = `Lobby ${l.id} (${l.userCount} users)`; li.dataset.lobbyId = l.id; publicLobbyList.appendChild(li); }); } catch (err) { console.error('Failed to fetch lobbies:', err); publicLobbyList.innerHTML = '<li>Error loading lobbies.</li>'; } }
    showCreateLobbyBtn.addEventListener('click', () => createLobbyModal.classList.remove('hidden'));
    cancelCreateBtn.addEventListener('click', () => createLobbyModal.classList.add('hidden'));
    refreshLobbiesBtn.addEventListener('click', fetchPublicLobbies);
    createBtns.forEach(btn => btn.addEventListener('click', async (e) => { const type = e.target.dataset.type; const res = await fetch('/api/lobbies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) }); const data = await res.json(); if (res.ok) { currentLobbyId = data.lobbyId; createLobbyModal.classList.add('hidden'); usernameModal.classList.remove('hidden'); } else { alert(`Error: ${data.message}`); } }));
    joinPrivateBtn.addEventListener('click', async () => { const code = privateLobbyCodeInput.value.trim(); if (!code) return alert('Please enter a code.'); const res = await fetch(`/api/lobbies/${code}`); if (res.ok) { currentLobbyId = code; usernameModal.classList.remove('hidden'); } else { alert('Invalid lobby code.'); } });
    joinLobbyBtn.addEventListener('click', () => { const username = usernameInput.value.trim(); if (!username) return alert('Please enter a username.'); if (!currentLobbyId) return alert('No lobby selected.'); usernameModal.classList.add('hidden'); connectWebSocket(username, currentLobbyId); });
    publicLobbyList.addEventListener('click', (e) => { if (e.target.tagName === 'LI' && e.target.dataset.lobbyId) { currentLobbyId = e.target.dataset.lobbyId; usernameModal.classList.remove('hidden'); } });

    // --- Initial Setup ---
    showView('home');
    fetchPublicLobbies();
});
