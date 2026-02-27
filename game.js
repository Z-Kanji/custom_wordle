// MODE
const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "master";
const isMaster = mode === "master";

// ABLY
const ably = new Ably.Realtime("kl-cqA.ucrYhg:ECzv8AHG9z3XIFia6nr8ZF9x4b-wfJc_iFlftdxZ7a0");
const channel = ably.channels.get("custom-wordle");

// GAME STATE
let solution = "";
let currentRow = 0;
let currentGuess = "";
let gameOver = false;
let boardState = [];
let keyStates = {};

const board = document.getElementById("board");
const keyboard = document.getElementById("keyboard");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");

// KEYBOARD LAYOUT
const layout = [
  "QWERTYUIOP",
  "ASDFGHJKL",
  "ENTERZXCVBNMDEL"
];

// INIT
startBtn.addEventListener("click", startGame);

function startGame() {
  const wordInput = document.getElementById("customWord").value.toUpperCase();
  if (wordInput.length !== 5) return;

  solution = wordInput;
  overlay.style.display = "none";
  initBoard();
  initKeyboard();

  if (isMaster) {
    publishState();
  }
}

function initBoard() {
  board.innerHTML = "";
  boardState = [];

  for (let r = 0; r < 6; r++) {
    const row = document.createElement("div");
    row.className = "row";
    boardState[r] = [];

    for (let c = 0; c < 5; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
      boardState[r].push("");
    }

    board.appendChild(row);
  }
}

function initKeyboard() {
  keyboard.innerHTML = "";

  layout.forEach(rowStr => {
    const row = document.createElement("div");
    row.className = "key-row";

    if (rowStr === "ENTERZXCVBNMDEL") {
      createKey("ENTER", row);
      "ZXCVBNM".split("").forEach(k => createKey(k, row));
      createKey("DEL", row);
    } else {
      rowStr.split("").forEach(k => createKey(k, row));
    }

    keyboard.appendChild(row);
  });
}

function createKey(letter, row) {
  const key = document.createElement("div");
  key.className = "key";
  key.textContent = letter;
  key.onclick = () => handleKey(letter);
  row.appendChild(key);
}

function handleKey(letter) {
  if (!isMaster || gameOver) return;

  if (letter === "ENTER") {
    if (currentGuess.length === 5) submitGuess();
    return;
  }

  if (letter === "DEL") {
    currentGuess = currentGuess.slice(0, -1);
    updateBoard();
    return;
  }

  if (currentGuess.length < 5) {
    currentGuess += letter;
    updateBoard();
  }
}

function updateBoard() {
  const row = board.children[currentRow];
  for (let i = 0; i < 5; i++) {
    row.children[i].textContent = currentGuess[i] || "";
  }
}

function submitGuess() {
  const row = board.children[currentRow];
  const guess = currentGuess;

  for (let i = 0; i < 5; i++) {
    const tile = row.children[i];
    const letter = guess[i];

    if (letter === solution[i]) {
      tile.classList.add("green");
      keyStates[letter] = "green";
    } else if (solution.includes(letter)) {
      tile.classList.add("yellow");
      if (keyStates[letter] !== "green") keyStates[letter] = "yellow";
    } else {
      tile.classList.add("gray");
      if (!keyStates[letter]) keyStates[letter] = "gray";
    }
  }

  updateKeyboardColors();

  if (guess === solution) {
    gameOver = true;
    showWin();
  }

  currentRow++;
  currentGuess = "";

  publishState();
}

function updateKeyboardColors() {
  document.querySelectorAll(".key").forEach(key => {
    const letter = key.textContent;
    if (keyStates[letter]) {
      key.classList.add(keyStates[letter]);
    }
  });
}

function showWin() {
  const win = document.getElementById("winMessage");
  win.classList.remove("hidden");
  startConfetti();
}

function startConfetti() {
  const canvas = document.getElementById("confetti");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext("2d");

  setInterval(() => {
    ctx.fillStyle = `hsl(${Math.random()*360},100%,50%)`;
    ctx.fillRect(Math.random()*canvas.width,
                 Math.random()*canvas.height,
                 5,5);
  }, 20);
}

// ABLY SYNC
function publishState() {
  channel.publish("update", {
    boardHTML: board.innerHTML,
    keyboardHTML: keyboard.innerHTML,
    currentRow,
    gameOver
  });
}

if (!isMaster) {
  overlay.style.display = "none";
  channel.subscribe("update", msg => {
    board.innerHTML = msg.data.boardHTML;
    keyboard.innerHTML = msg.data.keyboardHTML;
    currentRow = msg.data.currentRow;
    gameOver = msg.data.gameOver;
  });
}
