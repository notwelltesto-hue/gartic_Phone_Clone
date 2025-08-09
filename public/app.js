document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let ws;
    let myPlayerId = null, hostPlayerId = null, currentLobbyId = null;
    let players = {};
    let clientGameState = 'HOME';
    let currentTask = null;
    let currentText = '', textSubmitted = false;
    let isDrawing = false, lastX = 0, lastY = 0;
    let roundEndTime = 0, timerInterval;
    let drawingHistory = [];
    let allAlbums = [];
    let currentAlbumIndex = 0, currentStepIndex = 0;
    let lastBlinkTime = 0, cursorVisible = true;

    // --- DOM Elements ---
    const views = { home: document.getElementById('home-screen'), createModal: document.getElementById('create-lobby-modal'), usernameModal: document.getElementById('username-modal'), game: document.getElementById('game-container') };
    const gameCanvas = document.getElementById('game-canvas'), ctx = gameCanvas.getContext('2d');
    const revealContainer = document.getElementById('reveal-container');
    const drawingToolbar = document.getElementById('drawing-toolbar');
    const colorPicker = document.getElementById('color-picker');
    const brushSize = document.getElementById('brush-size');
    const mainContent = document.getElementById('main-content');
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
    function createDynamicElement(tag, id, parent) { let el = document.getElementById(id); if (!el) { el = document.createElement(tag); el.id = id; parent.appendChild(el); } return el; }
    const doneButton = createDynamicElement('button', 'done-button', mainContent);
    const timerDisplay = createDynamicElement('div', 'timer-display', mainContent);
    
    // --- Reusable Canvas Template for Reveals ---
    const revealCanvasTemplate = document.createElement('canvas');
    revealCanvasTemplate.width = 500;
    revealCanvasTemplate.height = 500;
    const revealCtx = revealCanvasTemplate.getContext('2d');

    // --- Text-to-Speech ---
    function speak(text) { if ('speechSynthesis' in window && text) { speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); speechSynthesis.speak(utterance); } }

    // --- Rendering Logic ---
    function setCanvasSize() { const dpr = window.devicePixelRatio || 1; const rect = gameCanvas.getBoundingClientRect(); gameCanvas.width = rect.width * dpr; gameCanvas.height = rect.height * dpr; ctx.scale(dpr, dpr); }
    function renderGameCanvas() { requestAnimationFrame(() => { const w = gameCanvas.clientWidth, h = gameCanvas.clientHeight; if (!w || !h) return; ctx.clearRect(0, 0, w, h); switch (clientGameState) { case 'LOBBY': drawLobbyScreen(w, h); break; case 'PROMPTING': drawTextScreen(w, h, "Write something weird or funny!"); break; case 'DESCRIBING': drawTextScreen(w, h, "Describe what you see!"); break; case 'DRAWING': drawDrawingScreen(w, h); break; } }); }
    function wrapText(context, text, x, y, maxWidth, lineHeight, font, color, alignment = 'center') { context.font = font; context.fillStyle = color; context.textAlign = alignment; const words = (text || "").split(' '); let line = ''; let currentY = y; for (let n = 0; n < words.length; n++) { const testLine = line + words[n] + ' '; const metrics = context.measureText(testLine); if (metrics.width > maxWidth && n > 0) { context.fillText(line, x, currentY); line = words[n] + ' '; currentY += lineHeight; } else { line = testLine; } } context.fillText(line, x, currentY); }
    function drawLobbyScreen(w, h) { wrapText(ctx, 'Waiting for players...', w/2, h/2 - 20, w*0.8, 40, 'bold 32px Nunito', '#424242'); wrapText(ctx, 'The host will start the game.', w/2, h/2 + 30, w*0.8, 24, '20px Nunito', '#757575'); }
    function drawTextScreen(w, h, title) {
        wrapText(ctx, title, w/2, h*0.1, w*0.9, 36, 'bold 28px Nunito', '#424242');
        if (clientGameState === 'DESCRIBING' && currentTask?.content) { (currentTask.content || []).forEach(cmd => { if (cmd.type === 'beginPath') drawLine(cmd.x-0.01, cmd.y, cmd.x, cmd.y, cmd.color, cmd.size); else if (cmd.type === 'draw') drawLine(cmd.x0, cmd.y0, cmd.x1, cmd.y1, cmd.color, cmd.size); }); }
        const inputBoxY = h * 0.7, inputBoxHeight = 60;
        ctx.strokeStyle = '#bdbdbd'; ctx.lineWidth = 2; ctx.strokeRect(w*0.1, inputBoxY, w*0.8, inputBoxHeight);
        ctx.font = '24px Nunito'; ctx.fillStyle = '#212121'; ctx.textAlign = 'left';
        if (Date.now() - lastBlinkTime > 500) { cursorVisible = !cursorVisible; lastBlinkTime = Date.now(); }
        const cursor = (cursorVisible && !textSubmitted) ? '|' : '';
        ctx.fillText(currentText + cursor, w * 0.1 + 15, inputBoxY + inputBoxHeight / 2 + 8);
        const buttonY = inputBoxY + inputBoxHeight + 20;
        if (!textSubmitted) {
            const btn = getSubmitButtonRect(w, h, buttonY);
            ctx.fillStyle = currentText ? '#34a853' : '#a5d6a7';
            ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
            wrapText(ctx, 'Submit (Enter)', w/2, btn.y+35, btn.w, 30, 'bold 24px Nunito', '#ffffff');
        } else {
            wrapText(ctx, "Submitted! Waiting for others...", w/2, h/2, w*0.8, 30, 'bold 24px Nunito', '#757575');
        }
    }
    function drawDrawingScreen(w, h) { if (currentTask) { wrapText(ctx, 'Your task to draw:', w/2, h*0.05, w*0.9, 22, '18px Nunito', '#424242'); wrapText(ctx, currentTask.content, w/2, h*0.05 + 30, w*0.9, 30, 'bold 24px Nunito', '#1a73e8'); } }
    function drawLine(x0, y0, x1, y1, color, width) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke(); }
    function getSubmitButtonRect(w, h, y) { const btnW = w * 0.5, btnH = 55; return { x: (w - btnW)/2, y: y, w: btnW, h: btnH }; }

    // --- Timer Logic ---
    function startTimer() { if (timerInterval) clearInterval(timerInterval); timerDisplay.classList.remove('hidden'); timerInterval = setInterval(() => { const remaining = Math.round((roundEndTime - Date.now())/1000); if (remaining >= 0) timerDisplay.textContent = remaining; else { stopTimer(); doneButton.classList.add('hidden'); } }, 1000); }
    function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerDisplay.classList.add('hidden'); }

    // --- Reveal UI Logic ---
    function showCurrentRevealStep() {
        if (!allAlbums.length) return;
        const album = allAlbums[currentAlbumIndex];
        const step = album.steps[currentStepIndex];

        const stepDiv = document.createElement('div');
        stepDiv.classList.add('reveal-step');
        
        const authorDiv = document.createElement('div');
        authorDiv.classList.add('reveal-author');
        authorDiv.textContent = `${step.author} ${step.type === 'prompt' ? 'wrote' : 'drew'}:`;
        stepDiv.appendChild(authorDiv);
        
        if (step.type === 'prompt') {
            stepDiv.classList.add('reveal-prompt');
            const text = document.createElement('p');
            text.textContent = step.content;
            stepDiv.appendChild(text);
            speak(step.content);
        } else if (step.type === 'drawing') {
            stepDiv.classList.add('reveal-drawing');
            const img = document.createElement('img');
            img.classList.add('reveal-drawing-img');
            
            revealCtx.clearRect(0, 0, revealCanvasTemplate.width, revealCanvasTemplate.height);
            (step.content || []).forEach(cmd => {
                const tempCtx = revealCtx; // Use the single template context
                if (cmd.type === 'beginPath') { tempCtx.beginPath(); tempCtx.moveTo(cmd.x, cmd.y); tempCtx.lineTo(cmd.x, cmd.y); tempCtx.strokeStyle = cmd.color; tempCtx.lineWidth = cmd.size; tempCtx.lineCap = 'round'; tempCtx.stroke(); }
                else if (cmd.type === 'draw') { tempCtx.beginPath(); tempCtx.moveTo(cmd.x0, cmd.y0); tempCtx.lineTo(cmd.x1, cmd.y1); tempCtx.strokeStyle = cmd.color; tempCtx.lineWidth = cmd.size; tempCtx.lineCap = 'round'; tempCtx.stroke(); }
            });
            img.src = revealCanvasTemplate.toDataURL();
            stepDiv.appendChild(img);
        }
        revealContainer.appendChild(stepDiv);
        stepDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    // --- WebSocket Logic ---
    function handleWebSocketMessage(event) {
        const data = JSON.parse(event.data);
        console.log('Received:', data);
        switch (data.type) {
            case 'initial_state':
                myPlayerId = data.userId; hostPlayerId = data.hostId; players = data.players;
                currentLobbyId = new URL(ws.url).pathname.split('/').pop();
                lobbyCodeDisplay.textContent = currentLobbyId;
                clientGameState = 'LOBBY';
                showView('game');
                gameCanvas.classList.remove('hidden');
                revealContainer.classList.add('hidden');
                requestAnimationFrame(() => { setCanvasSize(); renderGameCanvas(); });
                updatePlayerList();
                break;
            case 'game_started':
                clientGameState = 'PROMPTING'; textSubmitted = false; currentText = '';
                gameCanvas.style.cursor = 'text';
                drawingToolbar.classList.add('hidden');
                doneButton.classList.add('hidden');
                revealContainer.classList.add('hidden');
                gameCanvas.classList.remove('hidden');
                renderGameCanvas();
                break;
            case 'prompt_accepted':
                textSubmitted = true;
                renderGameCanvas();
                break;
            case 'new_task':
                currentTask = data.task;
                roundEndTime = data.endTime;
                startTimer();
                doneButton.classList.remove('hidden'); doneButton.textContent = 'Done'; doneButton.disabled = false;
                textSubmitted = false; currentText = ''; drawingHistory = [];
                ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
                if (data.task.type === 'draw') {
                    clientGameState = 'DRAWING';
                    gameCanvas.style.cursor = 'crosshair';
                    drawingToolbar.classList.remove('hidden');
                } else if (data.task.type === 'describe') {
                    clientGameState = 'DESCRIBING';
                    gameCanvas.style.cursor = 'default';
                    drawingToolbar.classList.add('hidden');
                }
                renderGameCanvas();
                break;
            case 'reveal_all':
                clientGameState = 'REVEAL';
                allAlbums = data.albums;
                stopTimer();
                drawingToolbar.classList.add('hidden');
                doneButton.classList.add('hidden');
                gameCanvas.classList.add('hidden');
                revealContainer.classList.remove('hidden');
                revealContainer.innerHTML = '';
                break;
            case 'update_reveal_step':
                currentAlbumIndex = data.albumIndex;
                currentStepIndex = data.stepIndex;
                showCurrentRevealStep();
                break;
            case 'game_over':
                clientGameState = 'LOBBY';
                const gameOverDiv = document.createElement('div');
                gameOverDiv.innerHTML = `<h3>That's all, folks!</h3><p>The host can start a new game.</p>`;
                gameOverDiv.classList.add('reveal-step', 'reveal-prompt');
                revealContainer.appendChild(gameOverDiv);
                gameOverDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
                if (myPlayerId === hostPlayerId) {
                    startGameBtn.textContent = "Play Again";
                    startGameBtn.classList.remove('hidden');
                }
                break;
            case 'player_joined': players[data.player.id] = { username: data.player.username }; updatePlayerList(); break;
            case 'player_left': delete players[data.userId]; hostPlayerId = data.newHostId; updatePlayerList(); break;
            case 'error': alert(`Server error: ${data.message}`); break;
        }
    }
    function connectWebSocket(username, lobbyId) { const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'; ws = new WebSocket(`${proto}//${window.location.host}/draw/${lobbyId}`); ws.onopen = () => ws.send(JSON.stringify({ type: 'join', username })); ws.onmessage = handleWebSocketMessage; ws.onclose = () => { alert('Connection lost.'); window.location.reload(); }; }
    
    // --- Event Listeners & Game Flow ---
    function getMousePos(e) { const rect = gameCanvas.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }
    
    startGameBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'start_game' })));
    doneButton.addEventListener('click', () => {
        if (clientGameState === 'DRAWING') ws.send(JSON.stringify({ type: 'submit_drawing', drawingCommands: drawingHistory }));
        else if (clientGameState === 'DESCRIBING') ws.send(JSON.stringify({ type: 'submit_description', description: currentText }));
        doneButton.textContent = 'Waiting...';
        doneButton.disabled = true;
    });
    
    gameCanvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        if (clientGameState === 'DRAWING') {
            isDrawing = true;
            [lastX, lastY] = [pos.x, pos.y];
            const data = { type: 'beginPath', x: pos.x, y: pos.y, color: colorPicker.value, size: brushSize.value };
            drawingHistory.push(data);
            drawLine(pos.x - 0.01, pos.y, pos.x, pos.y, data.color, data.size);
        } else if ((clientGameState === 'PROMPTING' || clientGameState === 'DESCRIBING') && !textSubmitted && currentText) {
            const rect = gameCanvas.getBoundingClientRect(), w = rect.width, h = rect.height;
            const btnY = h * 0.7 + 60 + 20;
            const btn = getSubmitButtonRect(w, h, btnY);
            if (pos.x > btn.x && pos.x < btn.x + btn.w && pos.y > btn.y && pos.y < btn.y + btn.h) {
                if(clientGameState === 'PROMPTING') ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentText }));
                else if (clientGameState === 'DESCRIBING') ws.send(JSON.stringify({ type: 'submit_description', description: currentText }));
            }
        }
    });

    revealContainer.addEventListener('click', () => {
        if (clientGameState === 'REVEAL' && myPlayerId === hostPlayerId) {
            ws.send(JSON.stringify({ type: 'next_reveal_step' }));
        }
    });

    gameCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || clientGameState !== 'DRAWING') return;
        const pos = getMousePos(e);
        const data = { type: 'draw', x0: lastX, y0: lastY, x1: pos.x, y1: pos.y, color: colorPicker.value, size: brushSize.value };
        drawingHistory.push(data);
        drawLine(lastX, lastY, pos.x, pos.y, data.color, data.size);
        [lastX, lastY] = [pos.x, pos.y];
    });
    gameCanvas.addEventListener('mouseup', () => { isDrawing = false; });
    gameCanvas.addEventListener('mouseout', () => { isDrawing = false; });
    window.addEventListener('keydown', (e) => {
        if ((clientGameState !== 'PROMPTING' && clientGameState !== 'DESCRIBING') || textSubmitted) return;
        e.preventDefault();
        if (e.key === 'Backspace') currentText = currentText.slice(0, -1);
        else if (e.key === 'Enter') {
            if (currentText) {
                if(clientGameState === 'PROMPTING') ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentText }));
                else if (clientGameState === 'DESCRIBING') ws.send(JSON.stringify({ type: 'submit_description', description: currentText }));
            }
        }
        else if (e.key.length === 1 && currentText.length < 100) currentText += e.key;
        renderGameCanvas();
    });
    window.addEventListener('resize', () => { if (clientGameState !== 'HOME') { requestAnimationFrame(() => { setCanvasSize(); renderGameCanvas(); }); } });
    setInterval(() => { if ((clientGameState === 'PROMPTING' || clientGameState === 'DESCRIBING') && !textSubmitted) renderGameCanvas() }, 500);

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
