/* game.js
   Master/follower Wordle with Ably + tapered confetti runs.
   Usage:
     index.html?ablyKey=YOUR_KEY&mode=master
     index.html?ablyKey=YOUR_KEY&mode=follow
*/
document.addEventListener('DOMContentLoaded', () => {
  // ---- params & mode ----
  const params = new URLSearchParams(window.location.search);
  const ablyKey = params.get('ablyKey') || params.get('key') || '';
  const modeParam = (params.get('mode') || params.get('role') || 'master').toLowerCase();
  const isMaster = (modeParam === 'master' || modeParam === 'm' || !params.has('mode'));

  // ---- DOM refs ----
  const startOverlay = document.getElementById('startOverlay');
  const customWordInput = document.getElementById('customWord');
  const startBtn = document.getElementById('startBtn');
  const boardEl = document.getElementById('board');
  const keyboardEl = document.getElementById('keyboard');
  const resetBtn = document.getElementById('resetBtn');
  const endOverlay = document.getElementById('endOverlay');
  const endText = document.getElementById('endText');
  const restartBtn = document.getElementById('restartBtn');

  // ---- state ----
  let solution = '';
  let board = Array.from({length:6}, ()=>Array.from({length:5}, ()=>''));
  let tileStates = Array.from({length:6}, ()=>Array.from({length:5}, ()=>'')); // '', 'correct','present','absent'
  let keyStates = {}; // letter -> 'correct'|'present'|'absent'
  let currentRow = 0;
  let currentCol = 0;
  let gameStarted = false;
  let gameOver = false;
  let lastReset = 0;

  // ---- confetti (full-screen canvas) ----
  let confettiCanvas = null, confettiCtx = null;
  let confettiParticles = []; // particle objects
  let confettiRunning = false;
  let confettiEndTime = 0; // timestamp when confetti should stop spawning (tapering applies)
  let confettiTaperMs = 3000; // default taper duration at end of run (3s)
  const DEFAULT_CONFETTI_DURATION = 30000; // 30s

  function ensureConfettiCanvas(){
    if (confettiCanvas) return;
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.id = 'confettiFull';
    confettiCanvas.style.position = 'fixed';
    confettiCanvas.style.left = '0';
    confettiCanvas.style.top = '0';
    confettiCanvas.style.width = '100%';
    confettiCanvas.style.height = '100%';
    confettiCanvas.style.pointerEvents = 'none';
    confettiCanvas.style.zIndex = '2000';
    document.body.appendChild(confettiCanvas);
    confettiCtx = confettiCanvas.getContext('2d');
    resizeConfettiCanvas();
    window.addEventListener('resize', resizeConfettiCanvas);
  }

  function resizeConfettiCanvas(){
    if (!confettiCanvas) return;
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }

  // Start confetti for `durationMs` milliseconds; taperMs controls how long the spawn rate tapers at the end
  function startConfetti(durationMs = DEFAULT_CONFETTI_DURATION, taperMs = 3000){
    ensureConfettiCanvas();
    if (confettiRunning){
      // if already running, extend end time to max(current, now+durationMs)
      confettiEndTime = Math.max(confettiEndTime, performance.now() + durationMs);
      confettiTaperMs = Math.max(confettiTaperMs, taperMs);
      return;
    }

    confettiRunning = true;
    confettiEndTime = performance.now() + durationMs;
    confettiTaperMs = taperMs;
    confettiParticles = [];

    const colors = ['#f1c40f','#2ecc71','#e74c3c','#3498db','#ffffff','#ff66cc'];
    let last = performance.now();

    function frame(now){
      const dt = Math.max(16, now - last);
      last = now;

      // compute spawn multiplier based on time remaining
      const timeLeft = confettiEndTime - now;
      let spawnMultiplier = 1;
      if (timeLeft <= 0){
        spawnMultiplier = 0;
      } else if (timeLeft <= confettiTaperMs){
        spawnMultiplier = Math.max(0, timeLeft / confettiTaperMs);
      } else {
        spawnMultiplier = 1;
      }

      // spawn rate base (per frame); scale by multiplier
      const baseSpawn = 6;
      const toSpawn = Math.round(baseSpawn * spawnMultiplier);

      for (let i=0;i<toSpawn;i++){
        confettiParticles.push({
          x: Math.random() * confettiCanvas.width,
          y: -10 - Math.random()*confettiCanvas.height*0.15, // start above top (varied)
          vx: (Math.random() - 0.5) * 1.4,
          vy: 1 + Math.random() * 2.0,
          size: 6 + Math.random() * 8,
          color: colors[Math.floor(Math.random()*colors.length)],
          rot: Math.random()*360,
          rotSpeed: (Math.random()-0.5) * 6
        });
      }

      // update & draw
      confettiCtx.clearRect(0,0,confettiCanvas.width, confettiCanvas.height);
      for (let i = confettiParticles.length - 1; i >= 0; i--){
        const p = confettiParticles[i];
        // physics
        p.vy += 0.02 * (dt/16);
        p.x += p.vx * (dt/16);
        p.y += p.vy * (dt/16);
        p.rot += p.rotSpeed * (dt/16);
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot * Math.PI / 180);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
        confettiCtx.restore();
        // remove if fallen far below screen
        if (p.y > confettiCanvas.height + 120) confettiParticles.splice(i,1);
      }

      // stop condition: when spawn multiplier is 0 AND no particles remain
      const nowTime = performance.now();
      const spawningIsOver = nowTime > confettiEndTime;
      if (!spawningIsOver || confettiParticles.length > 0){
        requestAnimationFrame(frame);
      } else {
        // end animation
        confettiRunning = false;
        // clear canvas after a short delay to avoid abrupt disappearance
        setTimeout(()=>{ if (confettiCtx) confettiCtx.clearRect(0,0,confettiCanvas.width, confettiCanvas.height); }, 250);
      }
    }

    requestAnimationFrame(frame);
  }

  // Gracefully trigger short tapered confetti (used on reset/restart)
  function cueShortConfetti(fadeMs = 2000){
    // start short confetti that tapers fully in fadeMs (so duration == fadeMs, taper==fadeMs)
    startConfetti(fadeMs, fadeMs);
  }

  // ---- Ably setup ----
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

  // ---- keyboard layout & rendering ----
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

  // ---- input handlers (master) ----
  function onScreenKey(label){
    if (!isMaster || !gameStarted || gameOver) return;
    if (label === 'ENTER'){ if (currentCol === 5) submitGuess(); return; }
    if (label === 'DEL'){ if (currentCol>0){ currentCol--; board[currentRow][currentCol]=''; renderBoard(); publishState(); } return; }
    if (currentCol < 5){ board[currentRow][currentCol] = label; currentCol++; renderBoard(); publishState(); }
  }

  document.addEventListener('keydown', (e) => {
    if (!isMaster || !gameStarted || gameOver) return;
    if (e.key === 'Enter'){ if (currentCol === 5) submitGuess(); return; }
    if (e.key === 'Backspace'){ if (currentCol>0){ currentCol--; board[currentRow][currentCol]=''; renderBoard(); publishState(); } return; }
    const ch = e.key.toUpperCase();
    if (/^[A-Z]$/.test(ch) && ch.length === 1 && currentCol < 5){ board[currentRow][currentCol]=ch; currentCol++; renderBoard(); publishState(); }
  });

  // ---- evaluate guess (handles duplicates) ----
  function evaluateGuess(guess, answer){
    const res = Array(5).fill('absent');
    const arr = answer.split('');
    for (let i=0;i<5;i++){ if (guess[i] === arr[i]) { res[i] = 'correct'; arr[i] = null; } }
    for (let i=0;i<5;i++){ if (res[i] === 'correct') continue; const idx = arr.indexOf(guess[i]); if (idx !== -1){ res[i] = 'present'; arr[idx] = null; } }
    return res;
  }

  // ---- submit guess (master only) ----
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
      // master triggers full confetti run and publishes win:true
      startConfetti(DEFAULT_CONFETTI_DURATION, 3000);
      publishState(true, {confettiCue: {durationMs: DEFAULT_CONFETTI_DURATION, taperMs: 3000}});
      showEndOverlay(true);
      return;
    }

    currentRow++;
    currentCol = 0;
    if (currentRow >= 6){
      gameOver = true;
      // lose: publish and show overlay (no confetti)
      publishState(false);
      showEndOverlay(false);
      return;
    }

    publishState(false);
  }

  // ---- end overlay & behavior ----
  function showEndOverlay(win){
    endText.textContent = win ? 'YOU WIN!' : ('YOU LOSE! Word: ' + solution);
    endOverlay.classList.remove('hidden');
    // note: confetti started by master and by followers when they receive confettiCue in state
  }

  // ---- reset/restart single/double ----
  resetBtn.addEventListener('click', ()=>{
    const now = Date.now();
    if (now - lastReset < 1000){
      // full restart: cue short tapered confetti across displays and then reset
      if (isMaster){
        // publish confetti cue so followers show it
        publishState(false, {confettiCue: {durationMs: 2000, taperMs: 2000}});
      }
      // locally cue confetti and then perform fullReset after a short delay (let confetti play for 2s)
      startConfetti(2000, 2000);
      setTimeout(()=>{ fullReset(); }, 200); // small delay so overlay logic runs after confetti starts (keep short)
      lastReset = 0;
    } else {
      // soft reset: clear board/guesses only, keep solution
      softReset();
      if (isMaster) publishState(false);
      lastReset = now;
    }
  });

  restartBtn.addEventListener('click', ()=>{
    if (!isMaster) return;
    // cue short confetti and then full reset
    publishState(false, {confettiCue: {durationMs: 2000, taperMs: 2000}});
    startConfetti(2000, 2000);
    setTimeout(()=>{ fullReset(); }, 200);
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
    if (isMaster && startOverlay) startOverlay.style.display = 'flex';
    // publish a fresh state after reset (no confetti)
    if (isMaster) publishState(false);
  }

  // ---- publish / subscribe ----
  // publishState(win, extra) where extra can contain confettiCue: {durationMs, taperMs}
  function publishState(win = false, extra = {}) {
    if (!channel || !isMaster) return;
    const payload = {
      board,
      tileStates,
      keyStates,
      currentRow,
      currentCol,
      gameStarted,
      gameOver,
      win: !!win,
      solution: gameOver ? solution : undefined,
      confettiCue: extra.confettiCue || undefined,
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
      // if master indicated confetti cue, start confetti with those params
      if (state.confettiCue && state.confettiCue.durationMs){
        // follower should run confetti exactly as master requested
        startConfetti(state.confettiCue.durationMs, state.confettiCue.taperMs || 3000);
      } else if (state.win){
        // if win and no explicit cue, default run
        startConfetti(DEFAULT_CONFETTI_DURATION, 3000);
      }
    } else {
      endOverlay.classList.add('hidden');
    }
  }

  if (channel){
    channel.subscribe('state', (msg) => {
      if (isMaster) return;
      applyState(msg.data);
    });

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

  // ---- start wiring ----
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
    if (isMaster) publishState(false);
  }

  // ---- initial draw ----
  softReset();
  renderBoard();
  renderKeyboard();
});
