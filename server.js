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
const TOTAL_STAGES = 60;
// 60 authored stage specifications: 12 puzzle combinations across 5 biomes.
// Each stage has its own goal arrangement and obstacle topology.
const BIOMES = ['ROOM','FOREST','RUINS','CRYSTAL','ABYSS','SKY'];
const STAGE_NAMES = [
 'First Contact','Twin Signals','Hidden Key','Cargo Route','Split Decision','Four Corners','Stone Passage','Lock Sequence','Crossing','The Breaking Room',
 'Forest Entrance','Mossy Bridges','Root Lock','Fireflies','Fallen Trunks','Hollow Grove','Amber Trail','Moonlit Clearing','Ancient Tree','Deepwood Gate',
 'Sunken Atrium','Ruin Seals','Buried Key','Broken Statues','Echo Chamber','Rotating Paths','The Aqueduct','Temple Vault','Golden Hall','Guardian Door',
 'Crystal Shore','Prism Relay','Shattered Glass','Blue Cavern','Frozen Circuit','Mirror Path','Gem Lattice','Northern Lights','Resonance','Crystal Heart',
 'Ashen Steps','Ember Signals','Lava Bridge','Furnace Key','Red Chamber','Obsidian Maze','Molten Cargo','Volcanic Core','The Rift','Abyss Door',
 'Cloud Gardens','Floating Isles','Sky Signals','Star Fragments','Wind Temple','Astral Lock','The Last Cargo','Celestial Ring','Final Trial','Beyond the Door'];
const pt=(x,y)=>({x,y});
const rr=(x,y,w,h)=>({x,y,w,h});
const LEVELS=Array.from({length:TOTAL_STAGES},(_,i)=>{
 const zone=Math.floor(i/10),variant=i%10, pattern=i%12;
 const shift=(i*17)%67-33, swing=(i*29)%75-37;
 const pads=[],items=[],crates=[],targets=[],walls=[];
 // Distinct, navigable lane arrangements; left and right remain traversable.
 if(variant===0)walls.push(rr(390,75,24,105),rr(390,360,24,110));
 if(variant===1)walls.push(rr(510,75,24,125),rr(510,335,24,135));
 if(variant===2)walls.push(rr(395,220,105,22));
 if(variant===3)walls.push(rr(340,90,22,110),rr(590,345,22,115));
 if(variant===4)walls.push(rr(430,75,24,105),rr(430,365,24,105));
 if(variant===5)walls.push(rr(320,225,95,22),rr(580,295,90,22));
 if(variant===6)walls.push(rr(470,75,22,110),rr(470,365,22,105));
 if(variant===7)walls.push(rr(330,100,24,95),rr(590,355,24,100));
 if(variant===8)walls.push(rr(390,225,24,90),rr(550,225,24,90));
 if(variant===9)walls.push(rr(450,75,24,135),rr(450,335,24,135));
 // Goals stay outside walls, in deliberately varied accessible positions.
 const left=pt(220+shift,155+swing/3),lower=pt(220-shift/2,385-swing/3);
 const right=pt(715-shift,160-swing/3),bottom=pt(715+shift/2,382+swing/3);
 const mid=pt(470+shift/2,270+swing/2);
 const gems=[left,right,lower,bottom,mid];
 let need='items';
 switch(pattern){
 case 0:pads.push(left,lower);need='pads';break;
 case 1:items.push(right);break;
 case 2:crates.push(pt(300,270));targets.push(pt(680,270));need='crates';break;
 case 3:items.push(left,right,bottom);break;
 case 4:pads.push(left,right);need='pads';break;
 case 5:items.push(left,right,lower,bottom);break;
 case 6:crates.push(pt(285,185),pt(285,355));targets.push(pt(700,185),pt(700,355));need='crates';break;
 case 7:pads.push(lower,bottom);need='pads';break;
 case 8:items.push(left,lower,right,bottom);break;
 case 9:pads.push(left,lower);items.push(right);need='both';break;
 case 10:crates.push(pt(290,270));targets.push(pt(700,270));items.push(lower);need='cargo';break;
 case 11:pads.push(left,right);items.push(bottom);need='both';break;
 }
 // Avoid a blocked target or item when near center barriers.
 return {title:STAGE_NAMES[i],biome:BIOMES[zone],index:i,need,walls,pads,items,crates,targets,
   difficulty:1+Math.floor(i/10),breakout:i===9};
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
 room.collected=[];room.guardianX=2080;room.endingStart=0;
 let i=0;for(const p of room.players.values()){p.x=142+(i%2)*56;p.y=247+Math.floor(i/2)*58;p.dx=0;p.dy=0;i++;}
}
function createRoom(){
  let id;do{id=code();}while(rooms.has(id));
  const room={id,players:new Map(),stage:0,latch:false,keyOwner:null,keyTaken:false,crates:[],startedAt:Date.now()};
  resetStage(room,0);rooms.set(id,room);return room;
}
function getWalls(room){
 const level=LEVELS[room.stage];if(!level)return [];
 if(room.stage===59)return [];
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
  if(room.stage===59){
    if(x-r<55||x+r>2590||y-r<160||y+r>390)return true;
    if(!room.endingStart && x+r>room.guardianX-66 && x<room.guardianX+50)return true;
    if(!room.endingStart && x+r>2420)return true;
    return false;
  }
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
  if(room.stage===59){
    const party=[...room.players.values()];
    if(!room.endingStart){
      for(const p of party){
        const len=Math.max(1,Math.hypot(p.dx,p.dy));
        tryMove(room,p,p.dx/len*SPEED*dt,p.dy/len*SPEED*dt);
      }
      const pushers=party.filter(p=>p.dx>0.2 && p.x>=room.guardianX-115 &&
        p.x<=room.guardianX-55 && Math.abs(p.y-270)<100);
      if(pushers.length>=2){
        room.guardianX=Math.min(2330,room.guardianX+48*dt);
        for(const p of pushers)p.x=Math.max(p.x,room.guardianX-85);
      }
      if(room.guardianX>=2330){
        room.endingStart=Date.now();room.latch=true;
        announce(room,'THE LAST DOOR');
      }
    }
    continue;
  }
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
  // Once the cooperative puzzle is solved, keep the exit unlocked.
  // Players can step off their switches and walk to the door.
  const solved=level.need==='pads'?padsOK:level.need==='items'?itemsOK:level.need==='crates'?boxesOK:level.need==='cargo'?boxesOK&&itemsOK:padsOK&&itemsOK;
  if(solved)room.latch=true;
  // Every connected player must reach the exit before advancing.
  const party=[...room.players.values()];
  if(room.latch&&party.length>=2&&party.every(p=>p.x>873&&Math.abs(p.y-277)<54)){
   const current=room.stage;resetStage(room,current+1);
   announce(room,current+1===TOTAL_STAGES?'ALL STAGES CLEAR':'STAGE '+(current+1)+' CLEAR');
  }
 }
}
function packState(room){
 const players=[...room.players.values()].map(p=>({id:p.id,name:p.name,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10,color:p.color,look:p.dx<0?-1:1}));
 const level=LEVELS[room.stage];
 return {type:'state',stage:room.stage,players,latch:room.latch,guardian:room.stage===59?{x:room.guardianX,endingStart:room.endingStart,elapsed:room.endingStart?(Date.now()-room.endingStart)/1000:0}:null,
  level:level?{title:level.title,biome:level.biome,difficulty:level.difficulty,breakout:level.breakout,need:level.need,walls:level.walls,pads:level.pads,
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
