export function formatTime(ms){
  if(ms==null||!Number.isFinite(ms))return"—";
  const minutes=Math.floor(ms/60000),seconds=Math.floor((ms%60000)/1000),millis=Math.floor(ms%1000);
  return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}.${String(millis).padStart(3,"0")}`;
}
export function createSession(config,athletes){
  return {
    id:`session-${Date.now()}`,createdAt:new Date().toISOString(),name:config.name,format:config.format,
    lapCount:config.lapCount,startMode:config.startMode,globalStart:null,globalEnd:null,
    athletes:athletes.map(a=>({athleteId:a.id,name:a.name,club:a.club,category:a.category,bib:a.bib,status:"ready",startedAt:null,finishedAt:null,laps:[]}))
  };
}
export function athleteTotal(a,now=performance.now()){return a.startedAt?(a.finishedAt||now)-a.startedAt:null}
export function recordTap(session,index,now=performance.now()){
  const a=session.athletes[index];if(!a||a.status==="finished")return null;
  if(!session.globalStart)session.globalStart=now;
  if(!a.startedAt){a.startedAt=now;a.status="running";return{type:"start",index}}
  const previous=a.laps.length?a.laps[a.laps.length-1].at:a.startedAt;
  a.laps.push({number:a.laps.length+1,at:now,split:now-previous,total:now-a.startedAt});
  if(a.laps.length>=session.lapCount){a.finishedAt=now;a.status="finished"}
  return{type:"lap",index};
}
export function startAll(session,now=performance.now()){
  if(session.globalStart)return null;session.globalStart=now;
  session.athletes.forEach(a=>{a.startedAt=now;a.status="running"});return{type:"startAll"};
}
export function undoAction(session,action){
  if(!action)return;
  if(action.type==="lap"){const a=session.athletes[action.index];a.laps.pop();a.finishedAt=null;a.status=a.startedAt?"running":"ready"}
  if(action.type==="start"){const a=session.athletes[action.index];a.startedAt=null;a.status="ready"}
  if(action.type==="startAll"){session.globalStart=null;session.athletes.forEach(a=>{a.startedAt=null;a.finishedAt=null;a.laps=[];a.status="ready"})}
}
