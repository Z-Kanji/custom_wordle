document.addEventListener("DOMContentLoaded", function () {

  // =====================
  // MODE & ABLY
  // =====================
  const params = new URLSearchParams(window.location.search);
  const isMaster = !params.has("mode") || params.get("mode")==="master";
  const ablyKey = params.get("ablyKey");
  let channel;
  if(ablyKey){
    const ably = new Ably.Realtime(ablyKey);
    channel = ably.channels.get("custom-wordle");
  }

  // =====================
  // DOM ELEMENTS
  // =====================
  const board = document.getElementById("board");
  const keyboard = document.getElementById("keyboard");
  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("startBtn");
  const resetBtn = document.getElementById("resetBtn");
  const winMessage = document.getElementById("winMessage");
  const winText = document.getElementById("winText");
  const restartBtn = document.getElementById("restartBtn");
  const confettiCanvas = document.getElementById("confetti");

  // =====================
  // GAME STATE
  // =====================
  let solution = "";
  let currentRow = 0;
  let currentGuess = "";
  let gameOver = false;
  let keyStates = {};
  let lastResetTime = 0;

  // =====================
  // KEYBOARD LAYOUT
  // =====================
  const layout = ["QWERTYUIOP","ASDFGHJKL","ZXCVBNM"];

  // =====================
  // START GAME
  // =====================
  if(isMaster){
    startBtn.addEventListener("click", () => {
      const wordInput = document.getElementById("customWord").value.toUpperCase();
      if(wordInput.length!==5) return;
      solution = wordInput;
      overlay.style.display="none";
      initBoard();
      initKeyboard();
      publishState();
    });
  } else {
    overlay.style.display="none";
  }

  // =====================
  // BOARD
  // =====================
  function initBoard(){
    board.innerHTML="";
    for(let r=0;r<6;r++){
      const row=document.createElement("div");
      row.className="row";
      for(let c=0;c<5;c++){
        const tile=document.createElement("div");
        tile.className="tile";
        row.appendChild(tile);
      }
      board.appendChild(row);
    }
  }

  // =====================
  // KEYBOARD
  // =====================
  function initKeyboard(){
    keyboard.innerHTML="";
    layout.forEach((rowStr,index)=>{
      const row=document.createElement("div");
      row.className="key-row";
      if(index===2) createKey("ENTER",row);
      rowStr.split("").forEach(l=>createKey(l,row));
      if(index===2) createKey("DEL",row);
      keyboard.appendChild(row);
    });
  }

  function createKey(letter,row){
    const key=document.createElement("div");
    key.className="key";
    key.textContent=letter;
    if(isMaster) key.addEventListener("click",()=>handleKey(letter));
    row.appendChild(key);
  }

  // =====================
  // INPUT HANDLING
  // =====================
  function handleKey(letter){
    if(gameOver) return;
    if(letter==="ENTER"){if(currentGuess.length===5) submitGuess(); return;}
    if(letter==="DEL"){currentGuess=currentGuess.slice(0,-1); updateBoard(); return;}
    if(currentGuess.length<5){currentGuess+=letter; updateBoard();}
  }

  function updateBoard(){
    const rowEl = board.children[currentRow];
    for(let i=0;i<5;i++){
      rowEl.children[i].textContent = currentGuess[i]||"";
    }
  }

  // =====================
  // SUBMIT
  // =====================
  function submitGuess(){
    const rowEl = board.children[currentRow];
    for(let i=0;i<5;i++){
      const tile=rowEl.children[i];
      const letter=currentGuess[i];
      if(letter===solution[i]){
        tile.className="tile green";
        keyStates[letter]="green";
      } else if(solution.includes(letter)){
        tile.className="tile yellow";
        if(keyStates[letter]!=="green") keyStates[letter]="yellow";
      } else{
        tile.className="tile gray";
        if(!keyStates[letter]) keyStates[letter]="gray";
      }
    }
    updateKeyboardColors();
    if(currentGuess===solution){gameOver=true; showWin();}
    currentRow++; currentGuess="";
    publishState();
  }

  function updateKeyboardColors(){
    document.querySelectorAll(".key").forEach(k=>{
      const letter=k.textContent;
      if(keyStates[letter]) k.className="key "+keyStates[letter];
    });
  }

  // =====================
  // WIN/LOSE
  // =====================
  function showWin(){
    winText.textContent="You Win!";
    winMessage.classList.remove("hidden");
    startConfetti();
  }

  function startConfetti(){
    confettiCanvas.width=window.innerWidth;
    confettiCanvas.height=window.innerHeight;
    const ctx=confettiCanvas.getContext("2d");
    setInterval(()=>{
      ctx.fillStyle=`hsl(${Math.random()*360},100%,50%)`;
      ctx.fillRect(Math.random()*confettiCanvas.width,
                   Math.random()*confettiCanvas.height,
                   6,6);
    },25);
  }

  // =====================
  // RESET BUTTON
  // =====================
  resetBtn.addEventListener("click",()=>{
    const now=Date.now();
    if(now-lastResetTime<1000){
      location.reload(); // double click: full restart
    } else {
      for(let r=0;r<6;r++){
        const row=board.children[r];
        for(let c=0;c<5;c++){row.children[c].textContent=""; row.children[c].className="tile";}
      }
      currentRow=0; currentGuess=""; keyStates={}; gameOver=false;
      updateKeyboardColors();
      lastResetTime=now;
      publishState();
    }
  });

  // =====================
  // RESTART BUTTON
  // =====================
  restartBtn.addEventListener("click",()=>location.reload());

  // =====================
  // ABLY SYNC
  // =====================
  function publishState(){
    if(!isMaster || !channel) return;
    channel.publish("state-update",{
      boardHTML: board.innerHTML,
      keyboardHTML: keyboard.innerHTML,
      currentRow,
      currentGuess,
      keyStates,
      gameOver
    });
  }

  if(channel){
    channel.subscribe("state-update", msg=>{
      if(isMaster) return;
      const data=msg.data;
      board.innerHTML=data.boardHTML;
      keyboard.innerHTML=data.keyboardHTML;
      currentRow=data.currentRow;
      currentGuess=data.currentGuess;
      keyStates=data.keyStates;
      gameOver=data.gameOver;
    });
  }

});
