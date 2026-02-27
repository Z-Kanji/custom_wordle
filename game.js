/* game.js - master/follower Wordle with Ably sync
   Usage:
     index.html?ablyKey=YOUR_KEY&mode=master
     index.html?ablyKey=YOUR_KEY&mode=follow
   Files must be named index.html, style.css, game.js
*/
document.addEventListener('DOMContentLoaded', () => {
  // ---- URL params & mode ----
  const params = new URLSearchParams(window.location.search);
  const ablyKey = params.get('ablyKey') || params.get('key') || '';
  const modeParam = params.get('mode') || params.get('role') || 'master';
  const isMaster = (modeParam === 'master' || modeParam === 'm' || !params.has('mode'));

  // ---- DOM elements ----
  const startOverlay = document.getElementById('startOverlay');
  const customWordInput = document.getElementById('customWord');
  const startBtn = document.getElementById('startBtn');
  const boardEl = document.getElementById('board');
  const keyboardEl = document.getElementById('keyboard');
  const resetBtn = document.getElementById('resetBtn');
  const endOverlay = document.getElementById('endOverlay');
  const endText = document.getElementById('endText');
  const restartBtn = document.getElementById('restartBtn');
  const confettiCanvas = document.getElementById('confettiCanvas');

  // ---- state ----
  let solution = '';
  let board = Array.from({length:6}, ()=>Array.from({length:5}, ()=>''));
  let tileStates = Array.from({length:6}, ()=>Array.from({length:5}, ()=>'')); // 'correct'|'present'|'absent'|''
  let keyStates = {}; // A->'correct'|'present'|'absent'
  let currentRow = 0;
  let currentCol = 0;
  let gameStarted = false;
  let gameOver = false;
  let lastResetTime = 0;
  let confettiTimer = null;

  // ---- Ably ----
  let channel = null;
  if (ablyKey) {
    try {
      const ably = new Ably.Realtime(ablyKey);
      channel = ably.channels.get('custom-wordle');
    } catch (e) {
      console.warn('Ably init failed', e);
      channel = null;
    }
  }

  // ---- keyboard layout ----
  const LAYOUT = ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];

  // ---- helpers: render board/keyboard ----
  function renderBoard() {
    boardEl.innerHTML = '';
    for (let r=0;r<6;r++){
      const row = document.createElement('div');
      row.className = 'row';
      for (let c=0;c<5;c++){
        const tile = document.createElement('div');
        tile.className = 'tile';
        const ch = board[r][c] || '';
        tile.textContent = ch;
        // apply tile state
        tile.classList.remove('correct','present','absent');
        const s = tileStates[r][c];
        if (s === 'correct') tile.classList.add('correct');
        else if (s === 'present') tile.classList.add('present');
        else if (s === 'absent') tile.classList.add('absent');
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }
  }

  function renderKeyboard() {
    keyboardEl.innerHTML = '';
    // Top two rows normal, third row includes ENTER left and DEL right
    LAYOUT.forEach((rowStr, idx) => {
      if (idx < 2) {
        const rowDiv = document.createElement('div'); rowDiv.className='key-row';
        for (let ch of rowStr.split('')){
          const btn = document.createElement('button'); btn.className='key'; btn.textContent=ch;
          // color
          if (keyStates[ch]) btn.classList.add(keyStates[ch]);
          if (isMaster && gameStarted) btn.addEventListener('click', ()=>onScreenKey(ch));
          rowDiv.appendChild(btn);
        }
        keyboardEl.appendChild(rowDiv);
      } else {
        // bottom row with ENTER and DEL
        const rowDiv = document.createElement('div'); rowDiv.className='key-row';
        const enterBtn = document.createElement('button'); enterBtn.className='key'; enterBtn.textContent='ENTER';
        if (isMaster && gameStarted) enterBtn.addEventListener('click', ()=>onScreenKey('ENTER'));
        rowDiv.appendChild(enterBtn);
        for (let ch of rowStr.split('')){
          const btn = document.createElement('button'); btn.className='key'; btn.textContent=ch;
          if (keyStates[ch]) btn.classList.add(keyStates[ch]);
          if (isMaster && gameStarted) btn.addEventListener('click', ()=>onScreenKey(ch));
          rowDiv.appendChild(btn);
        }
        const delBtn = document.createElement('button'); delBtn.className='key'; delBtn.textContent='DEL';
        if (isMaster && gameStarted) delBtn.addEventListener('click', ()=>onScreenKey('DEL'));
        rowDiv.appendChild(delBtn);
        keyboardEl.appendChild(rowDiv);
      }
    });
  }

  // ---- on-screen key handler (master only, only when gameStarted) ----
  function onScreenKey(label) {
    if (!isMaster || !gameStarted || gameOver) return;
    if (label === 'ENTER') {
      if (currentCol === 5) submitGuess();
      return;
    }
    if (label === 'DEL') {
      if (currentCol > 0) {
        currentCol--;
        board[currentRow][currentCol] = '';
        publishState();
        renderBoard();
      }
      return;
    }
    // letter
    if (currentCol < 5) {
      board[currentRow][currentCol] = label;
      currentCol++;
      publishState();
      renderBoard();
    }
  }

  // ---- physical keyboard (master only, only when gameStarted) ----
  document.addEventListener('keydown', (e) => {
    if (!isMaster || !gameStarted || gameOver) return;
    if (e.key === 'Enter') {
      if (currentCol === 5) submitGuess();
      return;
    }
    if (e.key === 'Backspace') {
      if (currentCol > 0) {
        currentCol--;
        board[currentRow][currentCol] = '';
        publishState();
        renderBoard();
      }
      return;
    }
    const k = e.key.toUpperCase();
    if (/^[A-Z]$/.test(k) && k.length === 1) {
      if (currentCol < 5) {
        board[currentRow][currentCol] = k;
        currentCol++;
        publishState();
        renderBoard();
      }
    }
  });

  // ---- evaluate guess with Wordle rules (handles duplicates) ----
  function evaluateGuess(guess, answer) {
    const res = Array(5).fill('absent');
    const a = answer.split('');
    // first pass correct
    for (let i=0;i<5;i++){
      if (guess[i] === a[i]) { res[i] = 'correct'; a[i] = null; }
    }
    // second pass present
    for (let i=0;i<5;i++){
      if (res[i] === 'correct') continue;
      const idx = a.indexOf(guess[i]);
      if (idx !== -1) { res[i] = 'present'; a[idx] = null; }
    }
    return res;
  }

  // ---- submit guess (master only) ----
  function submitGuess() {
    if (!isMaster || !gameStarted || gameOver) return;
    if (currentCol !== 5) return;
    const guess = board[currentRow].join('');
    if (guess.length !== 5) return;

    const evalRes = evaluateGuess(guess, solution);

    // apply tile states and update keyStates with priority correct>present>absent
    for (let i=0;i<5;i++){
      tileStates[currentRow][i] = evalRes[i] === 'correct' ? 'correct' : (evalRes[i] === 'present' ? 'present' : 'absent');
      const L = board[currentRow][i];
      if (evalRes[i] === 'correct') keyStates[L] = 'correct';
      else if (evalRes[i] === 'present') { if (keyStates[L] !== 'correct') keyStates[L] = 'present'; }
      else { if (!keyStates[L]) keyStates[L] = 'absent'; }
    }

    renderBoard();
    renderKeyboard();

    // win?
    if (evalRes.every(x => x === 'correct')) {
      gameOver = true;
      showEnd(true);
    } else {
      currentRow++;
      currentCol = 0;
      if (currentRow >= 6) { gameOver = true; showEnd(false); }
    }

    publishState();
  }

  // ---- show end overlay & confetti ----
  function showEnd(win) {
    endText.textContent = win ? 'YOU WIN!' : ('YOU LOSE! Word: ' + solution);
    endOverlay.classList.remove('hidden');
    if (win) startConfetti();
  }

  function startConfetti() {
    if (!confettiCanvas) return;
    const canvas = confettiCanvas;
    const ctx = canvas.getContext('2d');
    canvas.width = 420; canvas.height = 140;
    if (confettiTimer) clearInterval(confettiTimer);
    confettiTimer = setInterval(()=>{
      ctx.fillStyle = `hsl(${Math.random()*360},100%,50%)`;
      ctx.fillRect(Math.random()*canvas.width, Math.random()*canvas.height, 6, 6);
    }, 30);
    setTimeout(()=>{ clearInterval(confettiTimer); confettiTimer = null; ctx.clearRect(0,0,canvas.width,canvas.height); }, 6000);
  }

  // ---- reset / restart behavior ----
  resetBtn.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastResetTime < 1000) {
      // full restart
      fullReset();
    } else {
      // soft reset: clear guesses & keys, keep solution, keep overlay hidden
      softReset();
      publishState();
      lastResetTime = now;
    }
  });

  restartBtn.addEventListener('click', () => {
    // Restart entire game (master triggers overlay)
    if (isMaster) fullReset();
  });

  function softReset() {
    board = Array.from({length:6}, ()=>Array.from({length:5}, ()=>''));
    tileStates = Array.from({length:6}, ()=>Array.from({length:5}, ()=>''));
    keyStates = {};
    currentRow = 0; currentCol = 0;
    gameOver = false;
    endOverlay.classList.add('hidden');
    renderBoard();
    renderKeyboard();
  }

  function fullReset() {
    softReset();
    solution = '';
    gameStarted = false;
    // show start overlay for master
    if (isMaster) {
      const s = document.getElementById('startOverlay');
      if (s) s.style.display = 'flex';
    }
    publishState();
  }

  // ---- publish + subscribe ----
  function publishState() {
    if (!channel || !isMaster) return;
    const state = {
      board, tileStates, keyStates, currentRow, currentCol, gameStarted, gameOver, // do NOT include solution unless gameOver for follower display
      solution: gameOver ? solution : undefined
    };
    channel.publish('state', state);
  }

  function applyStateFromMaster(stateObj) {
    if (!stateObj) return;
    // deep-assign safe
    board = stateObj.board || board;
    tileStates = stateObj.tileStates || tileStates;
    keyStates = stateObj.keyStates || keyStates;
    currentRow = (typeof stateObj.currentRow === 'number') ? stateObj.currentRow : currentRow;
    currentCol = (typeof stateObj.currentCol === 'number') ? stateObj.currentCol : currentCol;
    gameStarted = !!stateObj.gameStarted;
    gameOver = !!stateObj.gameOver;
    if (gameOver && stateObj.solution) {
      solution = stateObj.solution;
    }
    renderBoard();
    renderKeyboard();
    if (gameOver) {
      endText.textContent = stateObj.solution ? ('YOU LOSE! Word: ' + stateObj.solution) : 'GAME OVER';
      endOverlay.classList.remove('hidden');
    } else {
      endOverlay.classList.add('hidden');
    }
  }

  if (channel) {
    // subscribe right away (follower & master too; master ignores incoming)
    channel.subscribe('state', (msg) => {
      if (isMaster) return;
      applyStateFromMaster(msg.data);
    });

    // follower fetch history recent last item to catchup
    if (!isMaster && channel.history) {
      channel.history((err, result) => {
        if (!err && result && result.items && result.items.length) {
          const last = result.items[result.items.length-1];
          if (last && last.data) applyStateFromMaster(last.data);
        }
      });
    }
  }

  // ---- start overlay wiring (master only) ----
  if (isMaster) {
    const s = document.getElementById('startOverlay');
    if (s) s.style.display = 'flex';
    // click
    startBtn.addEventListener('click', startFromOverlay);
    // enter key inside input
    customWordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startFromOverlay(); });
  } else {
    // follower: hide overlay if present
    const s = document.getElementById('startOverlay');
    if (s) s.style.display = 'none';
  }

  function startFromOverlay() {
    const val = (customWordInput.value || '').trim().toUpperCase();
    if (!val || val.length !== 5) return;
    solution = val;
    gameStarted = true;
    // hide overlay
    const s = document.getElementById('startOverlay');
    if (s) s.style.display = 'none';
    // ensure blank board
    softReset();
    // render keyboard/board
    renderBoard();
    renderKeyboard();
    // broadcast initial state
    publishState();
  }

  // ---- initial render ----
  softReset();
  renderBoard();
  renderKeyboard();

}); // DOMContentLoaded end
