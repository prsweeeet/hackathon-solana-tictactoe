const SOLANA_CLUSTER = "devnet";
const PUBLIC_URL = "https://tictactoepvp2-monfvksye-prsweeeet-5817s-projects.vercel.app/"; // ← replace with your Vercel production URL

function getConnection() {
  return new solanaWeb3.Connection(solanaWeb3.clusterApiUrl(SOLANA_CLUSTER), "confirmed");
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed", right: "16px", top: "18px", padding: "10px 14px",
    borderRadius: "8px", color: "#fff", fontWeight: 700, zIndex: 9999,
    transform: "translateX(110%)", transition: "transform .2s ease",
    boxShadow: "0 8px 20px rgba(0,0,0,0.18)"
  });
  const colors = { success:"#48bb78", error:"#f56565", info:"#4299e1" };
  el.style.background = colors[type] || colors.info;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.style.transform = "translateX(0)");
  setTimeout(() => { el.style.transform = "translateX(110%)"; setTimeout(()=>el.remove(), 220); }, 2800);
}

async function connectPhantom() {
  if (!window.solana || !window.solana.isPhantom) throw new Error("Phantom not found!");
  const resp = await window.solana.connect({ onlyIfTrusted: false });
  return { provider: window.solana, publicKey: resp.publicKey };
}

async function transferSOL_phantom(fromCtx, toPubkeyString, amountSOL) {
  const conn = getConnection();
  const toPubkey = new solanaWeb3.PublicKey(toPubkeyString);
  const lamports = Math.round(amountSOL * solanaWeb3.LAMPORTS_PER_SOL);

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new solanaWeb3.Transaction().add(
    solanaWeb3.SystemProgram.transfer({
      fromPubkey: fromCtx.publicKey,
      toPubkey,
      lamports
    })
  );
  tx.recentBlockhash = blockhash;
  tx.feePayer = fromCtx.publicKey;

  const signed = await fromCtx.provider.signTransaction(tx);
  const raw = signed.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

class PvPGame {
  constructor() {
    this.board = Array(9).fill("");
    this.currentPlayer = "X";
    this.gameValue = 0;
    this.playerX = null;
    this.playerO = null;
    this._winningLine = null;

    this.initUI();
    this.checkLink();
  }

  initUI() {
    document.querySelectorAll("[data-cell]").forEach(cell => {
      cell.addEventListener("click", e => this.handleClick(e));
    });

    document.getElementById("createGame").addEventListener("click", () => this.createGameLink());
    document.getElementById("connectO").addEventListener("click", async () => this.connectJoiner());
    document.getElementById("startGame").addEventListener("click", () => this.startGame());
  }

  createGameLink() {
    if (!window.solana || !window.solana.isPhantom) {
      toast("Phantom not found!", "error"); return;
    }
    if (!document.getElementById("gameValue").value) {
      toast("Enter game value!", "error"); return;
    }

    connectPhantom().then(ctx => {
      this.playerX = ctx;
      document.getElementById("walletX").textContent = `Player X: ${ctx.publicKey.toString().slice(0,6)}...`;

      const gameId = Math.floor(Math.random() * 1000000);
      const value = parseFloat(document.getElementById("gameValue").value);

      // Use the PUBLIC_URL to ensure it works for anyone
      const link = `${PUBLIC_URL}/?game=${gameId}&host=${ctx.publicKey}&value=${value}`;
      document.getElementById("gameLink").value = link;
      toast("Game link generated! Share with Joiner.", "success");
    }).catch(err => toast(err.message || "Connect Phantom failed", "error"));
  }

  checkLink() {
    const params = new URLSearchParams(window.location.search);
    const hostPubkey = params.get("host");
    const gameValue = parseFloat(params.get("value"));

    if (hostPubkey) {
      this.playerX = { publicKey: { toString: () => hostPubkey } };
      document.getElementById("walletX").textContent = `Player X: ${hostPubkey.slice(0,6)}...`;
      if (gameValue) document.getElementById("gameValue").value = gameValue;
      this._status("Waiting for Joiner to connect...");
    }
  }

  async connectJoiner() {
    try {
      const ctx = await connectPhantom();
      if (this.playerX && this.playerX.publicKey.toString() === ctx.publicKey.toString()) {
        toast("Cannot use host wallet", "error"); return;
      }
      this.playerO = ctx;
      document.getElementById("walletO").textContent = `Player O: ${ctx.publicKey.toString().slice(0,6)}...`;
      toast("Joiner connected!", "success");
      document.getElementById("startGame").disabled = false;
      this._status("Both players ready — click Start Game to play.");
    } catch (err) {
      toast(err.message || "Failed to connect", "error");
    }
  }

  startGame() {
    if (!this.playerX || !this.playerO) {
      this._status("Both players must connect!");
      return;
    }
    const val = parseFloat(document.getElementById("gameValue").value);
    if (!val || val < 0.2) { this._status("Invalid Game Value ≥ 0.2 SOL"); return; }

    this.gameValue = val;
    const each = val / 2;
    document.getElementById("eachBet").textContent = `${each.toFixed(2)} SOL`;
    document.getElementById("potDisplay").textContent = `${val.toFixed(2)} SOL`;

    this.board = Array(9).fill("");
    this.currentPlayer = "X";
    document.querySelectorAll("[data-cell]").forEach(c => { c.textContent=""; c.className="cell"; });

    this._status("Game started — Player X's turn");
  }

  handleClick(e) {
    const idx = Array.from(e.target.parentNode.children).indexOf(e.target);
    if (!this.gameValue) { this._status("Start game first"); return; }
    if (this.board[idx]) return;

    this.board[idx] = this.currentPlayer;
    e.target.textContent = this.currentPlayer;
    e.target.classList.add(this.currentPlayer.toLowerCase());

    if (this._checkWin()) {
      this._highlightWin();
      this._status(`${this.currentPlayer} wins — executing payout...`);
      this._payout(this.currentPlayer).catch(console.error);
      return;
    }

    if (this.board.every(v=>v)) {
      this._status("Draw — no transfers.");
      return;
    }

    this.currentPlayer = this.currentPlayer === "X" ? "O" : "X";
    this._status(`${this.currentPlayer}'s turn`);
  }

  _checkWin() {
    const W=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for(const line of W){
      const [a,b,c]=line;
      if(this.board[a] && this.board[a]===this.board[b] && this.board[a]===this.board[c]){
        this._winningLine=line; return true;
      }
    }
    return false;
  }

  _highlightWin() {
    if(!this._winningLine) return;
    this._winningLine.forEach(i => document.querySelectorAll("[data-cell]")[i].classList.add("winning"));
  }

  async _payout(winner){
    const loserCtx = winner==="X"?this.playerO:this.playerX;
    const winnerCtx = winner==="X"?this.playerX:this.playerO;
    if(!loserCtx||!winnerCtx){this._status("Missing wallets for payout"); return;}

    try{
      toast("Payout: waiting for loser approval...", "info");
      const sig = await transferSOL_phantom(loserCtx,winnerCtx.publicKey.toString(),this.gameValue);
      this._status(`✅ ${winner} won! ${this.gameValue} SOL transferred. Tx: ${sig}`);
      toast("Payout successful", "success");
    }catch(err){
      console.error(err);
      this._status("❌ Payout failed (loser may have rejected or insufficient balance).");
      toast("Payout failed", "error");
    }
  }

  _status(msg){ document.getElementById("status").textContent = msg; }
}

let game;
document.addEventListener("DOMContentLoaded", ()=>{
  if(location.protocol==="file:"){ alert("Run via http(s)"); }
  game = new PvPGame();
});