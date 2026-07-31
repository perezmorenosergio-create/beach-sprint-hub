console.info("Beach Sprint Hub v3.16 coherent modules loaded");
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./config.js?v=316";
import {importAthleteFile,downloadAthleteTemplate} from "./import.js?v=316";
import {formatTime,createSession,athleteTotal,recordTap,startAll,undoAction} from "./timer.js?v=316";
import {createPlanningModule} from "./planning.js?v=316";

const client=window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:true
    }
  }
);
const $=id=>document.getElementById(id);
const normalize=v=>String(v??"").replace(/\s+/g," ").trim();

function withTimeout(promise,milliseconds,message){
  return Promise.race([
    promise,
    new Promise((_,reject)=>{
      window.setTimeout(
        ()=>reject(new Error(message)),
        milliseconds
      );
    })
  ]);
}

let authMode="login",currentUser=null,athletes=[],selectedIds=new Set(),sessions=[];
let session=null,actions=[],ticker=null,lastTap=new Map(),saving=false;
let planningModule=null;
window.BSTPlanningModuleState=()=>({ready:!!planningModule,module:planningModule});
let appLoadToken=0;

const LOCAL_ATHLETES_KEY="bst_local_athletes_v1";

function loadLocalAthletes(){
  try{return JSON.parse(localStorage.getItem(LOCAL_ATHLETES_KEY))||[]}catch{return[]}
}
function saveLocalAthletes(){
  localStorage.setItem(LOCAL_ATHLETES_KEY,JSON.stringify(athletes));
}
function localAthleteId(){
  return `local-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
}

function refreshPlanningAthleteSelector(){
  const select=$("planningAthleteSelect");
  if(!select)return;

  const previous=select.value||"general";
  const source=Array.isArray(athletes)&&athletes.length
    ? athletes
    : loadLocalAthletes();

  const unique=[];
  const seen=new Set();

  source.forEach(athlete=>{
    const name=String(athlete?.name||"").trim();
    const id=String(athlete?.id||"").trim();
    const key=(id||name).toLowerCase();
    if(!name||!key||seen.has(key))return;
    seen.add(key);
    unique.push({id:id||`name-${key}`,name});
  });

  select.replaceChildren();

  const general=document.createElement("option");
  general.value="general";
  general.textContent="Plan general";
  select.appendChild(general);

  unique
    .sort((a,b)=>a.name.localeCompare(b.name,"es"))
    .forEach(athlete=>{
      const option=document.createElement("option");
      option.value=athlete.id;
      option.textContent=athlete.name;
      select.appendChild(option);
    });

  select.value=[...select.options].some(option=>option.value===previous)
    ? previous
    : "general";

  select.disabled=false;
  select.dataset.athleteCount=String(unique.length);
}

window.BSTRefreshPlanningAthletes=refreshPlanningAthleteSelector;

async function syncAthleteInBackground(athlete){
  try{
    const normalizedName=String(athlete.name||"").trim().toLowerCase();
    const {data:existingRows,error:existingError}=await client
      .from("athletes")
      .select("*")
      .eq("user_id",currentUser.id);

    if(existingError)throw existingError;

    const existing=(existingRows||[]).find(row=>
      String(row.name||"").trim().toLowerCase()===normalizedName
    );

    if(existing){
      const index=athletes.findIndex(x=>x.id===athlete.id);
      if(index>=0){
        athletes[index]=existing;
        saveLocalAthletes();
        renderAll();
      }
      return;
    }

    const payload={
      user_id:currentUser.id,
      name:athlete.name,
      club:athlete.club||null,
      category:athlete.category||null,
      bib:athlete.bib||null
    };
    const {data,error}=await client.from("athletes").insert(payload).select().single();
    if(error)throw error;
    const index=athletes.findIndex(x=>x.id===athlete.id);
    if(index>=0){
      const wasSelected=selectedIds.has(athlete.id);
      athletes[index]=data;
      if(wasSelected){selectedIds.delete(athlete.id);selectedIds.add(data.id)}
      saveLocalAthletes();renderAll();
    }
  }catch(error){
    console.warn("Athlete remains local; cloud sync failed:",error);
  }
}

const REMEMBER_EMAIL_KEY="bst_remember_email";
const REMEMBER_ACCESS_KEY="bst_remember_access";

function loadLoginPreferences(){
  const remember=localStorage.getItem(REMEMBER_ACCESS_KEY)!=="false";
  $("rememberAccessInput").checked=remember;

  if(remember){
    $("emailInput").value=localStorage.getItem(REMEMBER_EMAIL_KEY)||"";
  }
}

function saveLoginPreferences(email){
  const remember=$("rememberAccessInput").checked;
  localStorage.setItem(REMEMBER_ACCESS_KEY,String(remember));

  if(remember){
    localStorage.setItem(REMEMBER_EMAIL_KEY,email);
  }else{
    localStorage.removeItem(REMEMBER_EMAIL_KEY);
  }
}

function togglePasswordVisibility(){
  const input=$("passwordInput");
  const showing=input.type==="text";

  input.type=showing?"password":"text";
  $("togglePasswordButton").textContent=showing?"Ver":"Ocultar";
  $("togglePasswordButton").setAttribute(
    "aria-label",
    showing?"Mostrar contraseña":"Ocultar contraseña"
  );
}

function setAuthMessage(text,error=false){$("authMessage").textContent=text;$("authMessage").className=`auth-message ${error?"error":"success"}`}
function setSync(text,state="ok"){$("syncBanner").textContent=text;$("syncBanner").dataset.state=state}
function showView(id){
  if(typeof window.BSTShowView==="function"){
    return window.BSTShowView(id);
  }
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

  const email=normalize($("emailInput").value);
  const password=$("passwordInput").value;
  const fullName=normalize($("fullNameInput").value);

  saveLoginPreferences(email);
  $("authSubmitButton").disabled=true;
  setAuthMessage(authMode==="signup"?"Creando cuenta…":"Entrando…");

  try{
    const operation=authMode==="signup"
      ? client.auth.signUp({
          email,
          password,
          options:{data:{full_name:fullName}}
        })
      : client.auth.signInWithPassword({email,password});

    const result=await withTimeout(
      operation,
      12000,
      "Supabase no ha respondido en 12 segundos. Comprueba la conexión y vuelve a intentarlo."
    );

    const {data,error}=result;
    if(error)throw error;

    if(authMode==="signup"&&!data?.session){
      setAuthMessage("Cuenta creada. Revisa tu correo para confirmar el acceso.");
      return;
    }

    if(data?.user){
      await enterApp(data.user);
    }else{
      throw new Error("No se ha recibido una sesión válida.");
    }
  }catch(error){
    console.error("Authentication failed:",error);

    let message=error?.message||"No se ha podido iniciar sesión.";

    if(/Failed to fetch|NetworkError|Load failed/i.test(message)){
      message="No se puede conectar con Supabase desde este dispositivo. Comprueba internet, desactiva bloqueadores o VPN y vuelve a intentarlo.";
    }else if(/Invalid login credentials/i.test(message)){
      message="Correo o contraseña incorrectos.";
    }else if(/Email not confirmed/i.test(message)){
      message="Debes confirmar el correo antes de iniciar sesión.";
    }

    setAuthMessage(message,true);
  }finally{
    $("authSubmitButton").disabled=false;
  }
}
async function forgotPassword(){
  const email=normalize($("emailInput").value);
  if(!email){setAuthMessage("Escribe primero tu correo electrónico.",true);return}
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin});
  setAuthMessage(error?error.message:"Te hemos enviado un correo para restablecer la contraseña.",!!error);
}
async function enterApp(user){
  const loadToken=++appLoadToken;
  currentUser=user;

  $("passwordInput").value="";
  $("authScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("userEmail").textContent=user.email||"";

  // Immediate first paint from this device.
  athletes=loadLocalAthletes();
  selectedIds=new Set(athletes.slice(0,4).map(a=>a.id));
  renderAll();
  setSync("☁️ Sincronizando…","loading");

  // Never block the interface while waiting for Supabase.
  Promise.allSettled([
    loadAthletes(loadToken),
    loadSessions()
  ]).then(results=>{
    if(loadToken!==appLoadToken)return;

    results.forEach(result=>{
      if(result.status==="rejected"){
        console.warn("Background startup task failed:",result.reason);
      }
    });

    renderAll();

    const failed=results.some(result=>result.status==="rejected");
    setSync(
      failed ? "Datos locales disponibles" : "☁️ Sincronizado",
      failed ? "warning" : "ok"
    );
  });

  // Return immediately so the rest of the interface can finish binding.
  return;
}

async function forceLogout(){
  try{
    setSync("Cerrando sesión…","loading");
  }catch{}

  // Immediately clear the local UI so the user is never trapped.
  appLoadToken++;
  currentUser=null;
  athletes=[];
  sessions=[];
  selectedIds.clear();
  session=null;

  try{
    $("appShell").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
    $("passwordInput").value="";
  }catch{}

  // Best effort cloud logout. UI does not wait for it.
  try{
    await Promise.race([
      client.auth.signOut({scope:"local"}),
      new Promise(resolve=>setTimeout(resolve,2500))
    ]);
  }catch(error){
    console.warn("Supabase logout did not complete, local logout applied:",error);
  }

  // Remove Supabase auth tokens from this browser.
  try{
    Object.keys(localStorage).forEach(key=>{
      if(key.startsWith("sb-") && key.endsWith("-auth-token")){
        localStorage.removeItem(key);
      }
    });
    Object.keys(sessionStorage).forEach(key=>{
      if(key.startsWith("sb-") && key.endsWith("-auth-token")){
        sessionStorage.removeItem(key);
      }
    });
  }catch{}

  window.location.replace(window.location.pathname+"?logout="+Date.now());
}

async function resetMobileApp(){
  if(!confirm("Se borrará la caché y los datos locales de este dispositivo. Los datos sincronizados en Supabase no se eliminan. ¿Continuar?"))return;

  try{
    if("serviceWorker" in navigator){
      const registrations=await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg=>reg.unregister()));
    }
  }catch(error){
    console.warn("Could not unregister service worker:",error);
  }

  try{
    if("caches" in window){
      const names=await caches.keys();
      await Promise.all(names.map(name=>caches.delete(name)));
    }
  }catch(error){
    console.warn("Could not clear caches:",error);
  }

  try{
    Object.keys(localStorage).forEach(key=>{
      if(
        key.startsWith("bst_") ||
        (key.startsWith("sb-") && key.endsWith("-auth-token"))
      ){
        localStorage.removeItem(key);
      }
    });
    sessionStorage.clear();
  }catch{}

  window.location.replace(window.location.pathname+"?reset="+Date.now());
}

function leaveApp(){
  appLoadToken++;
  currentUser=null;athletes=[];sessions=[];selectedIds.clear();session=null;
  $("appShell").classList.add("hidden");$("authScreen").classList.remove("hidden");
}

async function migrateLocalAthletesToCloud(localAthletes){
  if(!currentUser?.id||!localAthletes.length)return localAthletes;

  try{
    const {data:cloudRows,error:cloudError}=await client
      .from("athletes")
      .select("*")
      .eq("user_id",currentUser.id);

    if(cloudError)throw cloudError;

    const cloud=cloudRows||[];
    const byName=new Map(
      cloud.map(row=>[String(row.name||"").trim().toLowerCase(),row])
    );
    const migrated=[];

    for(const athlete of localAthletes){
      const key=String(athlete.name||"").trim().toLowerCase();
      if(!key)continue;

      const existing=byName.get(key);
      if(existing){
        migrated.push(existing);
        continue;
      }

      const payload={
        user_id:currentUser.id,
        name:athlete.name,
        club:athlete.club||null,
        category:athlete.category||null,
        bib:athlete.bib||null
      };

      const {data,error}=await client
        .from("athletes")
        .insert(payload)
        .select()
        .single();

      if(error){
        console.warn(`Could not migrate athlete ${athlete.name}:`,error);
        migrated.push(athlete);
        continue;
      }

      byName.set(key,data);
      migrated.push(data);

      // Move locally stored plans from the temporary id to the cloud id.
      if(String(athlete.id).startsWith("local-")){
        try{
          const plans=JSON.parse(localStorage.getItem("bst_trainer_athlete_plans_v1")||"{}");
          if(plans[athlete.id]&&!plans[data.id]){
            plans[data.id]=plans[athlete.id];
            delete plans[athlete.id];
            localStorage.setItem("bst_trainer_athlete_plans_v1",JSON.stringify(plans));
          }
        }catch(error){
          console.warn("Could not migrate local plan key:",error);
        }
      }
    }

    // Include cloud athletes that were not present locally.
    for(const row of cloud){
      const exists=migrated.some(item=>item.id===row.id);
      if(!exists)migrated.push(row);
    }

    return migrated.sort((a,b)=>
      String(a.name||"").localeCompare(String(b.name||""),"es")
    );
  }catch(error){
    console.warn("Automatic athlete cloud migration failed:",error);
    return localAthletes;
  }
}

async function loadAthletes(loadToken=appLoadToken){
  const originalLocal=loadLocalAthletes();
  const local=await migrateLocalAthletesToCloud(originalLocal);

  if(loadToken!==appLoadToken)return;

  athletes=local;
  saveLocalAthletes();
  selectedIds=new Set(athletes.slice(0,4).map(a=>a.id));

  // Make local data visible before waiting for the network.
  renderSessionAthletes();
  renderAthletes();
  try{
    planningModule?.setAthletes(athletes,currentUser?.id);
  }catch(error){
    console.error("Planning athlete refresh failed:",error);
  }

  try{
    const response=await withTimeout(
      client.from("athletes").select("*").eq("user_id",currentUser.id).order("name"),
      8000,
      "La sincronización de deportistas ha tardado demasiado."
    );

    if(loadToken!==appLoadToken)return;

    const {data,error}=response;
    if(error)throw error;

    if(data){
      const cloudNames=new Set(data.map(x=>String(x.name||"").toLowerCase()));
      const unsynced=local.filter(x=>
        String(x.id).startsWith("local-") &&
        !cloudNames.has(String(x.name||"").toLowerCase())
      );

      athletes=[...data,...unsynced].sort((a,b)=>
        String(a.name||"").localeCompare(String(b.name||""),"es")
      );

      saveLocalAthletes();
      selectedIds=new Set(athletes.slice(0,4).map(a=>a.id));

      // Second paint with the complete cloud + local list.
      renderSessionAthletes();
      renderAthletes();
      try{
    planningModule?.setAthletes(athletes,currentUser?.id);
  }catch(error){
    console.error("Planning athlete refresh failed:",error);
  }
    }
  }catch(error){
    console.warn("Using local athletes:",error);
    if(loadToken===appLoadToken){
      setSync("Deportistas cargados del dispositivo","ok");
    }
  }
}
async function loadSessions(){
  try{
    const response=await withTimeout(
      client
        .from("sessions")
        .select("*")
        .order("session_date",{ascending:false})
        .limit(100),
      8000,
      "La carga del historial ha tardado demasiado."
    );

    const {data,error}=response;
    if(error)throw error;
    sessions=data||[];
  }catch(error){
    console.warn("Sessions could not be loaded; keeping local interface active:",error);
    sessions=sessions||[];
  }
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
    del.addEventListener("click",async()=>{
      if(!confirm(`¿Eliminar a ${a.name}?`))return;

      setSync("☁️ Eliminando…","loading");

      // Remove immediately from the current device.
      athletes=athletes.filter(x=>x.id!==a.id);
      selectedIds.delete(a.id);
      saveLocalAthletes();
      renderAll();

      // Local-only athletes do not exist in Supabase yet.
      if(String(a.id).startsWith("local-")){
        setSync("Eliminado del dispositivo","ok");
        return;
      }

      try{
        const {error}=await client.from("athletes").delete().eq("id",a.id);
        if(error)throw error;

        // Remove cloud planning data linked to this athlete.
        await Promise.allSettled([
          client.from("athlete_plans").delete().eq("athlete_id",a.id),
          client.from("week_comments").delete().eq("athlete_id",a.id),
          client.from("training_completion").delete().eq("athlete_id",a.id)
        ]);

        setSync("☁️ Deportista eliminado","ok");
      }catch(error){
        console.error(error);
        setSync("No se pudo eliminar en la nube","error");
        alert(`Se eliminó del dispositivo, pero Supabase devolvió: ${error.message}`);
      }
    });
    row.append(text,del);box.append(row);
  });
}
async function addAthlete(event){
  event.preventDefault();
  const name=normalize($("athleteName").value);
  if(!name)return;
  if(athletes.some(a=>a.name.toLowerCase()===name.toLowerCase())){
    setImport("Ese deportista ya existe.",true);return;
  }
  const athlete={
    id:localAthleteId(),
    name,
    club:normalize($("athleteClub").value)||"",
    category:normalize($("athleteCategory").value)||"",
    bib:normalize($("athleteBib").value)||"",
    sync_status:"pending"
  };
  athletes.push(athlete);
  athletes.sort((a,b)=>a.name.localeCompare(b.name,"es"));
  selectedIds.add(athlete.id);
  saveLocalAthletes();
  event.target.reset();
  renderAll();
  setImport(`${name} añadido. Sincronizando en segundo plano…`);
  setSync("Guardado en el dispositivo","ok");
  syncAthleteInBackground(athlete);
}
function setImport(text,error=false){$("importMessage").textContent=text;$("importMessage").style.color=error?"#b91c1c":"#166534"}
async function handleImport(file){
  if(!file){
    setImport("No se ha seleccionado ningún archivo.",true);
    return;
  }

  setImport(`Archivo seleccionado: ${file.name}. Preparando lectura…`);
  const input=$("athleteFileInput");
  input.disabled=true;
  setImport(`Leyendo ${file.name}…`);
  setSync("Procesando archivo…","loading");
  try{
    const imported=await importAthleteFile(file);
    const names=new Set(athletes.map(x=>x.name.toLowerCase()));
    const added=[];
    for(const row of imported){
      const key=row.name.toLowerCase();
      if(names.has(key))continue;
      names.add(key);
      const athlete={id:localAthleteId(),name:row.name,club:row.club||"",category:row.category||"",bib:row.bib||"",sync_status:"pending"};
      athletes.push(athlete);selectedIds.add(athlete.id);added.push(athlete);
    }
    athletes.sort((a,b)=>a.name.localeCompare(b.name,"es"));
    saveLocalAthletes();
    renderAll();

    if(!added.length){
      setImport(`El archivo se leyó correctamente, pero todos los deportistas ya existían.`);
      setSync("Sin cambios","ok");
    }else{
      setImport(`${added.length} deportistas importados. Sincronizando en segundo plano…`);
      setSync("Guardado en el dispositivo","ok");
      added.forEach((athlete,index)=>setTimeout(()=>syncAthleteInBackground(athlete),index*250));
    }
  }catch(error){
    console.error("Athlete import failed:",error);
    setImport(error.message||"No se pudo importar el archivo.",true);
    setSync("Error al importar","error");
  }finally{
    input.value="";
    input.disabled=false;
  }
}

window.BSTImportAthleteFile=handleImport;
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
function renderAll(){
  renderSessionAthletes();
  renderAthletes();
  renderHistory();
  refreshPlanningAthleteSelector();
  try{
    planningModule?.setAthletes(athletes,currentUser?.id);
  }catch(error){
    console.error("Planning athlete refresh failed:",error);
  }
}



window.setTimeout(()=>{
  const banner=$("syncBanner");
  if(banner?.dataset.state==="loading"){
    setSync("Datos locales disponibles","warning");
  }
},10000);

window.setInterval(()=>{
  const button=$("authSubmitButton");
  const message=$("authMessage");
  if(
    button?.disabled &&
    /Entrando|Creando cuenta/i.test(message?.textContent||"")
  ){
    const started=Number(button.dataset.startedAt||0);
    if(!started){
      button.dataset.startedAt=String(Date.now());
    }else if(Date.now()-started>15000){
      button.disabled=false;
      button.dataset.startedAt="";
      setAuthMessage("El acceso ha tardado demasiado. Inténtalo de nuevo.",true);
    }
  }else if(button){
    button.dataset.startedAt="";
  }
},1000);

loadLoginPreferences();
$("togglePasswordButton").addEventListener("click",togglePasswordVisibility);
$("rememberAccessInput").addEventListener("change",()=>{
  const remember=$("rememberAccessInput").checked;
  localStorage.setItem(REMEMBER_ACCESS_KEY,String(remember));
  if(!remember)localStorage.removeItem(REMEMBER_EMAIL_KEY);
});


// Core navigation is registered before optional modules so the app can never be frozen by them.
$("loginTab").addEventListener("click",()=>setAuthMode("login"));
$("signupTab").addEventListener("click",()=>setAuthMode("signup"));
$("authForm").addEventListener("submit",handleAuth);
$("forgotPasswordButton").addEventListener("click",forgotPassword);
$("logoutButton").addEventListener("click",forceLogout);
$("resetAppButton").addEventListener("click",resetMobileApp);

document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click",event=>{
    event.preventDefault();
    const viewId=tab.dataset.view;
    if(viewId)showView(viewId);
    if(viewId==="planningView"){
      refreshPlanningAthleteSelector();
      try{
        planningModule?.setAthletes(athletes,currentUser?.id);
      }catch(error){
        console.warn("Planning selector refresh failed:",error);
      }
    }
  });
});

try {
planningModule=createPlanningModule({
  supabase:client,
  getCurrentUser:()=>currentUser,
  input:$("annualPlanFileInput"),
  message:$("planningImportMessage"),
  emptyState:$("planningEmptyState"),
  content:$("planningContent"),
  athleteSelect:$("planningAthleteSelect"),
  seasonTimeline:$("seasonTimeline"),
  timelinePrevButton:$("timelinePrevButton"),
  timelineNextButton:$("timelineNextButton"),
  currentWeekTitle:$("currentWeekTitle"),
  currentWeekMeta:$("currentWeekMeta"),
  currentWeekProgressText:$("currentWeekProgressText"),
  currentWeekProgressBar:$("currentWeekProgressBar"),
  todayTrainingCard:$("todayTrainingCard"),
  currentWeekDays:$("currentWeekDays"),
  currentWeekZones:$("currentWeekZones"),
  currentWeekStats:$("currentWeekStats"),
  goToSelectedWeekButton:$("goToSelectedWeekButton"),
  weekCommentsList:$("weekCommentsList"),
  weekCommentForm:$("weekCommentForm"),
  weekCommentInput:$("weekCommentInput"),
  weekCommentsSyncState:$("weekCommentsSyncState"),
  weeksKpi:$("planningWeeksKpi"),
  hoursKpi:$("planningHoursKpi"),
  sessionsKpi:$("planningSessionsKpi"),
  eventsKpi:$("planningEventsKpi"),
  annualCalendarGrid:$("annualCalendarGrid"),
  annualCalendarYear:$("annualCalendarYear"),
  annualEventsList:$("annualEventsList"),
  addCalendarNoteButton:$("addCalendarNoteButton"),
  calendarNoteDialog:$("calendarNoteDialog"),
  calendarNoteForm:$("calendarNoteForm"),
  calendarNoteDate:$("calendarNoteDate"),
  calendarNoteType:$("calendarNoteType"),
  calendarNoteTitle:$("calendarNoteTitle"),
  calendarNoteText:$("calendarNoteText"),
  cancelCalendarNote:$("cancelCalendarNote"),
  weekSelector:$("weekSelector"),
  selectedWeekTitle:$("selectedWeekTitle"),
  selectedWeekMeta:$("selectedWeekMeta"),
  weeklySheet:$("weeklySheet"),
  selectedWeekTotals:$("selectedWeekTotals"),
  phaseFilter:$("planningPhaseFilter"),
  annualWeeksSummary:$("annualWeeksSummary"),
  librarySearch:$("trainingLibrarySearch"),
  libraryTable:$("trainingLibraryTable")
});
window.BSTPlanningModule=planningModule;
console.info("Planning module ready", planningModule);
} catch (error) {
  console.error("Planning module construction failed:",error);
  planningModule=null;
  const message=$("planningImportMessage");
  if(message){
    message.textContent=`No se pudo construir el módulo de planificación: ${error?.message||error}`;
    message.className="planning-message error";
  }
}

refreshPlanningAthleteSelector();
if(planningModule){
  try{
    planningModule.setAthletes(athletes,currentUser?.id);
  }catch(error){
    console.error("Planning athlete initialization failed:",error);
    const message=$("planningImportMessage");
    if(message){
      message.textContent="Planificación iniciada. Se ha ignorado un plan local incompatible; ya puedes importar el Excel.";
      message.className="planning-message warning";
    }
    try{ planningModule.resetCurrentPlan?.(); }catch(_error){}
  }
}



const planningAthleteSelect=$("planningAthleteSelect");
if(planningAthleteSelect){
  ["focus","pointerdown","touchstart"].forEach(eventName=>{
    planningAthleteSelect.addEventListener(eventName,()=>{
      refreshPlanningAthleteSelector();
    },{passive:true});
  });
}

$("toggleAllAthletes").addEventListener("click",()=>{const all=athletes.length&&athletes.every(a=>selectedIds.has(a.id));selectedIds=all?new Set():new Set(athletes.map(a=>a.id));renderSessionAthletes()});
$("athleteForm").addEventListener("submit",addAthlete);
const athleteFileInput=$("athleteFileInput");
if(athleteFileInput){
  athleteFileInput.addEventListener("change",event=>{
    const file=event.target.files?.[0];
    setImport(file?`Archivo seleccionado: ${file.name}`:"No se seleccionó ningún archivo.",!file);
    handleImport(file);
  });
}
$("downloadTemplateButton").addEventListener("click",downloadAthleteTemplate);
$("prepareTimerButton").addEventListener("click",prepareTimer);$("startAllButton").addEventListener("click",()=>{const a=startAll(session);if(a){actions.push(a);startTicker();updateTimer()}});
$("undoButton").addEventListener("click",()=>{undoAction(session,actions.pop());updateTimer()});$("finishSessionButton").addEventListener("click",finishSession);
$("exportResultsButton").addEventListener("click",exportResults);$("newSessionButton").addEventListener("click",()=>{session=null;$("globalTimer").textContent="00:00.000";showView("sessionView")});

client.auth.onAuthStateChange(async(_event,authSession)=>{
  const forcedLogout=new URLSearchParams(location.search).has("logout");
  const forcedReset=new URLSearchParams(location.search).has("reset");

  if(forcedLogout||forcedReset){
    leaveApp();
    return;
  }

  if(authSession?.user)enterApp(authSession.user);
  else leaveApp();
});
const forcedLogout=new URLSearchParams(location.search).has("logout");
const forcedReset=new URLSearchParams(location.search).has("reset");

if(forcedLogout||forcedReset){
  leaveApp();
  history.replaceState({},document.title,location.pathname);
}else{
  const {data:{session:initialSession}}=await client.auth.getSession();
  if(initialSession?.user)enterApp(initialSession.user);
  else leaveApp();
}
