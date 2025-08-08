document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let ws;
    let myPlayerId = null;
    let hostPlayerId = null;
    let players = {};
    let currentLobbyId = null;
    let clientGameState = 'HOME'; // HOME | LOBBY | PROMPTING | DRAWING
    let currentPromptText = '';

    // --- DOM Elements ---
    const views = { /* ... home/modal views ... */ };
    const gameCanvas = document.getElementById('game-canvas');
    const ctx = gameCanvas.getContext('2d');
    // ... other DOM elements from previous step ...

    // --- Canvas UI Rendering ---
    function setCanvasSize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = gameCanvas.parentElement.getBoundingClientRect();
        // Set a max size for aesthetics
        const size = Math.min(rect.width - 40, rect.height - 40, 900);
        gameCanvas.width = size * dpr;
        gameCanvas.height = size * dpr;
        ctx.scale(dpr, dpr);
        gameCanvas.style.width = `${size}px`;
        gameCanvas.style.height = `${size}px`;
    }

    function renderGameCanvas() {
        ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
        switch (clientGameState) {
            case 'LOBBY':
                drawLobbyScreen();
                break;
            case 'PROMPTING':
                drawPromptScreen();
                break;
            case 'DRAWING':
                // For now, just a placeholder
                drawDrawingScreen("Placeholder: You need to draw something!");
                break;
        }
    }
    
    function drawLobbyScreen() {
        ctx.fillStyle = '#424242';
        ctx.font = 'bold 32px Nunito';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for players...', gameCanvas.width / 4, gameCanvas.height / 4); // Adjusted for DPR
    }

    // NEW: Canvas-based prompt UI
    function drawPromptScreen() {
        const w = gameCanvas.width / window.devicePixelRatio;
        const h = gameCanvas.height / window.devicePixelRatio;

        // Instructions
        ctx.fillStyle = '#424242';
        ctx.font = 'bold 28px Nunito';
        ctx.textAlign = 'center';
        ctx.fillText('Write a weird or funny prompt!', w / 2, h * 0.2);

        // Text input box
        ctx.strokeStyle = '#bdbdbd';
        ctx.lineWidth = 2;
        ctx.strokeRect(w * 0.1, h * 0.4, w * 0.8, 50);
        
        // The text being typed
        ctx.fillStyle = '#212121';
        ctx.font = '24px Nunito';
        ctx.textAlign = 'left';
        ctx.fillText(currentPromptText, w * 0.1 + 10, h * 0.4 + 35);

        // Submit button
        const btn = getSubmitButtonRect();
        ctx.fillStyle = '#34a853';
        ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 24px Nunito';
        ctx.textAlign = 'center';
        ctx.fillText('Submit', w / 2, btn.y + 35);
    }
    
    function drawDrawingScreen(prompt) {
        // This is where the actual drawing UI will go
        // For now, it just shows the task
        const w = gameCanvas.width / window.devicePixelRatio;
        const h = gameCanvas.height / window.devicePixelRatio;
        ctx.fillStyle = '#424242';
        ctx.font = '18px Nunito';
        ctx.textAlign = 'center';
        ctx.fillText('Your task:', w/2, h * 0.1);
        ctx.font = 'bold 24px Nunito';
        ctx.fillText(prompt, w/2, h * 0.1 + 35);
    }

    function getSubmitButtonRect() {
        const w = gameCanvas.width / window.devicePixelRatio;
        const h = gameCanvas.height / window.devicePixelRatio;
        return { x: w * 0.3, y: h * 0.6, w: w * 0.4, h: 50 };
    }


    // --- WebSocket Logic ---
    function handleWebSocketMessage(event) {
        const data = JSON.parse(event.data);
        console.log('Received:', data);

        switch (data.type) {
            case 'initial_state':
                // ... same as before ...
                clientGameState = 'LOBBY';
                renderGameCanvas();
                break;
            // ... player_joined, player_left ...
            case 'game_started':
                clientGameState = 'PROMPTING';
                renderGameCanvas();
                break;
            case 'prompt_accepted':
                // Clear the prompt text and re-render with a "waiting" message
                currentPromptText = "Submitted! Waiting for others...";
                renderGameCanvas(); // Re-render to show feedback
                break;
            case 'new_task':
                if (data.task.type === 'draw') {
                    clientGameState = 'DRAWING';
                    // Clear the old canvas drawing logic and just show the task
                    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
                    drawDrawingScreen(data.task.content);
                }
                break;
            // ... error handling ...
        }
    }

    // --- Event Listeners for Canvas UI ---
    window.addEventListener('keydown', (e) => {
        if (clientGameState !== 'PROMPTING') return;
        
        if (e.key === 'Backspace') {
            currentPromptText = currentPromptText.slice(0, -1);
        } else if (e.key.length === 1 && currentPromptText.length < 100) { // Allow any single character
            currentPromptText += e.key;
        }
        renderGameCanvas(); // Re-draw the canvas with the new text
    });

    gameCanvas.addEventListener('mousedown', (e) => {
        if (clientGameState !== 'PROMPTING') return;

        const rect = gameCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const btn = getSubmitButtonRect();

        if (mouseX > btn.x && mouseX < btn.x + btn.w && mouseY > btn.y && mouseY < btn.y + btn.h) {
            if (currentPromptText) {
                ws.send(JSON.stringify({ type: 'submit_prompt', prompt: currentPromptText }));
            }
        }
    });

    // --- Setup and other listeners ---
    window.addEventListener('resize', () => {
        setCanvasSize();
        renderGameCanvas();
    });

    // All the code for showing modals and joining lobbies remains the same
    // Just make sure that when the game starts, it calls these two functions:
    // showView('game');
    // setCanvasSize(); // Call this to set up the canvas dimensions correctly

    // The rest of your app.js (modal logic, etc.) should be copied from the previous complete step.
    // Ensure the final call in your joinLobbyBtn listener is:
    // connectWebSocket(username, currentLobbyId);
    // showView('game');
    // setCanvasSize();
    // renderGameCanvas();
});

// NOTE: You will need to copy the FULL content of the `app.js` file from the previous "complete code" response,
// and then replace the functions/listeners with the new versions provided above.
// Specifically, update `renderGameCanvas`, `handleWebSocketMessage`, and add the new `keydown` and `mousedown` listeners for the canvas.
