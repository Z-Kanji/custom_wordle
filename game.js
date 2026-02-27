/* game.js
   Master/follower Wordle using Ably.
   Usage:
     index.html?ablyKey=YOUR_KEY&mode=master
     index.html?ablyKey=YOUR_KEY&mode=follow
   This file must be named game.js
*/

document.addEventListener('DOMContentLoaded', () => {
  // --- params & mode ---
  const params = new URLSearchParams(window.location.search);
  const ablyKey = params.get('ablyKey') || params.get('key') || '';
  const modeParam = (params.get('mode') || params.get('role') || 'master').toLowerCase();
  const isMaster = (modeParam === 'master' || modeParam === 'm' || !params.has('mode'));

  // --- DOM refs ---
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

  // --- game state ---
  let solution = '';
  let board = Array.from({length:6}, ()=>Array.from({length:5}, ()=>''));
  let tileStates = Array.from({length:6}, ()=>Array.from({length:5}, ()=>'')); // '', 'correct','present','absent'
  let keyStates = {}; // letter -> '', 'correct','present','absent'
  let currentRow = 0;
  let currentCol = 0;
  let gameStarted = false;
  let gameOver = false;
  let lastReset = 0;
  let confettiAnim = null;

  // --- Ably setup ---
  let channel = null;
  if (ablyKey) {
    try {
      const ably = new Ably.Realtime(ablyKey);
      channel = ably.channels.get('custom-wordle-channel');
    } catch (err) {
      console.warn('Ably init failed', err);
      channel = null;
    }
  }

  // --- keyboard layout ---
  const LAYOUT = ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];

  // --- render functions ---
  function renderBoard() {
    boardEl.innerHTML = '';
    for (let r=0; r<6; r++){
      const row = document.createElement('div'); row.className='row';
      for (let c=0; c<5; c++){
        const tile = document.createElement('div'); tile.className='tile';
        tile.textContent = board[r][c] || '';
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
    for (let i=0;i<LAYOUT.length;i++){
      const rowStr = LAYOUT[i];
      const rowDiv = document.createElement('div'); rowDiv.className='key-row';

      if (i === 2) {
        // enter left
        const enterBtn = document.createElement('button'); enterBtn.className='key'; enterBtn.textContent='ENTER';
        if (isMaster && gameStarted) enterBtn.addEventListener('click', ()=>onScreenKey('ENTER'));
        rowDiv.appendChild(enterBtn);
      }

      for (let ch of rowStr.split('')) {
        const btn = document.createElement('button'); btn.className='key'; btn.textContent=ch;
        if (keyStates[ch]) btn.classList.add(keyStates[ch]);
        if (isMaster && gameStarted) btn.addEventListener('click', ()=>onScreenKey(ch));
        rowDiv.appendChild(btn);
      }

      if (i === 2) {
        const delBtn = document.createElement('button'); delBtn.className='key'; delBtn.textContent='DEL';
        if (isMaster && gameStarted) delBtn.addEventListener('click', ()=>onScreenKey('DEL'));
        rowDiv.appendChild(delBtn);
      }

      keyboardEl.appendChild(rowDiv);
    }
  }

  // --- input handlers (master only when gameStarted) ---
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
    if (currentCol < 5) {
      board[currentRow][currentCol] = label;
      currentCol++;
      publishState();
      renderBoard();
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!isMaster || !gameStarted || gameOver) return;
    if (e.key === 'Enter') { if (currentCol === 5) submitGuess(); return; }
    if (e.key === 'Backspace') { if (currentCol > 0){ currentCol--; board[currentRow][currentCol]=''; publishState(); renderBoard(); } return; }
    const ch = e.key.toUpperCase();
    if (/^[A-Z]$/.test(ch) && ch.length === 1 && currentCol < 5) {
      board[currentRow][currentCol] = ch;
      currentCol++;
      publishState();
      renderBoard();
    }
  });

  // --- evaluate guess (handles duplicates correctly) ---
  function evaluateGuess(guess, answer) {
    const res = Array(5).fill('absent');
    const arr = answer.split('');
    for (let i=0;i<5;i++){ if (guess[i] === arr[i]) { res[i] = 'correct'; arr[i] = null; } }
    for (let i=0;i<5;i++){ if (res[i] === 'correct') continue; const idx = arr.indexOf(guess[i]); if (idx !== -1){ res[i] = 'present'; arr[idx]=null; } }
    return res;
  }

  // --- submit (master only) ---
  function submitGuess() {
    if (!isMaster || !gameStarted || gameOver) return;
    if (currentCol !== 5) return;
    const guess = board[currentRow].join('');
    if (guess.length !== 5) return;

    const result = evaluateGuess(guess, solution);

    for (let c=0;c<5;c++){
      tileStates[currentRow][c] = result[c] === 'correct' ? 'correct' : (result[c] === 'present' ? 'present' : 'absent');
      const L = board[currentRow][c];
      if (result[c] === 'correct') keyStates[L] = 'correct';
      else if (result[c] === 'present') { if (keyStates[L] !== 'correct') keyStates[L] = 'present'; }
      else { if (!keyStates[L]) keyStates[L] = 'absent'; }
    }

    renderBoard();
    renderKeyboard();

    if (result.every(x => x === 'correct')) {
      gameOver = true;
      showEnd(true);
    } else {
      currentRow++;
      currentCol = 0;
      if (currentRow >= 6) { gameOver = true; showEnd(false); }
    }

    publishState();
  }

  // --- end overlay & confetti (falling) ---
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
    const particles = [];
    const colors = ['#f1c40f','#2ecc71','#e74c3c','#3498db','#ffffff'];

    for (let i=0;i<120;i++){
      particles.push({
        x: Math.random()*canvas.width,
        y: -Math.random()*canvas.height*2, // start above
        vx: (Math.random()-0.5)*1.5,
        vy: 1 + Math.random()*3,
        size: 4 + Math.random()*6,
        color: colors[Math.floor(Math.random()*colors.length)],
        rot: Math.random()*360
      });
    }

    let raf;
    function frame(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      for (let p of particles){
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03; // gravity
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    frame();
    setTimeout(()=>{ cancelAnimationFrame(raf); ctx.clearRect(0,0,canvas.width,canvas.height); }, 6000);
  }

  // --- reset / restart (single/double click) ---
  resetBtn.addEventListener('click', ()=>{
    const now = Date.now();
    if (now - lastReset < 1000){
      // full restart: reload to ensure clean state & re-open overlay on master
      fullReset();
    } else {
      softReset();
      publishState();
      lastReset = now;
    }
  });

  restartBtn.addEventListener('click', ()=>{
    if (isMaster) fullReset();
  });

  function softReset(){
    board = Array.from({length:6}, ()=>Array.from({length:5}, ()=>''));
    tileStates = Array.from({length:6}, ()=>Array.from({length:5}, ()=>''));
    keyStates = {};
    currentRow = 0; currentCol = 0;
    gameOver = false;
    endOverlay.classList.add('hidden');
    renderBoard();
    renderKeyboard();
  }

  function fullReset(){
    softReset();
    solution = '';
    gameStarted = false;
    // show overlay only for master
    if (isMaster && startOverlay) startOverlay.style.display = 'flex';
    publishState();
  }

  // --- publish / subscribe ---
  function publishState(){
    if (!channel || !isMaster) return;
    const payload = {
      board, tileStates, keyStates, currentRow, currentCol, gameStarted, gameOver,
      // send solution only when game over so follower can show losing word (avoid exposing solution mid-game)
      solution: gameOver ? solution : undefined,
      timestamp: Date.now()
    };
    channel.publish('state', payload);
  }

  function applyState(state){
    if (!state) return;
    board = state.board || board;
    tileStates = state.tileStates || tileStates;
    keyStates = state.keyStates || keyStates;
    currentRow = (typeof state.currentRow === 'number') ? state.currentRow : currentRow;
    currentCol = (typeof state.currentCol === 'number') ? state.currentCol : currentCol;
    gameStarted = !!state.gameStarted;
    gameOver = !!state.gameOver;
    if (state.solution) solution = state.solution;
    renderBoard();
    renderKeyboard();
    if (gameOver) {
      endText.textContent = state.solution ? ('YOU LOSE! Word: ' + state.solution) : 'GAME OVER';
      endOverlay.classList.remove('hidden');
    } else {
      endOverlay.classList.add('hidden');
    }
  }

  if (channel) {
    // subscribe asap
    channel.subscribe('state', msg => {
      if (isMaster) return;
      applyState(msg.data);
    });

    // follower fetch latest message to catch up
    if (!isMaster && channel.history) {
      channel.history({limit: 5}, (err, result) => {
        if (!err && result && result.items && result.items.length) {
          // pick the most recent item with data
          const last = result.items[result.items.length - 1];
          if (last && last.data) applyState(last.data);
        }
      });
    }
  }

  // --- start overlay wiring (master) ---
  if (isMaster) {
    if (startOverlay) startOverlay.style.display = 'flex';
    startBtn.addEventListener('click', startFromOverlay);
    if (customWordInput) customWordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startFromOverlay(); });
  } else {
    if (startOverlay) startOverlay.style.display = 'none';
  }

  function startFromOverlay(){
    if (!customWordInput) return;
    const val = (customWordInput.value || '').trim().toUpperCase();
    if (val.length !== 5) return;
    solution = val;
    gameStarted = true;
    if (startOverlay) startOverlay.style.display = 'none';
    softReset(); // ensure board blank
    renderBoard();
    renderKeyboard();
    publishState();
  }

  // --- initial draw ---
  softReset();
  renderBoard();
  renderKeyboard();
});
