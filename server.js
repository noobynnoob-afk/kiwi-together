'use strict';
// KIWI TOGETHER — 2D multiplayer co-op escape-room game.
// Run: npm install && npm start
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 10000;
const WIDTH = 960, HEIGHT = 540;
const TOTAL_STAGES = 30;
const mode = stage => stage % 10;
const LEVELS = Array.from({length:30},(_,i)=>{
 const variant=Math.floor(i/10), kind=i%10;
 const shift=variant*38;
 const left=200+shift, right=650-shift;
 const layout=[
  {title:'동시 발판',pads:[{x:left,y:160},{x:left,y:382}],need:'pads'},
  {title:'열쇠 수색',items:[{x:right,y:270}],need:'items'},
  {title:'상자 정렬',crates:[{x:350,y:185},{x:350,y:370}],targets:[{x:640,y:185},{x:640,y:370}],need:'crates'},
  {title:'수집 경로',items:[{x:260,y:135},{x:460,y:385},{x:720,y:145}],need:'items'},
  {title:'갈림길',pads:[{x:290,y:155},{x:630,y:382}],need:'pads'},
  {title:'네 개의 별',items:[{x:250,y:145},{x:430,y:400},{x:580,y:140},{x:740,y:390}],need:'items'},
  {title:'중앙 상자',crates:[{x:340,y:270}],targets:[{x:670,y:270}],need:'crates'},
  {title:'양쪽 스위치',pads:[{x:230,y:380},{x:715,y:160}],need:'pads'},
  {title:'구석의 조각',items:[{x:180,y:110},{x:760,y:110},{x:180,y:425},{x:760,y:425}],need:'items'},
  {title:'마지막 협동',pads:[{x:310,y:175},{x:660,y:365}],items:[{x:490,y:270}],need:'both'}
 ][kind];
 const walls=[
  [{x:420,y:72,w:26,h:125},{x:420,y:335,w:26,h:140}],
  [{x:480,y:72,w:24,h:145},{x:480,y:335,w:24,h:140}],
  [{x:460,y:240,w:120,h:45}],
  [{x:340,y:195,w:26,h:155},{x:600,y:195,w:26,h:155}],
  [{x:450,y:72,w:25,h:170},{x:450,y:320,w:25,h:155}],
  [{x:350,y:215,w:110,h:24},{x:540,y:310,w:110,h:24}],
  [{x:480,y:72,w:24,h:130},{x:480,y:350,w:24,h:125}],
  [{x:360,y:230,w:24,h:130},{x:600,y:130,w:24,h:130}],
  [{x:350,y:230,w:25,h:110},{x:600,y:230,w:25,h:110}],
  [{x:460,y:72,w:26,h:140},{x:460,y:340,w:26,h:135}]
 ][kind].map(w=>({...w}));
 if(variant===1)walls.forEach(w=>{w.y=Math.max(75,Math.min(460-w.h,w.y+34));});
 if(variant===2)walls.forEach(w=>{w.x=Math.max(320,Math.min(735-w.w,w.x+55));});
 const offset=(p)=>({x:Math.min(785,p.x+variant*18),y:Math.max(110,Math.min(420,p.y+(variant===1?18:variant===2?-17:0)))});
 return {title:layout.title+' '+(variant+1),need:layout.need,walls,
  pads:(layout.pads||[]).map(offset),items:(layout.items||[]).map(offset),
  crates:(layout.crates||[]).map(offset),targets:(layout.targets||[]).map(offset)};
});
const SPEED = 188, RADIUS = 19;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const indexHTML = fs.readFileSync(path.join(__dirname, 'index.html'));
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'content-type': 'application/json', 'cache-control':'no-store'});
    res.end(JSON.stringify({ok:true, rooms:rooms.size}));
    return;
  }
  if (req.url === '/' || (req.url || '').startsWith('/?')) {
    res.writeHead(200, {
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:"
    });
    res.end(indexHTML);
    return;
  }
  res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); res.end('Not Found');
});
const wss = new WebSocket.Server({server, maxPayload: 2048});

function rect(x,y,w,h){return {x,y,w,h};}
const EXIT_TOP = rect(828,65,22,157);
const EXIT_BOTTOM = rect(828,330,22,158);
const EXIT_GATE = rect(828,222,22,108);
const STAGE2_TOP = rect(485,65,24,149);
const STAGE2_BOTTOM = rect(485,340,24,148);
const STAGE2_GATE = rect(485,214,24,126);
const PADS = [{x:285,y:176},{x:285,y:390}];
const TARGETS = [{x:674,y:189},{x:674,y:381}];
function code(){let result='';for(let i=0;i<5;i++) result+=CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];return result;}
function cleanName(str){return String(str||'').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,14) || '키위';}
function send(ws, data){if(ws && ws.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify(data));}catch(_){}}}
function broadcast(room,data){for(const p of room.players.values())send(p.ws,data);}
function announce(room,text){broadcast(room,{type:'notice',text});}
function resetStage(room,stage=room.stage){
 room.stage=stage;room.startedAt=Date.now();room.latch=false;room.keyTaken=false;room.keyOwner=null;
 const level=LEVELS[stage];
 room.crates=level?level.crates.map(p=>({...p})):[];
 room.collected=[];
 let i=0;for(const p of room.players.values()){p.x=142+(i%2)*56;p.y=247+Math.floor(i/2)*58;p.dx=0;p.dy=0;i++;}
}
function createRoom(){
  let id;do{id=code();}while(rooms.has(id));
  const room={id,players:new Map(),stage:0,latch:false,keyOwner:null,keyTaken:false,crates:[],startedAt:Date.now()};
  resetStage(room,0);rooms.set(id,room);return room;
}
function getWalls(room){
 const level=LEVELS[room.stage];if(!level)return [];
 const walls=level.walls.slice();
 walls.push(EXIT_TOP,EXIT_BOTTOM);
 if(!room.latch)walls.push(EXIT_GATE);
 return walls;
}
function circleRect(x,y,r,b){
  const px=Math.max(b.x,Math.min(x,b.x+b.w));
  const py=Math.max(b.y,Math.min(y,b.y+b.h));
  return (x-px)**2+(y-py)**2<r*r;
}
function occupied(room,point,r=34){
  return [...room.players.values()].filter(p=>(p.x-point.x)**2+(p.y-point.y)**2 <= r*r);
}
function plateOccupied(room,point,r){return occupied(room,point,r).length>0;}
function blocked(room,x,y,r,ignoreCrate=-1){
  if(x-r<55||x+r>905||y-r<72||y+r>479) return true;
  for(const w of getWalls(room))if(circleRect(x,y,r,w))return true;
  if(room.crates.length){
    for(let j=0;j<room.crates.length;j++){
      if(j===ignoreCrate)continue;
      const box=room.crates[j];
      if(circleRect(x,y,r,rect(box.x-24,box.y-24,48,48)))return true;
    }
  }
  return false;
}
function pushCrates(room,player,x,y,mx,my){
  if(!room.crates.length)return false;
  for(let i=0;i<room.crates.length;i++){
    const c=room.crates[i];
    if(!circleRect(x,y,RADIUS,rect(c.x-24,c.y-24,48,48)))continue;
    // The player's movement direction pushes a box one step; boxes stop at walls.
    const bx=c.x+mx*1.12, by=c.y+my*1.12;
    if(blocked(room,bx,by,25,i))return false;
    c.x=bx;c.y=by;
    return true;
  }
  return false;
}
function tryMove(room,p,dx,dy){
  if(!dx&&!dy)return;
  const attemptX=p.x+dx;
  if(!blocked(room,attemptX,p.y,RADIUS))p.x=attemptX;
  else if(pushCrates(room,p,attemptX,p.y,dx,0) && !blocked(room,attemptX,p.y,RADIUS))p.x=attemptX;
  const attemptY=p.y+dy;
  if(!blocked(room,p.x,attemptY,RADIUS))p.y=attemptY;
  else if(pushCrates(room,p,p.x,attemptY,0,dy) && !blocked(room,p.x,attemptY,RADIUS))p.y=attemptY;
}
function tick(dt){
 for(const room of rooms.values()){
  const level=LEVELS[room.stage];if(!level)continue;
  for(const p of room.players.values()){
   const length=Math.hypot(p.dx,p.dy);
   if(length>0)tryMove(room,p,p.dx/Math.max(1,length)*SPEED*dt,p.dy/Math.max(1,length)*SPEED*dt);
  }
  for(let i=0;i<level.items.length;i++){
   if(room.collected.includes(i))continue;
   if([...room.players.values()].some(p=>Math.hypot(p.x-level.items[i].x,p.y-level.items[i].y)<35))room.collected.push(i);
  }
  const padOwners=level.pads.map(pt=>occupied(room,pt));
  const padsOK=!level.pads.length||(padOwners.every(a=>a.length>0)&&
   (level.pads.length<2||padOwners[0].some(a=>padOwners[1].some(b=>a.id!==b.id))));
  const itemsOK=room.collected.length===level.items.length;
  const boxesOK=level.targets.every(t=>room.crates.some(c=>Math.hypot(c.x-t.x,c.y-t.y)<39));
  room.latch=level.need==='pads'?padsOK:level.need==='items'?itemsOK:level.need==='crates'?boxesOK:padsOK&&itemsOK;
  if(room.latch&&[...room.players.values()].some(p=>p.x>873&&Math.abs(p.y-277)<54)){
   const current=room.stage;resetStage(room,current+1);
   announce(room,current+1===TOTAL_STAGES?'ALL STAGES CLEAR':'STAGE '+(current+1)+' CLEAR');
  }
 }
}
function packState(room){
 const players=[...room.players.values()].map(p=>({id:p.id,name:p.name,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10,color:p.color,look:p.dx<0?-1:1}));
 const level=LEVELS[room.stage];
 return {type:'state',stage:room.stage,players,latch:room.latch,
  level:level?{title:level.title,need:level.need,walls:level.walls,pads:level.pads,
   items:level.items.map((p,i)=>({...p,taken:room.collected.includes(i)})),
   targets:level.targets,boxes:room.crates}:null,
  seconds:Math.floor((Date.now()-room.startedAt)/1000)};
}
function disconnect(ws){
  if(!ws.room)return;
  const room=ws.room;
  const p=room.players.get(ws.pid);
  if(!p)return;
  room.players.delete(ws.pid);
  if(room.keyOwner===ws.pid){room.keyOwner=null;room.keyTaken=false;}
  if(room.players.size===0)rooms.delete(room.id);
  else announce(room,p.name+' · LEFT');
  ws.room=null;
}
wss.on('connection',(ws)=>{
  ws.isAlive=true;
  ws.on('pong',()=>{ws.isAlive=true;});
  ws.on('message',(raw)=>{
    let m;
    try{m=JSON.parse(raw.toString());}catch(_){return;}
    if(!m||typeof m!=='object')return;
    if(m.type==='join'&&!ws.room){
      const request=String(m.room||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,5);
      let room;
      if(request){room=rooms.get(request);if(!room){send(ws,{type:'error',text:'해당 방을 찾을 수 없습니다. 코드를 확인하세요.'});return;}}
      else room=createRoom();
      if(room.players.size>=4){send(ws,{type:'error',text:'참가 인원은 최대 4명입니다.'});return;}
      const id=crypto.randomUUID();
      const color=['#d4b488','#cbb0f1','#9fd3b2','#f3ad98'][room.players.size%4];
      const p={id,name:cleanName(m.name),x:142+(room.players.size%2)*56,y:247+Math.floor(room.players.size/2)*58,dx:0,dy:0,color,ws,lastChat:0,chatWindow:[],lastEmoji:0};
      room.players.set(id,p);ws.room=room;ws.pid=id;
      send(ws,{type:'welcome',id,room:room.id});
      announce(room,p.name+' · JOIN ('+room.players.size+'/4)');
      send(ws,packState(room));
      return;
    }
    if(!ws.room)return;
    const room=ws.room,p=room.players.get(ws.pid);if(!p)return;
    if(m.type==='move'){
      const x=Number(m.x),y=Number(m.y);
      if(!Number.isFinite(x)||!Number.isFinite(y))return;
      p.dx=Math.max(-1,Math.min(1,x));p.dy=Math.max(-1,Math.min(1,y));
    }else if(m.type==='chat'){
      const now=Date.now();
      p.chatWindow=p.chatWindow.filter(t=>now-t<5000);
      if(now-p.lastChat<350||p.chatWindow.length>=6)return;
      const message=String(m.text||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120);
      if(!message)return;
      p.lastChat=now;p.chatWindow.push(now);
      broadcast(room,{type:'chat',id:p.id,name:p.name,text:message,time:now});
    }else if(m.type==='emote'){
      if(Date.now()-p.lastEmoji<1200)return;
      p.lastEmoji=Date.now();
      const options=['삐약!','여기야!','도와줘!','ㅋㅋㅋㅋ'];
      const i=Math.max(0,Math.min(3,Math.floor(Number(m.index)||0)));
      broadcast(room,{type:'bubble',id:p.id,text:options[i]});
    }else if(m.type==='reset'){
      if(room.stage===TOTAL_STAGES)resetStage(room,0);else resetStage(room);
      announce(room,p.name+'님이 퍼즐을 초기화했습니다.');
    }
  });
  ws.on('close',()=>disconnect(ws));
  ws.on('error',()=>disconnect(ws));
});
let last=Date.now();
setInterval(()=>{const now=Date.now(),dt=Math.min((now-last)/1000,0.07);last=now;tick(dt);},33);
setInterval(()=>{for(const room of rooms.values())broadcast(room,packState(room));},80);
setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},30000);
server.listen(PORT,'0.0.0.0',()=>console.log('KIWI TOGETHER running on port '+PORT));
