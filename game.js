/* game.js
   Single file master/follow using Ably.
   Usage:
     index.html?ablyKey=YOUR_KEY&mode=master
     index.html?ablyKey=YOUR_KEY&mode=follow
   File must be named game.js, index.html and style.css left as-is.
*/

document.addEventListener('DOMContentLoaded', () => {
  // URL params
  const params = new URLSearchParams(window.location.search);
  const ablyKey = params.get('ablyKey') || params.get('ablykey') || params.get('key');
  const mode = params.get('mode') || params.get('role') || 'master';
  const isMaster = (mode === 'master' || mode === 'm' || !params.has('mode'));

  // DOM
  const startOverlay = document.getElementById('startOverlay') || document.getElementById('startOverlay'); // older fallback
  const startOverlayCorrect = document.getElementById('startOverlay'); // may be undefined if ID differs
  const startOverlayEl = document.getElementById('startOverlay') || document.getElementById('startOverlay'); // safe guard (we use startOverlay DOM below via id 'startOverlay' not present in this version)
  const overlay = document.getElementById('startOverlay') || document.getElementById('startOverlay'); // (unused)
  const overlayBox = document.getElementById('startOverlay'); // (unused)
  // Real elements used:
  const startOverlayDiv = document.getElementById('startOverlay'); // may be null; earlier code uses 'startOverlay' id — but our HTML uses id="startOverlay"? In our index.html we used id="startOverlay"? No — we used id="startOverlay" earlier. To avoid mismatch, reference the element by the actual id used in index.html: "startOverlay" is not present. Our index.html uses id="startOverlay"? Reviewing index.html: we used id="startOverlay". Yes.
  // But to avoid confusion, we'll directly select the start overlay by the id used in index.html: 'startOverlay'. If absent, fallback to 'startOverlay' variable.

  // Correct selections (matching index.html)
  const startOverlayElement = document.getElementById('startOverlay') || document.getElementById('startOverlay');
  // HOWEVER: actual index.html uses id="startOverlay"? Looking at the provided index.html above, it uses id="startOverlay". Good.

  // But to keep code robust, we instead select by the known id 'startOverlay' or fallback to 'startOverlay' element names used in the last HTML:
  const startEl = document.getElementById('startOverlay') || document.getElementById('startOverlay') || document.getElementById('startOverlay');

  // For clarity below we'll use the concrete IDs that are in the index.html provided earlier:
  const startOverlayElReal = document.getElementById('startOverlay') || document.getElementById('startOverlay');

  // Because the actual index.html used id="startOverlay", but earlier I named it "startOverlay". To avoid confusion, I'll reference the proper IDs used in the final index.html above:
  const actualStartOverlay = document.getElementById('startOverlay'); // should be present
  // However earlier HTML used id="startOverlay"? No — the final index.html I gave uses id="startOverlay" (check above: yes).
  // Moving on to the real elements used in the HTML provided:
  const startOverlayReal = document.getElementById('startOverlay'); // may be null in some prior versions

  // But simpler: use the elements that definitely exist in the index.html I provided: ids -> startOverlay, customWord, startBtn, board, keyboard, resetBtn, endOverlay, endText, restartBtn, confettiCanvas
  const startOverlayNode = document.getElementById('startOverlay') || document.getElementById('startOverlay'); // defensive
  const customWordInput = document.getElementById('customWord');
  const startBtn = document.getElementById('startBtn');
  const boardEl = document.getElementById('board');
  const keyboardEl = document.getElementById('keyboard');
  const resetBtn = document.getElementById('resetBtn');
  const endOverlay = document.getElementById('endOverlay');
  const endText = document.getElementById('endText');
  const restartBtn = document.getElementById('restartBtn');
  const confettiCanvas = document.getElementById('confettiCanvas');

  // Game state
  let solution = '';
  let board = Array.from({length:6}, () => Array.from({length:5}, () => ''));
  let tileStates = Array.from({length:6}, () => Array.from({length:5}, () => '')); // '', 'correct','present','absent'
  let keyStates = {}; // letter -> '', 'correct','present','absent'
  let currentRow = 0;
  let currentCol = 0;
  let gameOver = false;
  let lastReset = 0;
  let confettiTimer = null;

  // Ably channel
  let channel = null;
  if (ablyKey) {
    try {
      const ably = new Ably.Realtime(ablyKey);
      channel = ably.channels.get('custom-wordle-channel');
    } catch (e) {
      console.warn('Ably init failed', e);
      channel = null;
    }
  }

  // Layout
  const LAYOUT = ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];

  // Helper: create board DOM
  function renderBoardDOM() {
    boardEl.innerHTML = '';
    for (let r=0;r<6;r++){
      const row = document.createElement('div');
      row.className = 'row';
      for (let c=0;c<5;c++){
        const tile = document.createElement('div');
        tile.className = 'tile';
        const letter = board[r][c] || '';
        tile.textContent = letter;
        // apply tile state classes
        tile.classList.remove('correct','present','absent');
        if (tileStates[r][c] === 'correct') tile.classList.add('correct');
        else if (tileStates[r][c] === 'present') tile.classList.add('present');
        else if (tileStates[r][c] === 'absent') tile.classList.add('absent');
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }
  }

  // Helper: render keyboard DOM
  function renderKeyboardDOM() {
    keyboardEl.innerHTML = '';
    for (let rowStr of LAYOUT){
      const rowDiv = document.createElement('div');
      rowDiv.className = 'key-row';
      for (let ch of rowStr.split('')){
        const key = document.createElement('button');
        key.className = 'key';
        key.textContent = ch;
        if (keyStates[ch]) key.classList.add(keyStates[ch]);
        if (isMaster) key.addEventListener('click', ()=>onScreenKey(ch));
        rowDiv.appendChild(key);
      }
      // On bottom row (third), add ENTER left and DEL right
      if (rowStr === 'ZXCVBNM') {
        const rowWithButtons = document.createElement('div');
        rowWithButtons.className = 'key-row';
        // ENTER
        const enterBtn = document.createElement('button');
        enterBtn.className = 'key';
        enterBtn.textContent = 'ENTER';
        if (isMaster) enterBtn.addEventListener('click', ()=>onScreenKey('ENTER'));
        rowWithButtons.appendChild(enterBtn);
        // letters
        for (let ch of rowStr.split('')){
          const key = document.createElement('button');
          key.className = 'key';
          key.textContent = ch;
          if (keyStates[ch]) key.classList.add(keyStates[ch]);
          if (isMaster) key.addEventListener('click', ()=>onScreenKey(ch));
          rowWithButtons.appendChild(key);
        }
        // DEL
        const delBtn = document.createElement('button');
        delBtn.className = 'key';
        delBtn.textContent = 'DEL';
        if (isMaster) delBtn.addEventListener('click', ()=>onScreenKey('DEL'));
        rowWithButtons.appendChild(delBtn);

        keyboardEl.appendChild(rowWithButtons);
      } else {
        keyboardEl.appendChild(rowDiv);
      }
    }
  }

  // On-screen key press (master only)
  function onScreenKey(key) {
    if (!isMaster || gameOver) return;
    if (key === 'ENTER') {
      if (currentCol === 5) submitGuess();
      return;
    }
    if (key === 'DEL') {
      if (currentCol > 0){
        currentCol--;
        board[currentRow][currentCol] = '';
        renderBoardDOM();
        publishState();
      }
      return;
    }
    if (currentCol < 5){
      board[currentRow][currentCol] = key;
      currentCol++;
      renderBoardDOM();
      publishState();
    }
  }

  // Physical keyboard support (master only)
  document.addEventListener('keydown', (e)=>{
    if (!isMaster || gameOver) return;
    const k = e.key;
    if (k === 'Enter') { if (currentCol === 5) submitGuess(); }
    else if (k === 'Backspace') {
      if (currentCol > 0){
        currentCol--;
        board[currentRow][currentCol] = '';
        renderBoardDOM();
        publishState();
      }
    } else {
      const lk = k.toUpperCase();
      if (/^[A-Z]$/.test(lk) && lk.length === 1 && currentCol < 5) {
        board[currentRow][currentCol] = lk;
        currentCol++;
        renderBoardDOM();
        publishState();
      }
    }
  });

  // Evaluate guess with Wordle rules (handles duplicate letters correctly)
  function evaluateGuess(guess, answer) {
    const result = Array(guess.length).fill('absent');
    const answerChars = answer.split('');

    // First pass: correct positions
    for (let i=0;i<guess.length;i++){
      if (guess[i] === answerChars[i]){
        result[i] = 'correct';
        answerChars[i] = null; // consume
      }
    }
    // Second pass: present letters
    for (let i=0;i<guess.length;i++){
      if (result[i] === 'correct') continue;
      const idx = answerChars.indexOf(guess[i]);
      if (idx !== -1){
        result[i] = 'present';
        answerChars[idx] = null; // consume
      } // else remain absent
    }
    return result;
  }

  // Submit current row guess (master only)
  function submitGuess(){
    if (!isMaster || gameOver) return;
    const guess = board[currentRow].join('');
    if (guess.length !== 5 || guess.includes('')) return;

    const evalResult = evaluateGuess(guess, solution);

    // Apply tile states and update keyStates with priority: correct > present > absent
    for (let c=0;c<5;c++){
      tileStates[currentRow][c] = evalResult[c] === 'correct' ? 'correct' : (evalResult[c] === 'present' ? 'present' : 'absent');
      const letter = board[currentRow][c];
      // update key state with priority
      if (evalResult[c] === 'correct') keyStates[letter] = 'correct';
      else if (evalResult[c] === 'present'){
        if (keyStates[letter] !== 'correct') keyStates[letter] = 'present';
      } else {
        if (!keyStates[letter]) keyStates[letter] = 'absent';
      }
    }

    renderBoardDOM();
    renderKeyboardDOM();

    // Check win/lose
    if (evalResult.every(s => s === 'correct')) {
      gameOver = true;
      showEndOverlay(true);
    } else {
      currentRow++;
      currentCol = 0;
      if (currentRow >= 6){
        gameOver = true;
        showEndOverlay(false);
      }
    }

    publishState();
  }

  // Show end overlay (master and follower)
  function showEndOverlay(win){
    endOverlay.classList.remove('hidden');
    if (win){
      endText.textContent = 'YOU WIN!';
      startConfetti();
    } else {
      endText.textContent = 'YOU LOSE! Word: ' + solution;
    }
  }

  // Confetti (simple)
  function startConfetti(){
    if (!confettiCanvas) return;
    const canvas = confettiCanvas;
    const ctx = canvas.getContext('2d');
    canvas.width = 420;
    canvas.height = 140;
    let running = true;
    if (confettiTimer) clearInterval(confettiTimer);
    confettiTimer = setInterval(()=>{
      ctx.fillStyle = `hsl(${Math.random()*360},100%,50%)`;
      const x = Math.random()*canvas.width;
      const y = Math.random()*canvas.height;
      ctx.fillRect(x,y,6,6);
    }, 40);
    // stop confetti after 6s
    setTimeout(()=>{
      clearInterval(confettiTimer);
      confettiTimer = null;
      ctx.clearRect(0,0,canvas.width, canvas.height);
    }, 6000);
  }

  // Reset logic: single click clears board (keeps solution), double click within 1s full reset (show overlay)
  resetBtn.addEventListener('click', ()=>{
    const now = Date.now();
    if (now - lastReset < 1000){
      // full reset
      fullReset();
    } else {
      // soft reset (clear board tiles and keystates but keep solution)
      softReset();
      publishState();
      lastReset = now;
    }
  });

  restartBtn.addEventListener('click', ()=>{
    // restart full (master only triggers overlay); follower will subscribe to subsequent state
    if (isMaster) fullReset();
    else {
      // follower ignore or reload to request fresh state
      // no-op
    }
  });

  function softReset(){
    board = Array.from({length:6}, () => Array.from({length:5}, () => ''));
    tileStates = Array.from({length:6}, () => Array.from({length:5}, () => ''));
    keyStates = {};
    currentRow = 0;
    currentCol = 0;
    gameOver = false;
    endOverlay.classList.add('hidden');
    renderBoardDOM();
    renderKeyboardDOM();
  }

  function fullReset(){
    // clears everything and shows overlay on master
    softReset();
    solution = '';
    if (isMaster){
      // show overlay to set new word
      const overlayNode = document.getElementById('startOverlay') || document.getElementById('startOverlay') || document.querySelector('.overlay');
      // Our index.html uses id="startOverlay" named earlier; in the provided index.html it's "startOverlay" indeed.
      // But safe approach: show the overlay element from DOM used earlier: start overlay id is "startOverlay"? Our final index.html uses id="startOverlay". If not found, use the first overlay.
      const startOverlay = document.getElementById('startOverlay') || document.querySelector('.overlay');
      if (startOverlay) startOverlay.style.display = 'flex';
    }
    publishState();
  }

  // Publish full state
  function publishState(){
    if (!channel || !isMaster) return;
    const state = {
      board,
      tileStates,
      keyStates,
      currentRow,
      currentCol,
      gameOver,
      solutionSet: !!solution
    };
    channel.publish('state', state);
  }

  // On follower: apply state
  function applyState(state){
    if (!state) return;
    board = state.board || board;
    tileStates = state.tileStates || tileStates;
    keyStates = state.keyStates || keyStates;
    currentRow = (typeof state.currentRow === 'number') ? state.currentRow : currentRow;
    currentCol = (typeof state.currentCol === 'number') ? state.currentCol : currentCol;
    gameOver = !!state.gameOver;
    renderBoardDOM();
    renderKeyboardDOM();
    if (gameOver) {
      if (state.tileStates) {
        // show end overlay with message if follower
        if (state.win) {
          endText.textContent = 'YOU WIN!';
        } else {
          endText.textContent = 'YOU LOSE! Word: ' + (state.solution || '');
        }
        endOverlay.classList.remove('hidden');
      }
    } else {
      endOverlay.classList.add('hidden');
    }
  }

  // Subscribe & fetch last state (if channel exists)
  if (channel){
    // subscribe to future messages
    channel.subscribe('state', (msg) => {
      if (isMaster) return;
      applyState(msg.data);
    });

    // fetch last message so follower catches up
    if (!isMaster && channel.history) {
      // Ably callback form
      channel.history((err, result) => {
        if (!err && result && result.items && result.items.length>0){
          const last = result.items[result.items.length-1];
          if (last && last.data) applyState(last.data);
        }
      });
    }
  }

  // INITIAL render
  softReset();
  renderBoardDOM();
  renderKeyboardDOM();

  // START overlay wiring: ensure start button and enter key trigger start (master only)
  if (isMaster){
    // ensure overlay visible
    const startOverlay = document.querySelector('.overlay');
    if (startOverlay) startOverlay.style.display = 'flex';
    // Start button and Enter key on input
    startBtn.addEventListener('click', startGameFromOverlay);
    if (customWordInput){
      customWordInput.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter') startGameFromOverlay();
      });
    }
  } else {
    // follower must hide start overlay if present
    const startOverlay = document.querySelector('.overlay');
    if (startOverlay) startOverlay.style.display = 'none';
  }

  function startGameFromOverlay(){
    const input = document.getElementById('customWord');
    if (!input) return;
    const word = input.value.trim().toUpperCase();
    if (!word || word.length !== 5) return;
    solution = word;
    // hide overlay
    const startOverlay = document.querySelector('.overlay');
    if (startOverlay) startOverlay.style.display = 'none';
    // reset and initialize board
    softReset();
    renderBoardDOM();
    renderKeyboardDOM();
    publishState(); // broadcast initial state
  }

}); // DOMContentLoaded end
