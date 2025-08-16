import { ref, set, update, onValue } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

const SOLANA_CLUSTER = "devnet";
const PUBLIC_URL = "https://tictactoepvp.vercel.app/"; // your Vercel URL

function toast(msg,type="info"){
  const el=document.createElement("div");
  el.textContent=msg;
  Object.assign(el.style,{position:"fixed",right:"16px",top:"18px",padding:"10px 14px",borderRadius:"8px",color:"#fff",fontWeight:700,zIndex:9999,transform:"translateX(110%)",transition:"transform .2s ease",boxShadow:"0 8px 20px rgba(0,0,0,0.18)"});
  const colors={success:"#48bb78",error:"#f56565",info:"#4299e1"};
  el.style.background=colors[type]||colors.info;
  document.body.appendChild(el);
  requestAnimationFrame(()=>el.style.transform="translateX(0)");
  setTimeout(()=>{el.style.transform="translateX(110%)"; setTimeout(()=>el.remove(),220)},2800);
}

async function connectPhantom(){
  if(!window.solana||!window.solana.isPhantom) throw new Error("Phantom not found!");
  const resp=await window.solana.connect({onlyIfTrusted:false});
  return {provider:window.solana,publicKey:resp.publicKey};
}

async function transferSOL(fromCtx,toPubkeyString,amountSOL){
  const conn=new solanaWeb3.Connection(solanaWeb3.clusterApiUrl(SOLANA_CLUSTER),"confirmed");
  const toPubkey=new solanaWeb3.PublicKey(toPubkeyString);
  const lamports=Math.round(amountSOL*solanaWeb3.LAMPORTS_PER_SOL);
  const { blockhash,lastValidBlockHeight }=await conn.getLatestBlockhash();
  const tx=new solanaWeb3.Transaction().add(solanaWeb3.SystemProgram.transfer({fromPubkey:fromCtx.publicKey,toPubkey,lamports}));
  tx.recentBlockhash=blockhash; tx.feePayer=fromCtx.publicKey;
  const signed=await fromCtx.provider.signTransaction(tx);
  const raw=signed.serialize();
  const sig=await conn.sendRawTransaction(raw,{skipPreflight:false});
  await conn.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},"confirmed");
  return sig;
}

class PvPGame{
  constructor(){
    this.board=Array(9).fill("");
    this.currentPlayer="X";
    this.gameValue=0;
    this.playerX=null;
    this.playerO=null;
    this.gameId=null;
    this._winningLine=null;
    this.initUI();
    this.checkLink();
  }

  initUI(){
    document.querySelectorAll("[data-cell]").forEach(c=>c.addEventListener("click",e=>this.handleClick(e)));
    document.getElementById("createGame").addEventListener("click",()=>this.createGameLink());
    document.getElementById("connectO").addEventListener("click",()=>this.connectJoiner());
    document.getElementById("startGame").addEventListener("click",()=>this.startGame());
  }

  async createGameLink(){
    if(!document.getElementById("gameValue").value){toast("Enter game value!","error");return;}
    const ctx=await connectPhantom();
    this.playerX=ctx;
    document.getElementById("walletX").textContent=`Player X: ${ctx.publicKey.toString().slice(0,6)}...`;
    this.gameId=Math.floor(Math.random()*1000000).toString();
    this.gameValue=parseFloat(document.getElementById("gameValue").value);

    const link=`${PUBLIC_URL}?game=${this.gameId}&host=${ctx.publicKey}&value=${this.gameValue}`;
    document.getElementById("gameLink").value=link;
    toast("Game link generated! Share with Joiner.","success");

    // Firebase initial state
    set(ref(db,`games/${this.gameId}`),{
      host:ctx.publicKey.toString(),
      joiner:null,
      board:Array(9).fill(""),
      currentPlayer:"X",
      gameValue:this.gameValue,
      status:"Waiting for Joiner..."
    });
  }

  checkLink(){
    const params=new URLSearchParams(window.location.search);
    const hostPubkey=params.get("host");
    this.gameId=params.get("game");
    if(hostPubkey){
      this.playerX={publicKey:{toString:()=>hostPubkey}};
      document.getElementById("walletX").textContent=`Player X: ${hostPubkey.slice(0,6)}...`;
      this.gameValue=parseFloat(params.get("value"))||0;
      document.getElementById("gameValue").value=this.gameValue;
      this._status("Waiting for Joiner to connect...");
    }
  }

  async connectJoiner(){
    try{
      const ctx=await connectPhantom();
      this.playerO=ctx;
      document.getElementById("walletO").textContent=`Player O: ${ctx.publicKey.toString().slice(0,6)}...`;
      document.getElementById("startGame").disabled=false;

      // update Firebase
      update(ref(db,`games/${this.gameId}`),{joiner:ctx.publicKey.toString(),status:"Both players ready — click Start Game"});

      onValue(ref(db,`games/${this.gameId}`),snapshot=>{
        const data=snapshot.val();
        if(!data) return;
        if(data.board) this.board=data.board;
        document.querySelectorAll("[data-cell]").forEach((c,i)=>c.textContent=this.board[i]);
        this.currentPlayer=data.currentPlayer;
        if(data.status) this._status(data.status);
      });
    }catch(err){toast(err.message||"Failed to connect","error");}
  }

  startGame(){
    if(!this.playerX||!this.playerO){this._status("Both players must connect!"); return;}
    this._status("Game started — Player X's turn");
    update(ref(db,`games/${this.gameId}`),{status:"Game started — Player X's turn"});
  }

  async handleClick(e){
    const idx=Array.from(e.target.parentNode.children).indexOf(e.target);
    if(this.board[idx]||!this.currentPlayer) return;
    this.board[idx]=this.currentPlayer;
    const winner=this._checkWin()?this.currentPlayer:null;
    const nextPlayer=this.currentPlayer==="X"?"O":"X";
    const statusMsg=winner?`${winner} wins!`:`${nextPlayer}'s turn`;

    update(ref(db,`games/${this.gameId}`),{board:this.board,currentPlayer:nextPlayer,status:statusMsg});

    if(winner){
      this._highlightWin();
      try{
        const loser=this.currentPlayer==="X"?this.playerO:this.playerX;
        await transferSOL(loser,this.currentPlayer==="X"?this.playerX.publicKey:this.playerO.publicKey,this.gameValue);
        toast(`${winner} received ${this.gameValue} SOL!`,"success");
      }catch(e){toast("SOL payout failed","error");}
    }

    this.currentPlayer=nextPlayer;
  }

  _checkWin(){
    const W=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for(const [a,b,c] of W){
      if(this.board[a]&&this.board[a]===this.board[b]&&this.board[a]===this.board[c]){
        this._winningLine=[a,b,c]; return true;
      }
    }
    return false;
  }

  _highlightWin(){if(!this._winningLine) return; this._winningLine.forEach(i=>document.querySelectorAll("[data-cell]")[i].classList.add("winning"));}
  _status(msg){document.getElementById("status").textContent=msg;}
}

let game;
document.addEventListener("DOMContentLoaded",()=>{game=new PvPGame();});