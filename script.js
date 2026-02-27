let answer = "";
let currentRow = 0;
let currentCol = 0;
let board = [];
let gameActive = false;
let confettiInterval = null;

const boardEl = document.getElementById("board");
const keyboardEl = document.getElementById("keyboard");
const resetBtn = document.getElementById("resetBtn");
const restartBtn = document.getElementById("restartBtn");
const wordOverlay = document.getElementById("wordOverlay");
const endOverlay = document.getElementById("endOverlay");
const endMessage = document.getElementById("endMessage");
const startBtn = document.getElementById("startBtn");
const wordInput = document.getElementById("wordInput");

function initializeGame() {
  buildBoard();
  buildKeyboard();
}

function buildBoard() {
  boardEl.innerHTML = "";
  board = [];
  currentRow = 0;
  currentCol = 0;

  for (let r = 0; r < 6; r++) {
    const rowDiv = document.createElement("div");
    rowDiv.className = "row";

    const rowTiles = [];

    for (let c = 0; c < 5; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      rowDiv.appendChild(tile);
      rowTiles.push(tile);
    }

    boardEl.appendChild(rowDiv);
    board.push(rowTiles);
  }
}

function buildKeyboard() {
  keyboardEl.innerHTML = "";

  const layout = [
    "QWERTYUIOP",
    "ASDFGHJKL",
    "ZXCVBNM"
  ];

  layout.forEach((rowLetters, index) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "key-row";

    if (index === 2) {
      rowDiv.appendChild(createKey("ENTER"));
    }

    rowLetters.split("").forEach(letter => {
      rowDiv.appendChild(createKey(letter));
    });

    if (index === 2) {
      rowDiv.appendChild(createKey("DELETE"));
    }

    keyboardEl.appendChild(rowDiv);
  });
}

function createKey(label) {
  const btn = document.createElement("button");
  btn.className = "key";
  btn.textContent = label;

  btn.addEventListener("click", () => {
    if (label === "ENTER") submitGuess();
    else if (label === "DELETE") deleteLetter();
    else addLetter(label);
  });

  return btn;
}

function addLetter(letter) {
  if (!gameActive) return;
  if (currentCol < 5) {
    board[currentRow][currentCol].textContent = letter;
    currentCol++;
  }
}

function deleteLetter() {
  if (!gameActive) return;
  if (currentCol > 0) {
    currentCol--;
    board[currentRow][currentCol].textContent = "";
  }
}

function submitGuess() {
  if (!gameActive) return;
  if (currentCol !== 5) return;

  const guess = board[currentRow].map(t => t.textContent).join("");

  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) {
      board[currentRow][i].classList.add("correct");
    } else if (answer.includes(guess[i])) {
      board[currentRow][i].classList.add("present");
    } else {
      board[currentRow][i].classList.add("absent");
    }
  }

  if (guess === answer) {
    launchConfetti();
    endGame("You Win!");
    return;
  }

  currentRow++;
  currentCol = 0;

  if (currentRow === 6) {
    endGame("You Lose! Word was: " + answer);
  }
}

function endGame(message) {
  gameActive = false;
  endMessage.textContent = message;
  endOverlay.classList.remove("hidden");
}

function resetBoardOnly() {
  stopConfetti();
  buildBoard();
  gameActive = true;
}

function fullRestart() {
  stopConfetti();
  answer = "";
  buildBoard();
  gameActive = false;

  endOverlay.classList.add("hidden");
  wordOverlay.classList.remove("hidden");
}

function launchConfetti() {
  const colors = ["#bb0000","#ffffff","#00bb00","#0000bb","#ffff00"];

  confettiInterval = setInterval(() => {
    const piece = document.createElement("div");
    piece.style.position = "fixed";
    piece.style.width = "8px";
    piece.style.height = "8px";
    piece.style.backgroundColor =
      colors[Math.floor(Math.random()*colors.length)];
    piece.style.top = "-10px";
    piece.style.left = Math.random()*window.innerWidth + "px";
    piece.style.zIndex = 9999;

    document.body.appendChild(piece);

    let fall = setInterval(() => {
      piece.style.top = parseInt(piece.style.top) + 5 + "px";
      if (parseInt(piece.style.top) > window.innerHeight) {
        clearInterval(fall);
        piece.remove();
      }
    }, 20);

  }, 120);
}

function stopConfetti() {
  clearInterval(confettiInterval);
}

startBtn.addEventListener("click", () => {
  const word = wordInput.value.toUpperCase();
  if (word.length === 5) {
    answer = word;
    wordOverlay.classList.add("hidden");
    buildBoard();
    gameActive = true;
  }
});

resetBtn.addEventListener("click", resetBoardOnly);
restartBtn.addEventListener("click", fullRestart);

document.addEventListener("keydown", e => {
  if (!gameActive) return;

  if (e.key === "Backspace") deleteLetter();
  else if (e.key === "Enter") submitGuess();
  else if (/^[a-zA-Z]$/.test(e.key)) addLetter(e.key.toUpperCase());
});

initializeGame();