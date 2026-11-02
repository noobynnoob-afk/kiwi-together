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
  room.stage=stage;
  room.startedAt=Date.now();
  room.latch=false;
  room.keyOwner=null;
  room.keyTaken=false;
  room.crates=[{x:363,y:189},{x:363,y:381}];
  let i=0;
  for(const p of room.players.values()){
    p.x=142+(i%2)*56; p.y=247+Math.floor(i/2)*58;
    p.dx=0;p.dy=0;i++;
  }
}
function createRoom(){
  let id;do{id=code();}while(rooms.has(id));
  const room={id,players:new Map(),stage:0,latch:false,keyOwner:null,keyTaken:false,crates:[],startedAt:Date.now()};
  resetStage(room,0);rooms.set(id,room);return room;
}
function getWalls(room){
  const walls=[];
  if(room.stage===0){
    walls.push(rect(423,65,28,168),rect(423,310,28,178));
    walls.push(EXIT_TOP,EXIT_BOTTOM);
    if(!room.latch) walls.push(EXIT_GATE);
  } else if(room.stage===1){
    walls.push(STAGE2_TOP,STAGE2_BOTTOM);
    if(!room.keyTaken && !plateOccupied(room,{x:255,y:410},34)) walls.push(STAGE2_GATE);
    walls.push(EXIT_TOP,EXIT_BOTTOM);
    if(!room.keyTaken)walls.push(EXIT_GATE);
  } else if(room.stage===2){
    walls.push(rect(483,243,142,54));
    walls.push(EXIT_TOP,EXIT_BOTTOM);
    if(!room.latch)walls.push(EXIT_GATE);
  }
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
  if(room.stage===2){
    for(let j=0;j<room.crates.length;j++){
      if(j===ignoreCrate)continue;
      const box=room.crates[j];
      if(circleRect(x,y,r,rect(box.x-24,box.y-24,48,48)))return true;
    }
  }
  return false;
}
function pushCrates(room,player,x,y,mx,my){
  if(room.stage!==2)return false;
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
    if(room.stage===3)continue;
    for(const p of room.players.values()){
      const length=Math.hypot(p.dx,p.dy);
      if(length>0){const vx=p.dx/Math.max(1,length)*SPEED*dt,vy=p.dy/Math.max(1,length)*SPEED*dt;tryMove(room,p,vx,vy);}
    }
    if(room.stage===0){
      const a=occupied(room,PADS[0]);const b=occupied(room,PADS[1]);
      if(!room.latch && a.some(pa=>b.some(pb=>pa.id!==pb.id))){room.latch=true;announce(room,'좋아! 두 발판을 동시에 눌러서 출구가 열렸어!');}
    } else if(room.stage===1){
      if(!room.keyTaken){
        for(const p of room.players.values()){
          if(Math.hypot(p.x-708,p.y-274)<43){
            room.keyTaken=true;room.keyOwner=p.id;
            announce(room,p.name+'이(가) 황금 열쇠를 찾았어! 출구로 가자!');break;
          }
        }
      }
    } else if(room.stage===2){
      const onTarget=TARGETS.map(target=>room.crates.some(c=>Math.hypot(c.x-target.x,c.y-target.y)<37));
      if(!room.latch && onTarget.every(Boolean)){
        room.latch=true;announce(room,'딸깍! 상자 두 개가 스위치를 눌렀어!');
      }
    }
    const open=room.stage===0?room.latch:room.stage===1?room.keyTaken:room.latch;
    if(open){
      const atExit=[...room.players.values()].some(p=>p.x>873&&Math.abs(p.y-277)<54);
      if(atExit){
        const current=room.stage;
        resetStage(room,current+1);
        if(room.stage<3)announce(room,'🎉 방 '+(current+1)+' 탈출 성공! 다음 방으로 이동!');
        else announce(room,'🏆 전부 탈출 성공! 키위새들의 완벽한 팀워크!');
      }
    }
  }
}
function packState(room){
  const players=[...room.players.values()].map(p=>({id:p.id,name:p.name,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10,color:p.color,look:p.dx<0?-1:1}));
  return {
    type:'state',stage:room.stage,players,
    latch:room.latch,keyTaken:room.keyTaken,keyOwner:room.keyOwner,
    plateA:occupied(room,PADS[0]).length>0,plateB:occupied(room,PADS[1]).length>0,
    stage2Plate:plateOccupied(room,{x:255,y:410},34),
    boxes:room.crates,
    targets:TARGETS.map(t=>room.crates.some(c=>Math.hypot(c.x-t.x,c.y-t.y)<37)),
    seconds:Math.floor((Date.now()-room.startedAt)/1000)
  };
}
function disconnect(ws){
  if(!ws.room)return;
  const room=ws.room;
  const p=room.players.get(ws.pid);
  if(!p)return;
  room.players.delete(ws.pid);
  if(room.keyOwner===ws.pid){room.keyOwner=null;room.keyTaken=false;}
  if(room.players.size===0)rooms.delete(room.id);
  else announce(room,p.name+'님이 퇴장했습니다.');
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
      announce(room,p.name+'님이 참가했습니다. ('+room.players.size+'/4)');
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
      if(room.stage===3)resetStage(room,0);else resetStage(room);
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
