console.info("Beach Sprint Timer v2.1 auth fix loaded");
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./config.js";
import {importAthleteFile,downloadAthleteTemplate} from "./import.js";
import {formatTime,createSession,athleteTotal,recordTap,startAll,undoAction} from "./timer.js";

const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const $=id=>document.getElementById(id);
const normalize=v=>String(v??"").replace(/\s+/g," ").trim();

let authMode="login",currentUser=null,athletes=[],selectedIds=new Set(),sessions=[];
let session=null,actions=[],ticker=null,lastTap=new Map(),saving=false;

function setAuthMessage(text,error=false){$("authMessage").textContent=text;$("authMessage").className=`auth-message ${error?"error":"success"}`}
function setSync(text,state="ok"){$("syncBanner").textContent=text;$("syncBanner").dataset.state=state}
function showView(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===id));
}
function setAuthMode(mode){
  authMode=mode;const signup=mode==="signup";
  $("loginTab").classList.toggle("active",!signup);$("signupTab").classList.toggle("active",signup);
  $("fullNameLabel").classList.toggle("hidden",!signup);
  $("authSubmitButton").textContent=signup?"Crear cuenta":"Iniciar sesión";
  $("passwordInput").autocomplete=signup?"new-password":"current-password";setAuthMessage("");
}
async function handleAuth(event){
  event.preventDefault();
  const email=normalize($("emailInput").value),password=$("passwordInput").value,fullName=normalize($("fullNameInput").value);
  $("authSubmitButton").disabled=true;setAuthMessage(authMode==="signup"?"Creando cuenta…":"Entrando…");
  try{
    if(authMode==="signup"){
      const {data,error}=await client.auth.signUp({email,password,options:{data:{full_name:fullName},emailRedirectTo:location.origin}});
      if(error)throw error;
      if(!data.session)setAuthMessage("Cuenta creada. Revisa tu correo para confirmarla.");
    }else{
      const {error}=await client.auth.signInWithPassword({email,password});
      if(error)throw error;
    }
  }catch(error){setAuthMessage(error.message||"No se pudo completar la operación.",true)}
  finally{$("authSubmitButton").disabled=false}
}
async function forgotPassword(){
  const email=normalize($("emailInput").value);
  if(!email){setAuthMessage("Escribe primero tu correo electrónico.",true);return}
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin});
  setAuthMessage(error?error.message:"Te hemos enviado un correo para restablecer la contraseña.",!!error);
}
async function enterApp(user){
  currentUser=user;$("authScreen").classList.add("hidden");$("appShell").classList.remove("hidden");$("userEmail").textContent=user.email||"";
  setSync("☁️ Cargando…","loading");await Promise.all([loadAthletes(),loadSessions()]);setSync("☁️ Sincronizado","ok");renderAll();
}
function leaveApp(){
  currentUser=null;athletes=[];sessions=[];selectedIds.clear();session=null;
  $("appShell").classList.add("hidden");$("authScreen").classList.remove("hidden");
}
async function loadAthletes(){
  const {data,error}=await client.from("athletes").select("*").order("name");
  if(error){setSync(`Error: ${error.message}`,"error");return}
  athletes=data||[];selectedIds=new Set(athletes.slice(0,4).map(a=>a.id));
}
async function loadSessions(){
  const {data,error}=await client.from("sessions").select("*").order("session_date",{ascending:false}).limit(100);
  if(error){setSync(`Error: ${error.message}`,"error");return}
  sessions=data||[];
}
function athleteMeta(a){return [a.club,a.category,a.bib?`Dorsal: ${a.bib}`:""].filter(Boolean).join(" · ")}
function renderSessionAthletes(){
  const box=$("sessionAthleteCards");box.replaceChildren();
  if(!athletes.length)box.innerHTML='<div class="empty-state">Añade primero algún deportista.</div>';
  athletes.forEach(a=>{
    const button=document.createElement("button");button.type="button";button.className=`athlete-choice${selectedIds.has(a.id)?" selected":""}`;
    const text=document.createElement("div"),name=document.createElement("div"),meta=document.createElement("div"),mark=document.createElement("span");
    name.className="athlete-choice-name";name.textContent=a.name;meta.className="athlete-choice-meta";meta.textContent=athleteMeta(a);
    mark.className="choice-mark";mark.textContent=selectedIds.has(a.id)?"✓":"";text.append(name,meta);button.append(text,mark);
    button.addEventListener("click",()=>{selectedIds.has(a.id)?selectedIds.delete(a.id):selectedIds.add(a.id);renderSessionAthletes()});box.append(button);
  });
  $("selectionSummary").textContent=`${selectedIds.size} seleccionados`;
  $("toggleAllAthletes").textContent=athletes.length&&athletes.every(a=>selectedIds.has(a.id))?"Deseleccionar todos":"Seleccionar todos";
}
function renderAthletes(){
  const box=$("athleteManagementList");box.replaceChildren();
  if(!athletes.length){box.innerHTML='<div class="empty-state">No hay deportistas.</div>';return}
  athletes.forEach(a=>{
    const row=document.createElement("div");row.className="management-row";
    const text=document.createElement("div"),name=document.createElement("div"),meta=document.createElement("div"),del=document.createElement("button");
    name.className="management-name";name.textContent=a.name;meta.className="management-meta";meta.textContent=athleteMeta(a);text.append(name,meta);
    del.className="icon-button delete-button";del.type="button";del.textContent="×";
    del.addEventListener("click",async()=>{if(!confirm(`¿Eliminar a ${a.name}?`))return;setSync("☁️ Eliminando…","loading");
      const {error}=await client.from("athletes").delete().eq("id",a.id);if(error){alert(error.message);setSync("Error","error");return}
      athletes=athletes.filter(x=>x.id!==a.id);selectedIds.delete(a.id);renderAll();setSync("☁️ Sincronizado","ok")});
    row.append(text,del);box.append(row);
  });
}
async function addAthlete(event){
  event.preventDefault();const name=normalize($("athleteName").value);if(!name)return;
  if(athletes.some(a=>a.name.toLowerCase()===name.toLowerCase())){setImport("Ese deportista ya existe.",true);return}
  setSync("☁️ Guardando…","loading");
  const payload={user_id:currentUser.id,name,club:normalize($("athleteClub").value)||null,category:normalize($("athleteCategory").value)||null,bib:normalize($("athleteBib").value)||null};
  const {data,error}=await client.from("athletes").insert(payload).select().single();
  if(error){setImport(error.message,true);setSync("Error","error");return}
  athletes.push(data);athletes.sort((a,b)=>a.name.localeCompare(b.name));selectedIds.add(data.id);event.target.reset();renderAll();setImport(`${name} añadido.`);setSync("☁️ Sincronizado","ok");
}
function setImport(text,error=false){$("importMessage").textContent=text;$("importMessage").style.color=error?"#b91c1c":"#166534"}
async function handleImport(file){
  if(!file)return;setImport("Leyendo archivo…");
  try{
    const rows=await importAthleteFile(file);let added=0;
    for(const a of rows){
      if(athletes.some(x=>x.name.toLowerCase()===a.name.toLowerCase()))continue;
      const {data,error}=await client.from("athletes").insert({user_id:currentUser.id,name:a.name,club:a.club||null,category:a.category||null,bib:a.bib||null}).select().single();
      if(error)throw error;athletes.push(data);selectedIds.add(data.id);added++;
    }
    athletes.sort((a,b)=>a.name.localeCompare(b.name));renderAll();setImport(`${added} deportistas importados.`);setSync("☁️ Sincronizado","ok");
  }catch(error){setImport(error.message||"Error de importación.",true);setSync("Error","error")}
  $("athleteFileInput").value="";
}
function prepareTimer(){
  const chosen=athletes.filter(a=>selectedIds.has(a.id));if(!chosen.length){alert("Selecciona al menos un deportista.");return}
  session=createSession({name:normalize($("sessionName").value)||"Beach Sprint Session",format:$("sessionFormat").value,lapCount:Math.max(1,Number($("lapCount").value)||1),startMode:$("startMode").value},chosen);
  actions=[];lastTap.clear();renderTimer();showView("timerView");
}
function renderTimer(){
  $("liveSessionName").textContent=session.name;$("liveSessionInfo").textContent=`${session.format.toUpperCase()} · ${session.lapCount} laps`;
  $("startAllButton").style.display=session.startMode==="joint"?"inline-block":"none";const grid=$("timerAthleteGrid");grid.replaceChildren();
  session.athletes.forEach((a,index)=>{
    const card=document.createElement("article");card.className=`timer-card ${a.status}`;card.dataset.index=index;
    card.innerHTML=`<div class="timer-name"></div><div class="timer-stat">Lap: <strong id="lap-${index}"></strong></div><div class="timer-stat">Último parcial: <strong id="split-${index}"></strong></div><div class="timer-stat">Tiempo: <strong id="total-${index}"></strong></div><div class="timer-stat">Estado: <strong id="status-${index}"></strong></div>`;
    card.querySelector(".timer-name").textContent=a.name;
    const tap=document.createElement("button");tap.type="button";tap.className="tap-bar";tap.id=`tap-${index}`;
    tap.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();tapAthlete(index)});card.append(tap);grid.append(card);
  });updateTimer();
}
function tapAthlete(index){
  const now=performance.now(),previous=lastTap.get(index)||0;if(now-previous<180)return;lastTap.set(index,now);
  const action=recordTap(session,index,now);if(!action)return;actions.push(action);startTicker();updateTimer();
  const b=$(`tap-${index}`);b?.classList.add("flash");setTimeout(()=>b?.classList.remove("flash"),120);
  if(session.athletes.every(a=>a.status==="finished"))setTimeout(finishSession,250);
}
function updateTimer(){
  if(!session)return;const now=performance.now();
  session.athletes.forEach((a,index)=>{
    const card=document.querySelector(`.timer-card[data-index="${index}"]`);if(!card)return;card.className=`timer-card ${a.status}`;
    $(`lap-${index}`).textContent=`${a.laps.length}/${session.lapCount}`;$(`split-${index}`).textContent=formatTime(a.laps.at(-1)?.split);
    $(`total-${index}`).textContent=formatTime(athleteTotal(a,now));$(`status-${index}`).textContent=a.status==="ready"?"Preparado":a.status==="running"?"Compitiendo":"Finalizado";
    const tap=$(`tap-${index}`);tap.textContent=a.status==="finished"?"FINALIZADO":"PULSAR PARA LAP";tap.disabled=a.status==="finished";
  });
}
function startTicker(){if(ticker)return;ticker=setInterval(()=>{if(session?.globalStart)$("globalTimer").textContent=formatTime((session.globalEnd||performance.now())-session.globalStart);updateTimer()},50)}
async function finishSession(){
  if(!session||saving)return;saving=true;session.globalEnd=performance.now();clearInterval(ticker);ticker=null;setSync("☁️ Guardando sesión…","loading");
  try{
    const {data:saved,error}=await client.from("sessions").insert({user_id:currentUser.id,name:session.name,session_type:session.format,start_mode:session.startMode,lap_count:session.lapCount,status:"finished",session_date:new Date().toISOString()}).select().single();
    if(error)throw error;
    for(const a of session.athletes){
      const total=athleteTotal(a,session.globalEnd);
      const {data:participant,error:pe}=await client.from("session_athletes").insert({user_id:currentUser.id,session_id:saved.id,athlete_id:a.athleteId,athlete_name:a.name,status:a.status,total_time_ms:total==null?null:Math.round(total)}).select().single();
      if(pe)throw pe;
      if(a.laps.length){
        const rows=a.laps.map(l=>({user_id:currentUser.id,session_id:saved.id,session_athlete_id:participant.id,lap_number:l.number,split_time_ms:Math.round(l.split),total_time_ms:Math.round(l.total)}));
        const {error:se}=await client.from("splits").insert(rows);if(se)throw se;
      }
    }
    sessions.unshift(saved);setSync("☁️ Sesión guardada","ok");
  }catch(error){alert(`La sesión se mantiene en pantalla, pero no pudo subirse: ${error.message}`);setSync("Error al guardar","error")}
  renderResults();renderHistory();showView("resultsView");saving=false;
}
function renderResults(){
  const sorted=[...session.athletes].sort((a,b)=>(athleteTotal(a,session.globalEnd)??Infinity)-(athleteTotal(b,session.globalEnd)??Infinity));
  let html="<table><thead><tr><th>Pos.</th><th>Deportista</th><th>Parciales</th><th>Total</th></tr></thead><tbody>";
  sorted.forEach((a,i)=>html+=`<tr><td>${a.finishedAt?i+1:"—"}</td><td>${a.name}</td><td>${a.laps.map(l=>formatTime(l.split)).join(" / ")||"—"}</td><td><strong>${formatTime(athleteTotal(a,session.globalEnd))}</strong></td></tr>`);
  $("resultsContainer").innerHTML=html+"</tbody></table>";
}
function exportResults(){
  const headers=["Fecha","Sesión","Formato","Deportista",...Array.from({length:session.lapCount},(_,i)=>`Lap ${i+1}`),"Tiempo total"];
  const rows=session.athletes.map(a=>[new Date().toLocaleString(),session.name,session.format,a.name,...Array.from({length:session.lapCount},(_,i)=>a.laps[i]?formatTime(a.laps[i].split):""),formatTime(athleteTotal(a,session.globalEnd))]);
  const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="resultados_beach_sprint.csv";a.click();URL.revokeObjectURL(url);
}
function renderHistory(){
  const box=$("historyList");box.replaceChildren();if(!sessions.length){box.innerHTML='<div class="empty-state">Todavía no hay sesiones guardadas.</div>';return}
  sessions.forEach(s=>{const row=document.createElement("div");row.className="management-row";row.innerHTML='<div><div class="management-name"></div><div class="management-meta"></div></div>';
    row.querySelector(".management-name").textContent=s.name;row.querySelector(".management-meta").textContent=`${new Date(s.session_date).toLocaleString()} · ${s.session_type.toUpperCase()} · ${s.lap_count} laps`;box.append(row)});
}
function renderAll(){renderSessionAthletes();renderAthletes();renderHistory()}

$("loginTab").addEventListener("click",()=>setAuthMode("login"));$("signupTab").addEventListener("click",()=>setAuthMode("signup"));
$("authForm").addEventListener("submit",handleAuth);$("forgotPasswordButton").addEventListener("click",forgotPassword);
$("logoutButton").addEventListener("click",()=>client.auth.signOut());
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>showView(t.dataset.view)));
$("toggleAllAthletes").addEventListener("click",()=>{const all=athletes.length&&athletes.every(a=>selectedIds.has(a.id));selectedIds=all?new Set():new Set(athletes.map(a=>a.id));renderSessionAthletes()});
$("athleteForm").addEventListener("submit",addAthlete);$("athleteFileInput").addEventListener("change",e=>handleImport(e.target.files[0]));$("downloadTemplateButton").addEventListener("click",downloadAthleteTemplate);
$("prepareTimerButton").addEventListener("click",prepareTimer);$("startAllButton").addEventListener("click",()=>{const a=startAll(session);if(a){actions.push(a);startTicker();updateTimer()}});
$("undoButton").addEventListener("click",()=>{undoAction(session,actions.pop());updateTimer()});$("finishSessionButton").addEventListener("click",finishSession);
$("exportResultsButton").addEventListener("click",exportResults);$("newSessionButton").addEventListener("click",()=>{session=null;$("globalTimer").textContent="00:00.000";showView("sessionView")});

client.auth.onAuthStateChange(async(_event,authSession)=>{if(authSession?.user)await enterApp(authSession.user);else leaveApp()});
const {data:{session:initialSession}}=await client.auth.getSession();if(initialSession?.user)await enterApp(initialSession.user);else leaveApp();
