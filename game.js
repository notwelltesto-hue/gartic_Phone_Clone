document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const loginScreen = document.getElementById('login-screen');
    const gameScreen = document.getElementById('game-screen');
    const nameInput = document.getElementById('name-input');
    const joinButton = document.getElementById('join-button');
    const playerList = document.getElementById('player-list');
    const currentDrawerEl = document.getElementById('current-drawer');
    const canvas = document.getElementById('drawing-canvas');
    const canvasOverlay = document.getElementById('canvas-overlay');
    const nextTurnButton = document.getElementById('next-turn-button');
    const ctx = canvas.getContext('2d');

    // --- Game State (Simulated Server) ---
    let players = [];
    let currentPlayer = null;
    let myName = '';
    let currentTurnIndex = 0;
    let isMyTurn = false;
    let isDrawing = false;

    // --- Canvas Setup ---
    function resizeCanvas() {
        canvas.width = 800;
        canvas.height = 600;
        // Set default drawing styles
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
    }
    resizeCanvas();

    // --- Game Logic Functions ---
    function showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    }

    function updatePlayerList() {
        playerList.innerHTML = ''; // Clear list
        players.forEach(player => {
            const li = document.createElement('li');
            li.textContent = player;
            if (player === players[currentTurnIndex]) {
                li.classList.add('is-drawing');
            }
            playerList.appendChild(li);
        });
    }

    function startTurn() {
        if (players.length === 0) return;
        
        currentTurnIndex = currentTurnIndex % players.length;
        const drawerName = players[currentTurnIndex];
        currentDrawerEl.textContent = drawerName;

        isMyTurn = (drawerName === myName);

        if (isMyTurn) {
            canvasOverlay.classList.add('hidden');
            console.log("It's your turn to draw!");
        } else {
            canvasOverlay.classList.remove('hidden');
            console.log(`It's ${drawerName}'s turn to draw.`);
        }
        updatePlayerList();
    }
    
    function nextTurn() {
        currentTurnIndex++;
        // Clear canvas for the next person
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        startTurn();
    }

    // --- Event Listeners ---
    joinButton.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (name) {
            myName = name;
            // Simulate joining a lobby
            players.push(myName); 
            // Add some fake players for testing
            if (players.length === 1) {
                players.push('Bot Alice', 'Bot Bob');
            }
            
            showScreen('game-screen');
            updatePlayerList();
            startTurn(); // Start the first turn
        }
    });

    nextTurnButton.addEventListener('click', nextTurn);

    // --- Canvas Drawing Logic ---
    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
    
    function startDrawing(e) {
        if (!isMyTurn) return;
        isDrawing = true;
        const pos = getMousePos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    }
    
    function draw(e) {
        if (!isDrawing || !isMyTurn) return;
        const pos = getMousePos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    }
    
    function stopDrawing() {
        isDrawing = false;
        ctx.beginPath(); // End the current path
    }

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing); // Stop if mouse leaves canvas
});
