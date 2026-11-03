
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;
const rooms = new Map();
const SPEED = 175;
const STAGES = 30;
const COLORS = ["#b6a078", "#c5a6e8", "#9ec9a0", "#e7b08c"];

const layouts = Array.from({ length: STAGES }, (_, n) => {
  const type = n % 10;
  const variant = Math.floor(n / 10);
  const shift = variant * 28;
  const configs = [
    { name: "동시 발판", pads: [[230, 160], [230, 380]] },
    { name: "열쇠 수색", gems: [[690, 270]] },
    { name: "상자 운반", boxes: [[340, 270]], targets: [[680, 270]] },
    { name: "세 개의 조각", gems: [[240, 140], [470, 390], [710, 140]] },
    { name: "갈림길", pads: [[300, 170], [660, 365]] },
    { name: "네 개의 별", gems: [[200, 130], [730, 130], [200, 400], [730, 400]] },
    { name: "상자 정렬", boxes: [[330, 180], [330, 360]], targets: [[690, 180], [690, 360]] },
    { name: "반대편 스위치", pads: [[220, 380], [730, 160]] },
    { name: "미로 수집", gems: [[260, 130], [700, 400], [470, 270]] },
    { name: "마지막 협동", pads: [[280, 160], [680, 380]], gems: [[480, 270]] }
  ];
  const c = configs[type];
  const walls = [
    [[420, 65, 24, 130], [420, 345, 24, 130]],
    [[480, 65, 24, 145], [480, 340, 24, 135]],
    [[460, 90, 24, 115], [460, 350, 24, 120]],
    [[340, 200, 25, 130], [600, 200, 25, 130]],
    [[450, 65, 24, 170], [450, 315, 24, 160]],
    [[350, 210, 110, 24], [550, 310, 110, 24]],
    [[480, 65, 24, 140], [480, 345, 24, 130]],
    [[360, 235, 24, 125], [610, 130, 24, 125]],
    [[350, 220, 24, 110], [610, 220, 24, 110]],
    [[455, 65, 24, 140], [455, 350, 24, 125]]
  ][type].map(([x,y,w,h]) => ({
    x: x + (variant === 2 ? 35 : 0),
    y: y + (variant === 1 ? 25 : 0), w, h
  }));
  const point = ([x,y]) => ({
    x: x + shift,
    y: Math.min(420, y + (variant === 1 ? 20 : variant === 2 ? -15 : 0))
  });
  return {
    name: c.name + " " + (variant + 1),
    pads: (c.pads || []).map(point),
    gems: (c.gems || []).map(point),
    boxes: (c.boxes || []).map(point),
    targets: (c.targets || []).map(point),
    walls
  };
});

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(data));
}
function broadcast(room, data) {
  for (const p of room.players.values()) send(p.ws, data);
}
function code() {
  return crypto.randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
}
function reset(room, stage = room.stage) {
  room.stage = stage;
  room.gems = [];
  room.boxes = stage < STAGES
    ? layouts[stage].boxes.map(b => ({...b})) : [];
  room.open = false;
  let i = 0;
  for (const p of room.players.values()) {
    p.x = 125 + (i % 2) * 55;
    p.y = 240 + Math.floor(i / 2) * 55;
    p.vx = p.vy = 0;
    i++;
  }
}
function createRoom() {
  let id;
  do { id = code(); } while (rooms.has(id));
  const room = {id, players:new Map(), stage:0, gems:[], boxes:[], open:false};
  rooms.set(id, room);
  return room;
}
function collides(x,y,r,b) {
  const cx = Math.max(b.x, Math.min(x, b.x+b.w));
  const cy = Math.max(b.y, Math.min(y, b.y+b.h));
  return Math.hypot(x-cx,y-cy) < r;
}
function blocked(room,x,y,ignore=-1) {
  if (x < 70 || x > 900 || y < 75 || y > 465) return true;
  const level = layouts[room.stage];
  if (!level) return false;
  const walls = [...level.walls,
    {x:815,y:65,w:25,h:150},
    {x:815,y:325,w:25,h:150}
  ];
  if (!room.open) walls.push({x:815,y:215,w:25,h:110});
  if (walls.some(w => collides(x,y,19,w))) return true;
  return room.boxes.some((b,i) =>
    i !== ignore && Math.abs(x-b.x)<42 && Math.abs(y-b.y)<42
  );
}
function move(room,p,dx,dy) {
  const moveAxis = (axis,d) => {
    if (!d) return;
    const nx = p.x + (axis==="x"?d:0);
    const ny = p.y + (axis==="y"?d:0);
    if (!blocked(room,nx,ny)) {
      p[axis] += d; return;
    }
    for (let i=0;i<room.boxes.length;i++) {
      const b=room.boxes[i];
      if (Math.abs(nx-b.x)<43 && Math.abs(ny-b.y)<43) {
        const bx=b.x+(axis==="x"?d:0);
        const by=b.y+(axis==="y"?d:0);
        if (!blocked(room,bx,by,i)) {
          b.x=bx; b.y=by;
          if (!blocked(room,nx,ny)) p[axis]+=d;
        }
        break;
      }
    }
  };
  moveAxis("x",dx);
  moveAxis("y",dy);
}
function update(dt) {
  for (const room of rooms.values()) {
    const level=layouts[room.stage];
    if (!level) continue;
    const players=[...room.players.values()];
    for (const p of players) {
      const len=Math.max(1,Math.hypot(p.vx,p.vy));
      move(room,p,p.vx/len*SPEED*dt,p.vy/len*SPEED*dt);
    }
    level.gems.forEach((g,i) => {
      if (room.gems.includes(i)) return;
      if (players.some(p=>Math.hypot(p.x-g.x,p.y-g.y)<35))
        room.gems.push(i);
    });
    const occupied=level.pads.map(pt =>
      players.filter(p=>Math.hypot(p.x-pt.x,p.y-pt.y)<35).map(p=>p.id)
    );
    const padsOK=!level.pads.length || (
      occupied.every(ids=>ids.length>0) &&
      (occupied.length<2 ||
       occupied[0].some(a=>occupied[1].some(b=>a!==b)))
    );
    const gemsOK=room.gems.length===level.gems.length;
    const boxesOK=level.targets.every(t=>
      room.boxes.some(b=>Math.hypot(b.x-t.x,b.y-t.y)<38)
    );
    room.open=padsOK&&gemsOK&&boxesOK;
    if (room.open && players.some(p=>p.x>870&&Math.abs(p.y-270)<65)) {
      reset(room,room.stage+1);
      broadcast(room,{type:"notice",text:room.stage>=STAGES?
        "ALL CLEAR":"STAGE "+room.stage+" CLEAR"});
    }
  }
}
function state(room) {
  const level=layouts[room.stage];
  return {
    type:"state", stage:room.stage, open:room.open,
    players:[...room.players.values()].map(p=>({
      id:p.id,name:p.name,x:p.x,y:p.y,color:p.color
    })),
    level:level?{
      ...level, boxes:room.boxes,
      gems:level.gems.map((g,i)=>({...g,taken:room.gems.includes(i)}))
    }:null
  };
}

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>KIWI TOGETHER</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#172b22;font-family:Arial,sans-serif;color:white}
button,input{font:inherit}
button{cursor:pointer;background:#315a45;color:white;border:1px solid #789e82;padding:9px}
#game{position:absolute;inset:0;display:none;overflow:hidden}
canvas{width:100%;height:100%;display:block;touch-action:none}
#menu{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#20382d}
.panel{background:#294635;padding:25px;width:min(360px,90vw);text-align:center}
.panel input{display:block;width:100%;margin:12px 0;padding:12px;background:#e9eee7;border:0;color:#222}
.panel button{width:100%;margin:5px 0}
#top{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:5px;align-items:center;pointer-events:none}
#top>*{pointer-events:auto}
#title{font-size:13px;background:#1c372bbd;padding:9px}
#room{margin-left:auto}
#chat{position:absolute;right:8px;top:55px;width:min(270px,48vw);height:230px;background:#152b23e8;display:none;flex-direction:column;padding:8px}
#messages{flex:1;overflow:auto;font-size:12px;overflow-wrap:anywhere}
#chatInput{width:100%;background:#dfe8de;border:0;padding:8px;color:#222}
#joy{position:absolute;bottom:20px;left:24px;width:125px;height:125px;border-radius:50%;border:2px solid #ffffff55;background:#ffffff19;touch-action:none;display:grid;place-items:center}
#stick{width:53px;height:53px;border-radius:50%;background:#d3e6d77d;pointer-events:none;transform:translate(0,0)}
#help{position:absolute;bottom:9px;right:10px;background:#1736297a;padding:6px;font-size:10px;color:#ffffffb8}
#notice{position:absolute;top:52px;left:50%;transform:translateX(-50%);font-size:12px;background:#203e32c9;padding:7px;display:none}
@media(orientation:portrait) and (max-width:900px){
#game{width:100dvh;height:100dvw;inset:auto;left:100dvw;top:0;transform-origin:top left;transform:rotate(90deg)}
#menu{transform:none}
}
</style></head><body>
<div id="menu"><div class="panel">
<h2>KIWI TOGETHER</h2>
<input id="name" placeholder="PLAYER NAME" maxlength="14">
<input id="code" placeholder="ROOM CODE (선택)" maxlength="5">
<button id="start">CREATE / JOIN</button>
<div id="error" style="font-size:12px;color:#ffc1ae"></div>
</div></div>
<div id="game">
<canvas id="canvas" width="960" height="540"></canvas>
<div id="top">
<span id="title">STAGE 01 / 30</span>
<button id="room">ROOM</button>
<button id="invite">INVITE</button>
<button id="chatBtn">CHAT</button>
</div>
<div id="notice"></div>
<div id="chat"><div id="messages"></div><input id="chatInput" placeholder="Message · Enter"></div>
<div id="joy"><div id="stick"></div></div>
<div id="help">WASD / 방향키 · 이동</div>
</div>
<script>
const $=id=>document.getElementById(id);
const canvas=$("canvas"),ctx=canvas.getContext("2d");
let ws,id=null,room="",state=null,joyX=0,joyY=0,activePointer=null;
let keys=new Set(),localPos=null,lastFrame=performance.now();
let bubbles=new Map(),nickname="";
const qp=new URLSearchParams(location.search);
$("code").value=qp.get("room")||"";
$("start").onclick=()=>{
 nickname=$("name").value.trim()||"KIWI";
 ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);
 $("error").textContent="CONNECTING";
 ws.onopen=()=>ws.send(JSON.stringify({type:"join",name:nickname,room:$("code").value.trim()}));
 ws.onmessage=e=>{
  let m;try{m=JSON.parse(e.data)}catch{return}
  if(m.type==="welcome"){
   id=m.id;room=m.room;$("menu").style.display="none";
   $("game").style.display="block";$("room").textContent=room;
   localPos=null;
  }else if(m.type==="state"){
   state=m;
   const self=m.players.find(p=>p.id===id);
   if(self&&!localPos)localPos={x:self.x,y:self.y};
   $("title").textContent=m.stage>=30?"ALL CLEAR":
    "STAGE "+String(m.stage+1).padStart(2,"0")+" / 30 · "+m.level.name;
  }else if(m.type==="chat"){
   addChat(m.name+": "+m.text);
   bubbles.set(m.id,{text:m.text,until:Date.now()+3500});
  }else if(m.type==="notice"){
   $("notice").textContent=m.text;$("notice").style.display="block";
   setTimeout(()=>$("notice").style.display="none",1800);
  }else if(m.type==="error"){$("error").textContent=m.text;ws.close()}
 };
 ws.onclose=()=>{if(id)$("notice").textContent="DISCONNECTED";};
};
function addChat(text){
 const d=document.createElement("div");d.textContent=text;
 $("messages").appendChild(d);$("messages").scrollTop=$("messages").scrollHeight;
}
$("chatBtn").onclick=()=>{$("chat").style.display=$("chat").style.display==="flex"?"none":"flex"};
$("chatInput").addEventListener("keydown",e=>{
 if(e.key==="Enter"){
  const text=e.target.value.trim();
  if(text&&ws?.readyState===1)ws.send(JSON.stringify({type:"chat",text}));
  e.target.value="";e.preventDefault();
 }
});
$("invite").onclick=()=>{
 const url=location.origin+"/?room="+room;
 navigator.clipboard?.writeText(url).then(()=>{
  $("notice").textContent="LINK COPIED";$("notice").style.display="block";
  setTimeout(()=>$("notice").style.display="none",1500);
 }).catch(()=>prompt("INVITE LINK",url));
};
$("room").onclick=()=>prompt("ROOM CODE",room);
const joy=$("joy"),stick=$("stick");
function joyMove(e){
 const r=joy.getBoundingClientRect();
 let dx=e.clientX-(r.left+r.width/2);
 let dy=e.clientY-(r.top+r.height/2);
 if(matchMedia("(orientation:portrait) and (max-width:900px)").matches){
  const a=dx;dx=dy;dy=-a;
 }
 const length=Math.hypot(dx,dy),max=43;
 joyX=length>4?dx/Math.max(max,length):0;
 joyY=length>4?dy/Math.max(max,length):0;
 const sx=joyX*max,sy=joyY*max;
 stick.style.transform="translate("+sx+"px,"+sy+"px)";
}
joy.addEventListener("pointerdown",e=>{
 e.preventDefault();activePointer=e.pointerId;
 try{joy.setPointerCapture(e.pointerId)}catch{}
 joyMove(e);
});
joy.addEventListener("pointermove",e=>{
 if(e.pointerId===activePointer){e.preventDefault();joyMove(e)}
});
function release(e){
 if(e.pointerId!==activePointer)return;
 activePointer=null;joyX=joyY=0;
 stick.style.transform="translate(0,0)";
}
window.addEventListener("pointerup",release);
window.addEventListener("pointercancel",release);
window.addEventListener("blur",()=>{keys.clear();joyX=joyY=0});
document.addEventListener("keydown",e=>{
 if(document.activeElement?.tagName==="INPUT")return;
 const k=e.key.toLowerCase();keys.add(k);
 if(["arrowup","arrowdown","arrowleft","arrowright"," "].includes(k))e.preventDefault();
});
document.addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
function input(){
 const x=joyX+(keys.has("d")||keys.has("arrowright")?1:0)-(keys.has("a")||keys.has("arrowleft")?1:0);
 const y=joyY+(keys.has("s")||keys.has("arrowdown")?1:0)-(keys.has("w")||keys.has("arrowup")?1:0);
 const length=Math.max(1,Math.hypot(x,y));
 return {x:x/length,y:y/length};
}
setInterval(()=>{
 if(ws?.readyState===1&&id)ws.send(JSON.stringify({type:"move",...input()}));
},40);
function rect(x,y,w,h,color){
 ctx.fillStyle=color;ctx.fillRect(x,y,w,h);
}
function circle(x,y,r,color){
 ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
 ctx.fillStyle=color;ctx.fill();
}
function text(str,x,y,size,color="#263d2e"){
 ctx.fillStyle=color;ctx.font="bold "+size+"px Arial";
 ctx.textAlign="center";ctx.fillText(str,x,y);
}
function kiwi(p){
 const x=p.x,y=p.y;
 ctx.save();ctx.translate(x,y);
 circle(0,3,24,"#765a3e");
 circle(0,0,22,p.color||"#b6a078");
 circle(-8,-5,3,"#222");circle(8,-5,3,"#222");
 ctx.fillStyle="#e9a54c";ctx.beginPath();
 ctx.moveTo(-5,4);ctx.lineTo(0,14);ctx.lineTo(6,4);ctx.fill();
 circle(-15,16,5,"#a87b48");circle(15,16,5,"#a87b48");
 ctx.restore();
 text(p.name||"KIWI",x,y-33,13,"#284632");
 const b=bubbles.get(p.id);
 if(b&&b.until>Date.now()){
  const width=Math.min(180,Math.max(65,b.text.length*8+15));
  rect(x-width/2,y-75,width,26,"#244637");
  text(b.text.slice(0,22),x,y-57,12,"#ffffff");
 }
}
function render(t){
 const dt=Math.min(.05,(t-lastFrame)/1000);lastFrame=t;
 ctx.clearRect(0,0,960,540);
 rect(0,0,960,540,"#c7d8bd");
 rect(50,55,860,430,"#e5ead2");
 for(let x=65;x<900;x+=48)
  for(let y=70;y<480;y+=48)circle(x,y,2,"#c9d5b9");
 rect(50,55,860,12,"#55785c");
 rect(50,473,860,12,"#55785c");
 rect(50,55,12,430,"#55785c");
 rect(900,55,12,430,"#55785c");
 if(state){
  const level=state.level;
  if(level){
   for(const w of level.walls)
    rect(w.x,w.y,w.w,w.h,"#708f75");
   for(const p of level.pads){
    const pressed=state.players.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<35);
    circle(p.x,p.y,30,pressed?"#5bb978":"#8ba4a1");
    text("SW",p.x,p.y+5,13,"#ffffff");
   }
   for(const g of level.gems)if(!g.taken){
    circle(g.x,g.y,13,"#e7b744");
    circle(g.x-3,g.y-4,5,"#fff1ad");
   }
   for(const p of level.targets){
    rect(p.x-29,p.y-29,58,58,"#a1b7a0");
    rect(p.x-24,p.y-24,48,48,"#dce5cc");
   }
   for(const b of level.boxes){
    rect(b.x-24,b.y-24,48,48,"#9d6f46");
    rect(b.x-18,b.y-18,36,36,"#c59a69");
   }
   rect(815,65,25,150,"#55785c");
   rect(815,325,25,160,"#55785c");
   rect(815,215,25,110,state.open?"#a2d8a4":"#ac665e");
   text("EXIT",870,205,17);
  }
  const self=state.players.find(p=>p.id===id);
  if(self){
   if(!localPos)localPos={x:self.x,y:self.y};
   const error=Math.hypot(localPos.x-self.x,localPos.y-self.y);
   if(error>65){localPos.x=self.x;localPos.y=self.y}
   else{
    localPos.x+=(self.x-localPos.x)*Math.min(1,dt*12);
    localPos.y+=(self.y-localPos.y)*Math.min(1,dt*12);
   }
   const v=input();
   localPos.x+=v.x*SPEED*dt;
   localPos.y+=v.y*SPEED*dt;
  }
  for(const p of state.players){
   if(p.id===id)continue;
   kiwi(p);
  }
  if(self&&localPos)kiwi({...self,x:localPos.x,y:localPos.y});
  if(state.stage>=30)text("ALL CLEAR",480,270,48);
 }else{
  text("CONNECTING",480,270,26);
 }
 requestAnimationFrame(render);
}
requestAnimationFrame(render);
</script></body></html>`;

const server = http.createServer((req,res)=>{
 if(req.url==="/health"){
  res.writeHead(200,{"Content-Type":"application/json"});
  return res.end(JSON.stringify({ok:true,rooms:rooms.size}));
 }
 res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
 res.end(html);
});
const wss = new WebSocket.Server({server});

wss.on("connection",ws=>{
 ws.on("message",raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==="join"&&!ws.room){
   const requested=String(m.room||"").trim().toUpperCase();
   const room=requested?rooms.get(requested):createRoom();
   if(!room)return send(ws,{type:"error",text:"ROOM NOT FOUND"});
   if(room.players.size>=4)return send(ws,{type:"error",text:"ROOM FULL"});
   const id=crypto.randomUUID(),i=room.players.size;
   const p={
    id,name:String(m.name||"KIWI").slice(0,14),
    x:125+i%2*55,y:240+Math.floor(i/2)*55,
    vx:0,vy:0,color:COLORS[i],ws,lastChat:0
   };
   room.players.set(id,p);ws.room=room;ws.pid=id;
   send(ws,{type:"welcome",id,room:room.id});
   broadcast(room,{type:"notice",text:p.name+" · JOIN"});
   return;
  }
  const room=ws.room,p=room?.players.get(ws.pid);
  if(!p)return;
  if(m.type==="move"){
   p.vx=Math.max(-1,Math.min(1,Number(m.x)||0));
   p.vy=Math.max(-1,Math.min(1,Number(m.y)||0));
  }
  if(m.type==="chat"){
   if(Date.now()-p.lastChat<350)return;
   const text=String(m.text||"").trim().slice(0,120);
   if(!text)return;
   p.lastChat=Date.now();
   broadcast(room,{type:"chat",id:p.id,name:p.name,text});
  }
 });
 ws.on("close",()=>{
  const room=ws.room;
  if(!room)return;
  const p=room.players.get(ws.pid);
  room.players.delete(ws.pid);
  if(p)broadcast(room,{type:"notice",text:p.name+" · LEFT"});
  if(!room.players.size)rooms.delete(room.id);
 });
});
let last=Date.now();
setInterval(()=>{
 const now=Date.now(),dt=Math.min(.05,(now-last)/1000);last=now;
 update(dt);
},33);
setInterval(()=>{
 for(const room of rooms.values())broadcast(room,state(room));
},80);
server.listen(PORT,"0.0.0.0",()=>console.log("KIWI TOGETHER",PORT));
