/* game.js - master/follower Wordle with Ably
   Usage:
     index.html?ablyKey=YOUR_KEY&mode=master
     index.html?ablyKey=YOUR_KEY&mode=follow
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

  // --- state ---
  let solution = '';
  let board = Array.from({length:6}, ()=>Array.from({length:5}, ()=>''));
  let tileStates = Array.from({length:6}, ()=>Array.from({length:5}, ()=>'')); // '', 'correct','present','absent'
  let keyStates = {}; // A->'correct'|'present'|'absent'
  let currentRow = 0;
  let currentCol = 0;
  let gameStarted = false;
  let gameOver = false;
  let lastReset = 0;

  // --- confetti full-screen setup (appended by JS when needed) ---
  let confettiCanvas = null, confettiCtx = null, confettiParticles = [], confettiRunning = false;
  const CONFETTI_DURATION = 30000; // 30s

  function ensureConfettiCanvas(){
    if (confettiCanvas) return;
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.id = 'confettiFull';
    confettiCanvas.style.position = 'fixed';
    confettiCanvas.style.left = '0';
    confettiCanvas.style.top = '0';
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    confettiCanvas.style.pointerEvents = 'none';
    confettiCanvas.style.zIndex = '2000';
    document.body.appendChild(confettiCanvas);
    confettiCtx = confettiCanvas.getContext('2d');
    window.addEventListener('resize', ()=> {
      confettiCanvas.width = window.innerWidth;
      confettiCanvas.height = window.innerHeight;
    });
  }

  function startConfettiFullScreen(){
    ensureConfettiCanvas();
    if (confettiRunning) return;
    confettiRunning = true;
    confettiParticles = [];
    const colors = ['#f1c40f','#2ecc71','#e74c3c','#3498db','#ffffff','#ff66cc'];
    const spawnRate = 6; // per frame approx

    let last = performance.now();
    function spawn(){
      for (let i=0;i<spawnRate;i++){
        confettiParticles.push({
          x: Math.random()*confettiCanvas.width,
          y: -10 - Math.random()*confettiCanvas.height*0.2, // start above
          vx: (Math.random()-0.5)*1.2,
          vy: 1 + Math.random()*1.8, // slower downward
          size: 6 + Math.random()*6,
          color: colors[Math.floor(Math.random()*colors.length)],
          rot: Math.random()*360,
          rotSpeed: (Math.random()-0.5)*0.2
        });
      }
    }

    function step(now){
      const dt = Math.max(16, now - last);
      last = now;
      // spawn a few
      spawn();
      confettiCtx.clearRect(0,0,confettiCanvas.width, confettiCanvas.height);
      for (let i=confettiParticles.length-1;i>=0;i--){
        const p = confettiParticles[i];
        p.vy += 0.02 * (dt/16);
        p.x += p.vx * (dt/16);
        p.y += p.vy * (dt/16);
        p.rot += p.rotSpeed * (dt/16);
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
        confettiCtx.restore();
        // remove when below screen
        if (p.y > confettiCanvas.height + 50) confettiParticles.splice(i,1);
      }
      if (confettiRunning) requestAnimationFrame(step);
      else confettiCtx.clearRect(0,0,confettiCanvas.width, confettiCanvas.height);
    }

    requestAnimationFrame(step);
    // stop after duration
    setTimeout(()=>{ confettiRunning = false; }, CONFETTI_DURATION);
  }

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

  // --- keyboard layout & rendering ---
  const LAYOUT = ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];

  function renderBoard(){
    boardEl.innerHTML = '';
    for (let r=0;r<6;r++){
      const row = document.createElement('div'); row.className='row';
      for (let c=0;c<5;c++){
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

  function renderKeyboard(){
    keyboardEl.innerHTML = '';
    for (let i=0;i<LAYOUT.length;i++){
      const rowStr = LAYOUT[i];
      const rowDiv = document.createElement('div'); rowDiv.className='key-row';
      if (i === 2) {
        const enterBtn = document.createElement('button'); enterBtn.className='key'; enterBtn.textContent='ENTER';
        if (isMaster && gameStarted && !gameOver) enterBtn.addEventListener('click', ()=>onScreenKey('ENTER'));
        rowDiv.appendChild(enterBtn);
      }
      for (let ch of rowStr.split('')){
        const btn = document.createElement('button'); btn.className='key'; btn.textContent=ch;
        if (keyStates[ch]) btn.classList.add(keyStates[ch]);
        if (isMaster && gameStarted && !gameOver) btn.addEventListener('click', ()=>onScreenKey(ch));
        rowDiv.appendChild(btn);
      }
      if (i === 2) {
        const delBtn = document.createElement('button'); delBtn.className='key'; delBtn.textContent='DEL';
        if (isMaster && gameStarted && !gameOver) delBtn.addEventListener('click', ()=>onScreenKey('DEL'));
        rowDiv.appendChild(delBtn);
      }
      keyboardEl.appendChild(rowDiv);
    }
  }

  // --- input handlers (master) ---
  function onScreenKey(label){
    if (!isMaster || !gameStarted || gameOver) return;
    if (label === 'ENTER'){ if (currentCol === 5) submitGuess(); return; }
    if (label === 'DEL'){ if (currentCol>0){ currentCol--; board[currentRow][currentCol]=''; renderBoard(); publishState(); } return; }
    if (currentCol < 5){ board[currentRow][currentCol] = label; currentCol++; renderBoard(); publishState(); }
  }

  document.addEventListener('keydown', (e) => {
    if (!isMaster || !gameStarted || gameOver) return;
    if (e.key === 'Enter') { if (currentCol === 5) submitGuess(); return; }
    if (e.key === 'Backspace') { if (currentCol>0){ currentCol--; board[currentRow][currentCol]=''; renderBoard(); publishState(); } return; }
    const ch = e.key.toUpperCase();
    if (/^[A-Z]$/.test(ch) && ch.length === 1 && currentCol < 5){ board[currentRow][currentCol]=ch; currentCol++; renderBoard(); publishState(); }
  });

  // --- evaluate guess (handles duplicates) ---
  function evaluateGuess(guess, answer){
    const res = Array(5).fill('absent');
    const arr = answer.split('');
    for (let i=0;i<5;i++){ if (guess[i] === arr[i]) { res[i] = 'correct'; arr[i] = null; } }
    for (let i=0;i<5;i++){ if (res[i] === 'correct') continue; const idx = arr.indexOf(guess[i]); if (idx !== -1){ res[i] = 'present'; arr[idx] = null; } }
    return res;
  }

  // --- submit guess (master only) ---
  function submitGuess(){
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

    if (result.every(x => x === 'correct')){
      gameOver = true;
      // publish win=true and include solution for follower overlay if needed
      publishState(true);
      showEndOverlay(true);
      return;
    }

    currentRow++;
    currentCol = 0;
    if (currentRow >= 6){
      gameOver = true;
      publishState(false); // lose, include solution in payload
      showEndOverlay(false);
      return;
    }

    publishState(false);
  }

  // --- end overlay & behavior ---
  function showEndOverlay(win){
    endText.textContent = win ? 'YOU WIN!' : ('YOU LOSE! Word: ' + solution);
    endOverlay.classList.remove('hidden');
    if (win) startConfettiFullScreen();
  }

  // --- reset/restart single/double ---
  resetBtn.addEventListener('click', ()=>{
    const now = Date.now();
    if (now - lastReset < 1000){
      // full restart
      fullReset();
      lastReset = 0;
    } else {
      softReset();
      publishState(false);
      lastReset = now;
    }
  });

  restartBtn.addEventListener('click', ()=>{ if (isMaster) fullReset(); });

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
    if (isMaster && startOverlay) startOverlay.style.display = 'flex';
    publishState(false);
  }

  // --- publish / subscribe ---
  function publishState(win){
    if (!channel || !isMaster) return;
    const payload = {
      board, tileStates, keyStates, currentRow, currentCol, gameStarted, gameOver,
      win: !!win,
      solution: gameOver ? solution : undefined,
      ts: Date.now()
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
    if (gameOver){
      endText.textContent = state.win ? 'YOU WIN!' : ('YOU LOSE! Word: ' + (state.solution || solution));
      endOverlay.classList.remove('hidden');
      if (state.win) startConfettiFullScreen();
    } else {
      endOverlay.classList.add('hidden');
    }
  }

  if (channel){
    channel.subscribe('state', (msg) => { if (isMaster) return; applyState(msg.data); });

    if (!isMaster && channel.history){
      channel.history({limit: 5}, (err, result) => {
        if (!err && result && result.items && result.items.length){
          // pick most recent
          const last = result.items[result.items.length - 1];
          if (last && last.data) applyState(last.data);
        }
      });
    }
  }

  // --- start wiring ---
  if (isMaster){
    if (startOverlay) startOverlay.style.display = 'flex';
    startBtn.addEventListener('click', startFromOverlay);
    if (customWordInput) customWordInput.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') startFromOverlay(); });
  } else {
    if (startOverlay) startOverlay.style.display = 'none';
  }

  function startFromOverlay(){
    const v = (customWordInput.value || '').trim().toUpperCase();
    if (!v || v.length !== 5) return;
    solution = v;
    gameStarted = true;
    if (startOverlay) startOverlay.style.display = 'none';
    softReset();
    renderBoard();
    renderKeyboard();
    publishState(false);
  }

  // --- initial draw ---
  softReset();
  renderBoard();
  renderKeyboard();
});
