const role = new URLSearchParams(window.location.search).get("role") || "master";
const ABLY_KEY = "kl-cqA.ucrYhg:ECzv8AHG9z3XIFia6nr8ZF9x4b-wfJc_iFlftdxZ7a0";
const ably = new Ably.Realtime(ABLY_KEY);
const channel = ably.channels.get("live-wordle");

let state = {
  answer: "",
  board: Array(6).fill(null).map(()=>Array(5).fill("")),
  keyboard: {},
  row: 0,
  col: 0,
  active: false,
  endMessage: ""
};

const boardEl = document.getElementById("board");
const keyboardEl = document.getElementById("keyboard");
const resetBtn = document.getElementById("resetBtn");
const restartBtn = document.getElementById("restartBtn");
const wordOverlay = document.getElementById("wordOverlay");
const endOverlay = document.getElementById("endOverlay");
const endMessage = document.getElementById("endMessage");

if(role === "follower"){
  keyboardEl.style.display="none";
  resetBtn.style.display="none";
  wordOverlay.style.display="none";
}

function publish(){ if(role==="master") channel.publish("update", state); }

channel.subscribe("update", msg=>{
  if(role==="master") return;
  state = msg.data;
  render();
});

function buildBoard(){
  boardEl.innerHTML="";
  for(let r=0;r<6;r++){
    const row=document.createElement("div");
    row.className="row";
    for(let c=0;c<5;c++){
      const tile=document.createElement("div");
      tile.className="tile";
      tile.textContent=state.board[r][c];
      row.appendChild(tile);
    }
    boardEl.appendChild(row);
  }
}

function buildKeyboard(){
  keyboardEl.innerHTML="";
  const layout=["QWERTYUIOP","ASDFGHJKL","ZXCVBNM"];
  layout.forEach((row,i)=>{
    const rowDiv=document.createElement("div");
    rowDiv.className="key-row";
    if(i===2) rowDiv.appendChild(createKey("ENTER"));
    row.split("").forEach(l=>rowDiv.appendChild(createKey(l)));
    if(i===2) rowDiv.appendChild(createKey("DELETE"));
    keyboardEl.appendChild(rowDiv);
  });
}

function createKey(label){
  const btn=document.createElement("button");
  btn.className="key";
  btn.textContent=label;

  if(state.keyboard[label])
    btn.classList.add(state.keyboard[label]);

  if(role==="master"){
    btn.onclick=()=>handle(label);
  }
  return btn;
}

function handle(label){
  if(!state.active) return;

  if(label==="ENTER") submit();
  else if(label==="DELETE"){
    if(state.col>0){
      state.col--;
      state.board[state.row][state.col]="";
    }
  } else if(state.col<5){
    state.board[state.row][state.col]=label;
    state.col++;
  }

  render();
  publish();
}

function submit(){
  if(state.col!==5) return;
  const guess=state.board[state.row].join("");

  for(let i=0;i<5;i++){
    const letter=guess[i];
    if(letter===state.answer[i]){
      state.keyboard[letter]="correct";
    } else if(state.answer.includes(letter)){
      if(state.keyboard[letter]!=="correct")
        state.keyboard[letter]="present";
    } else {
      if(!state.keyboard[letter])
        state.keyboard[letter]="absent";
    }
  }

  if(guess===state.answer){
    state.endMessage="You Win!";
    state.active=false;
  } else {
    state.row++;
    state.col=0;
    if(state.row===6){
      state.endMessage="You Lose! Word was: "+state.answer;
      state.active=false;
    }
  }

  render();
  publish();
}

function render(){
  buildBoard();
  if(role==="master") buildKeyboard();
  if(state.endMessage){
    endMessage.textContent=state.endMessage;
    endOverlay.classList.remove("hidden");
  }
}

document.getElementById("startBtn").onclick=()=>{
  const word=document.getElementById("wordInput").value.toUpperCase();
  if(word.length===5){
    state.answer=word;
    state.active=true;
    wordOverlay.classList.add("hidden");
    publish();
  }
};

resetBtn.onclick=()=>{
  state.board=Array(6).fill(null).map(()=>Array(5).fill(""));
  state.keyboard={};
  state.row=0;
  state.col=0;
  state.active=true;
  state.endMessage="";
  publish();
  render();
};

restartBtn.onclick=()=>{
  location.reload();
};

render();
