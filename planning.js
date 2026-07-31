
const PLANS_STORAGE_KEY="bst_trainer_athlete_plans_v1";
const NOTES_STORAGE_KEY="bst_trainer_calendar_notes_v1";
const COMPLETION_STORAGE_KEY="bst_training_completion_v1";

const normalizeText=value=>String(value??"").replace(/\s+/g," ").trim();

function excelDateToISO(serial){
  if(!serial || typeof serial!=="number")return null;
  const utcDays=Math.floor(serial-25569);
  return new Date(utcDays*86400*1000).toISOString().slice(0,10);
}
function formatDate(iso){
  if(!iso)return"—";
  return new Intl.DateTimeFormat("es-ES",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${iso}T12:00:00`));
}
function parseISODate(iso){
  return new Date(`${iso}T12:00:00`);
}
function addDaysISO(iso,days){
  const date=parseISODate(iso);
  date.setDate(date.getDate()+days);
  return date.toISOString().slice(0,10);
}
function shortDate(iso){
  if(!iso)return"—";
  return new Intl.DateTimeFormat("es-ES",{day:"2-digit",month:"short"}).format(parseISODate(iso));
}
function monthYear(iso){
  if(!iso)return"";
  return new Intl.DateTimeFormat("es-ES",{month:"short",year:"2-digit"}).format(parseISODate(iso));
}
function parseSheetRows(workbook,name){
  const sheet=workbook.Sheets[name];
  return sheet?window.XLSX.utils.sheet_to_json(sheet,{header:1,defval:"",raw:true,blankrows:false}):[];
}
function mapSummary(rows){
  return rows.slice(3).map(row=>({
    index:Number(row[0])||null,event:normalizeText(row[1]),eventDate:normalizeText(row[2]),
    observations:normalizeText(row[3]),startDate:excelDateToISO(row[4]),endDate:excelDateToISO(row[5]),
    week:Number(row[6])||null,load:Number(row[7])||0,phase:normalizeText(row[8]),
    macrocycle:normalizeText(row[9]),accumulated:Number(row[10])||0,minutes:Number(row[11])||0,
    zones:{z1:Number(row[12])||0,z2:Number(row[13])||0,z3:Number(row[14])||0,z4:Number(row[15])||0,
      z5:Number(row[16])||0,z6:Number(row[17])||0,weights:Number(row[18])||0,other:Number(row[19])||0},
    hours:Number(row[20])||0
  })).filter(x=>x.week);
}
function mapPlan(rows){
  return rows.slice(1).map(row=>({
    code:Number(row[0])||null,week:Number(row[1])||null,date:excelDateToISO(row[2]),dayDate:excelDateToISO(row[3]),
    training:normalizeText(row[4]),time:Number(row[5])||0,rpe:normalizeText(row[6]),
    zones:{z1:Number(row[7])||0,z2:Number(row[8])||0,z3:Number(row[9])||0,z4:Number(row[10])||0,
      z5:Number(row[11])||0,z6:Number(row[12])||0,weights:Number(row[13])||0,other:Number(row[14])||0}
  })).filter(x=>x.week&&(x.training||x.date));
}
function mapTrainingLibrary(rows){
  return rows.slice(1).map(row=>({
    name:normalizeText(row[0]),rpe:normalizeText(row[1]),
    zones:{z1:Number(row[2])||0,z2:Number(row[3])||0,z3:Number(row[4])||0,z4:Number(row[5])||0,
      z5:Number(row[6])||0,z6:Number(row[7])||0,weights:Number(row[8])||0,other:Number(row[9])||0},
    total:Number(row[10])||0
  })).filter(x=>x.name);
}
function buildAnnualPlan(workbook,fileName){
  const summary=mapSummary(parseSheetRows(workbook,"Summary"));
  const sessions=mapPlan(parseSheetRows(workbook,"Plan"));
  const trainingLibrary=mapTrainingLibrary(parseSheetRows(workbook,"Training"));
  if(!summary.length||!sessions.length)throw new Error("El Excel no contiene Summary y Plan con la estructura esperada.");
  return{importedAt:new Date().toISOString(),fileName,summary,sessions,trainingLibrary};
}
function loadJSON(key,fallback){
  try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}
}
function saveJSON(key,value){localStorage.setItem(key,JSON.stringify(value))}
function loadXLSX(){
  return new Promise((resolve,reject)=>{
    if(window.XLSX)return resolve(window.XLSX);
    const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload=()=>resolve(window.XLSX);s.onerror=()=>reject(new Error("No se pudo cargar el lector de Excel."));document.head.appendChild(s);
  });
}
function dayName(iso){
  return new Intl.DateTimeFormat("es-ES",{weekday:"long",day:"2-digit",month:"short"}).format(new Date(`${iso}T12:00:00`));
}
function mondayOfWeek(year,week){
  const jan4=new Date(Date.UTC(year,0,4));
  const day=jan4.getUTCDay()||7;
  const monday=new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate()-day+1+(week-1)*7);
  return monday;
}
function iso(d){return d.toISOString().slice(0,10)}

export function createPlanningModule(els){
  const supabase=els.supabase;
  let plansByAthlete=loadJSON(PLANS_STORAGE_KEY,{});
  let notes=loadJSON(NOTES_STORAGE_KEY,[]);
  let completion=loadJSON(COMPLETION_STORAGE_KEY,{});
  let weekComments=[];
  let athleteId="general";
  let userId="anonymous";
  let plan=plansByAthlete[athleteId]||null;
  let selectedWeek=null;
  let libraryFilter="";
  let cloudLoadToken=0;

  function planKey(){
    return `${userId}:${athleteId}`;
  }

  function completionKey(date,training,index){
    return `${planKey()}:${date}:${index}:${training}`;
  }

  function saveCurrentPlan(){
    plansByAthlete[athleteId]=plan;
    saveJSON(PLANS_STORAGE_KEY,plansByAthlete);
    syncCurrentPlanToCloud();
  }

  async function syncCurrentPlanToCloud(){
    if(!supabase||!userId||userId==="anonymous"||!plan)return;
    try{
      const row={
        user_id:userId,
        athlete_id:athleteId,
        plan_data:plan,
        updated_at:new Date().toISOString()
      };
      const {error}=await supabase
        .from("athlete_plans")
        .upsert(row,{onConflict:"user_id,athlete_id"});
      if(error)throw error;
    }catch(error){
      console.warn("Plan kept locally; cloud plan sync failed:",error);
    }
  }

  async function loadPlanFromCloud(){
    if(!supabase||!userId||userId==="anonymous")return;
    const token=++cloudLoadToken;
    try{
      const {data,error}=await supabase
        .from("athlete_plans")
        .select("plan_data,updated_at")
        .eq("user_id",userId)
        .eq("athlete_id",athleteId)
        .maybeSingle();

      if(error)throw error;
      if(token!==cloudLoadToken)return;

      if(data?.plan_data){
        plan=data.plan_data;
        plansByAthlete[athleteId]=plan;
        saveJSON(PLANS_STORAGE_KEY,plansByAthlete);
        selectedWeek=findCurrentWeek()?.week||plan.summary?.[0]?.week||null;
        render();
      }
    }catch(error){
      console.warn("Cloud plan load failed; using local copy:",error);
    }
  }

  const setMessage=(text,error=false)=>{
    els.message.textContent=text;
    els.message.className=`planning-message ${error?"error":"success"}`;
  };
  const renderKpis=()=>{
    els.weeksKpi.textContent=plan.summary.length;
    els.hoursKpi.textContent=plan.summary.reduce((s,x)=>s+x.hours,0).toFixed(1);
    els.sessionsKpi.textContent=plan.sessions.filter(x=>x.training).length;
    els.eventsKpi.textContent=plan.summary.filter(x=>x.event).length+notes.length;
  };
  const renderSubnav=()=>{
    document.querySelectorAll(".planning-subtab").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll(".planning-subtab").forEach(x=>x.classList.toggle("active",x===btn));
      document.querySelectorAll(".planning-panel").forEach(panel=>panel.classList.toggle("active",panel.id===btn.dataset.planningView));
    }));
  };
  const buildYears=()=>{
    const years=new Set();
    plan.summary.forEach(x=>{if(x.startDate)years.add(Number(x.startDate.slice(0,4)))});
    notes.forEach(x=>years.add(Number(x.date.slice(0,4))));
    const ordered=[...years].sort();
    els.annualCalendarYear.replaceChildren();
    ordered.forEach(y=>{const o=document.createElement("option");o.value=y;o.textContent=y;els.annualCalendarYear.append(o)});
  };
  const planEventsForDate=date=>{
    const events=[];
    plan.summary.forEach(x=>{
      if(x.startDate===date&&x.event)events.push({type:"plan",title:x.event});
    });
    notes.filter(x=>x.date===date).forEach(x=>events.push({type:x.type,title:x.title,id:x.id}));
    return events;
  };
  const renderCalendar=()=>{
    const year=Number(els.annualCalendarYear.value)||new Date().getFullYear();
    els.annualCalendarGrid.replaceChildren();
    for(let month=0;month<12;month++){
      const monthBox=document.createElement("section");monthBox.className="year-month";
      const title=document.createElement("h3");
      title.textContent=new Intl.DateTimeFormat("es-ES",{month:"long"}).format(new Date(year,month,1));
      monthBox.append(title);
      const weekHeader=document.createElement("div");weekHeader.className="month-weekdays";
      ["L","M","X","J","V","S","D"].forEach(d=>{const s=document.createElement("span");s.textContent=d;weekHeader.append(s)});
      monthBox.append(weekHeader);
      const grid=document.createElement("div");grid.className="month-days";
      const first=new Date(year,month,1);const offset=(first.getDay()+6)%7;
      for(let i=0;i<offset;i++)grid.append(document.createElement("span"));
      const days=new Date(year,month+1,0).getDate();
      for(let day=1;day<=days;day++){
        const date=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const cell=document.createElement("button");cell.type="button";cell.className="calendar-day";cell.innerHTML=`<span>${day}</span>`;
        const events=planEventsForDate(date);
        events.forEach(ev=>{const dot=document.createElement("i");dot.className=`calendar-dot ${ev.type}`;dot.title=ev.title;cell.append(dot)});
        cell.addEventListener("click",()=>{els.calendarNoteDate.value=date;els.calendarNoteDialog.showModal()});
        grid.append(cell);
      }
      monthBox.append(grid);els.annualCalendarGrid.append(monthBox);
    }
  };
  const renderEvents=()=>{
    const planEvents=plan.summary.filter(x=>x.event&&x.startDate).map(x=>({id:`plan-${x.week}`,date:x.startDate,type:"plan",title:x.event,notes:`Semana ${x.week}`}));
    const all=[...planEvents,...notes].sort((a,b)=>a.date.localeCompare(b.date));
    els.annualEventsList.innerHTML=all.length?all.map(x=>`
      <article class="annual-event-item">
        <div><span class="event-type ${x.type}">${x.type}</span><strong>${x.title}</strong><small>${formatDate(x.date)}${x.notes?` · ${x.notes}`:""}</small></div>
        ${String(x.id).startsWith("plan-")?"":`<button class="delete-note" data-id="${x.id}" type="button">×</button>`}
      </article>`).join(""):'<div class="empty-state">No hay eventos ni anotaciones.</div>';
    els.annualEventsList.querySelectorAll(".delete-note").forEach(btn=>btn.addEventListener("click",()=>{
      notes=notes.filter(x=>x.id!==btn.dataset.id);saveJSON(NOTES_STORAGE_KEY,notes);renderCalendar();renderEvents();renderKpis();
    }));
  };
  const renderWeekSelector=()=>{
    els.weekSelector.replaceChildren();
    plan.summary.forEach(x=>{const o=document.createElement("option");o.value=x.week;o.textContent=`Semana ${x.week} · ${x.phase||"Sin fase"}`;els.weekSelector.append(o)});
    if(!selectedWeek)selectedWeek=plan.summary[0]?.week;
    els.weekSelector.value=selectedWeek;
  };
  const renderWeeklySheet=()=>{
    const summary=plan.summary.find(x=>x.week===selectedWeek);if(!summary)return;
    els.selectedWeekTitle.textContent=`Semana ${summary.week}`;
    els.selectedWeekMeta.innerHTML=[
      `${formatDate(summary.startDate)} – ${formatDate(summary.endDate)}`,
      summary.phase||"Sin fase",`Macrociclo ${summary.macrocycle||"—"}`,
      `${Math.round(summary.load*100)}% carga`,`${summary.hours.toFixed(1)} h`,
      summary.event||""
    ].filter(Boolean).map(x=>`<span>${x}</span>`).join("");
    const seasonWeekStart=summary.startDate;
    const sessions=plan.sessions.filter(x=>x.week===selectedWeek);
    let currentDate=null;const byDate={};
    sessions.forEach(x=>{if(x.date)currentDate=x.date;const d=x.date||currentDate;if(!d)return;(byDate[d]??=[]).push(x)});
    const dayCols=[];
    for(let i=0;i<7;i++){
      const key=addDaysISO(seasonWeekStart,i);
      dayCols.push({date:key,sessions:byDate[key]||[]});
    }
    els.weeklySheet.innerHTML=`
      <div class="weekly-sheet-grid">
        ${dayCols.map(day=>`
          <section class="weekly-day-column">
            <header>${dayName(day.date)}</header>
            <div class="weekly-day-sessions">
              ${day.sessions.filter(x=>x.training).map((x,i)=>`
                <article class="weekly-session-card">
                  <span class="session-order">${i+1}</span>
                  <strong>${x.training}</strong>
                  <small>${x.time?`${x.time} min`:""}${x.rpe?` · RPE ${x.rpe}`:""}</small>
                  <div class="session-zone-chips">${Object.entries(x.zones).filter(([,v])=>v).map(([z,v])=>`<span>${z.toUpperCase()} ${v}</span>`).join("")}</div>
                </article>`).join("")||'<div class="weekly-rest">Descanso / sin sesión</div>'}
            </div>
          </section>`).join("")}
      </div>`;
    els.selectedWeekTotals.innerHTML=Object.entries(summary.zones).map(([z,v])=>`
      <article><span>${z.toUpperCase()}</span><strong>${v}</strong><small>min</small></article>`).join("")+
      `<article class="total-hours"><span>Total</span><strong>${summary.hours.toFixed(1)}</strong><small>h</small></article>`;
  };
  const renderAnnualSummary=()=>{
    const phase=els.phaseFilter.value;
    const rows=(phase?plan.summary.filter(x=>x.phase===phase):plan.summary);
    els.annualWeeksSummary.innerHTML=`
      <table><thead><tr><th>Semana</th><th>Fechas</th><th>Fase</th><th>Macro</th><th>Carga</th><th>Horas</th><th>Evento</th></tr></thead>
      <tbody>${rows.map(x=>`<tr><td><strong>S${x.week}</strong></td><td>${formatDate(x.startDate)} – ${formatDate(x.endDate)}</td><td>${x.phase||"—"}</td><td>${x.macrocycle||"—"}</td><td>${Math.round(x.load*100)}%</td><td>${x.hours.toFixed(1)}</td><td>${x.event||""}</td></tr>`).join("")}</tbody></table>`;
  };
  const renderPhaseFilter=()=>{
    els.phaseFilter.innerHTML='<option value="">Todas las fases</option>';
    [...new Set(plan.summary.map(x=>x.phase).filter(Boolean))].forEach(p=>{const o=document.createElement("option");o.value=p;o.textContent=p;els.phaseFilter.append(o)});
  };
  const libraryCategory=item=>{
    const z=item.zones;
    if(z.weights)return"weights";
    if(z.other)return"other";
    if(z.z5||z.z6)return"z5";
    if(z.z3||z.z4)return"z3";
    return"z1";
  };
  const renderLibrary=()=>{
    const search=normalizeText(els.librarySearch.value).toLowerCase();
    const items=plan.trainingLibrary.filter(x=>(!search||x.name.toLowerCase().includes(search))&&(!libraryFilter||libraryCategory(x)===libraryFilter));
    els.libraryTable.innerHTML=`<table><thead><tr><th>Sesión</th><th>RPE</th><th>Total</th><th>Z1</th><th>Z2</th><th>Z3</th><th>Z4</th><th>Z5</th><th>Z6</th><th>Fuerza</th><th>Otros</th></tr></thead>
      <tbody>${items.slice(0,300).map(x=>`<tr><td><strong>${x.name}</strong></td><td>${x.rpe||"—"}</td><td>${x.total||0}</td><td>${x.zones.z1||0}</td><td>${x.zones.z2||0}</td><td>${x.zones.z3||0}</td><td>${x.zones.z4||0}</td><td>${x.zones.z5||0}</td><td>${x.zones.z6||0}</td><td>${x.zones.weights||0}</td><td>${x.zones.other||0}</td></tr>`).join("")}</tbody></table>`;
  };

  function findCurrentWeek(){
    if(!plan?.summary?.length)return null;
    const today=new Date();
    today.setHours(12,0,0,0);

    let exact=plan.summary.find(item=>{
      if(!item.startDate||!item.endDate)return false;
      const start=new Date(`${item.startDate}T00:00:00`);
      const end=new Date(`${item.endDate}T23:59:59`);
      return today>=start&&today<=end;
    });

    if(exact)return exact;

    const future=plan.summary.find(item=>
      item.startDate && new Date(`${item.startDate}T00:00:00`)>=today
    );

    return future||plan.summary[0];
  }

  function sessionsByDayForWeek(week){
    const sessions=plan.sessions.filter(item=>item.week===week);
    const byDate={};
    let currentDate=null;

    sessions.forEach(item=>{
      if(item.date)currentDate=item.date;
      const date=item.date||currentDate;
      if(!date)return;
      (byDate[date]??=[]).push(item);
    });

    return byDate;
  }


  function loadClass(load,event){
    if(event)return"event";
    if(load>=.9)return"high";
    if(load>=.75)return"build";
    return"recovery";
  }

  function scrollTimelineWeekIntoView(week,smooth=false){
    const card=els.seasonTimeline.querySelector(`[data-season-week="${week}"]`);
    card?.scrollIntoView({
      behavior:smooth?"smooth":"auto",
      block:"nearest",
      inline:"center"
    });
  }

  function selectSeasonWeek(week,openDetailed=false){
    selectedWeek=Number(week);
    els.weekSelector.value=String(selectedWeek);
    renderWeeklySheet();
    renderSeasonTimeline();

    if(openDetailed){
      document.querySelector('[data-planning-view="weeklyPlanningPanel"]')?.click();
    }
  }

  function renderSeasonTimeline(){
    if(!plan?.summary?.length)return;

    const current=findCurrentWeek();
    const chosen=selectedWeek||current?.week||plan.summary[0].week;
    els.seasonTimeline.replaceChildren();

    let previousMonth="";

    plan.summary.forEach(item=>{
      const currentMonth=monthYear(item.startDate);

      if(currentMonth!==previousMonth){
        const divider=document.createElement("div");
        divider.className="timeline-month-divider";
        divider.innerHTML=`<span>${currentMonth}</span>`;
        els.seasonTimeline.appendChild(divider);
        previousMonth=currentMonth;
      }

      const button=document.createElement("button");
      const status=loadClass(item.load,item.event);
      button.type="button";
      button.dataset.seasonWeek=item.week;
      button.className=[
        "season-week-node",
        `timeline-${status}`,
        item.week===chosen?"selected":"",
        item.week===current?.week?"current":""
      ].filter(Boolean).join(" ");

      button.innerHTML=`
        <div class="timeline-node-head">
          <span>SEM</span>
          <strong>${item.week}</strong>
        </div>
        <div class="timeline-node-dates">
          ${shortDate(item.startDate)}–${shortDate(item.endDate)}
        </div>
        <div class="timeline-node-load">
          <i style="height:${Math.max(12,Math.round(item.load*56))}px"></i>
          <b>${Math.round(item.load*100)}%</b>
        </div>
        <div class="timeline-node-info">
          <span>${item.phase||"—"}</span>
          <span>${item.hours.toFixed(1)} h</span>
        </div>
        ${item.event?`<div class="timeline-node-event">${item.event}</div>`:""}
      `;

      button.addEventListener("click",()=>selectSeasonWeek(item.week,true));
      els.seasonTimeline.appendChild(button);
    });

    requestAnimationFrame(()=>scrollTimelineWeekIntoView(chosen));
  }


  async function syncCompletionToCloud(key,completed){
    if(!supabase||!userId||userId==="anonymous")return;
    try{
      const {error}=await supabase.from("training_completion").upsert({
        user_id:userId,
        athlete_id:athleteId,
        completion_key:key,
        completed:Boolean(completed),
        updated_at:new Date().toISOString()
      },{onConflict:"user_id,athlete_id,completion_key"});
      if(error)throw error;
    }catch(error){
      console.warn("Completion kept locally:",error);
    }
  }

  async function loadCompletionFromCloud(){
    if(!supabase||!userId||userId==="anonymous")return;
    try{
      const {data,error}=await supabase
        .from("training_completion")
        .select("completion_key,completed")
        .eq("user_id",userId)
        .eq("athlete_id",athleteId);
      if(error)throw error;
      (data||[]).forEach(row=>completion[row.completion_key]=row.completed);
      saveJSON(COMPLETION_STORAGE_KEY,completion);
      renderCurrentWeek();
    }catch(error){
      console.warn("Cloud completion load failed:",error);
    }
  }

  function commentWeek(){
    return selectedWeek||findCurrentWeek()?.week||null;
  }

  function renderWeekComments(){
    const week=commentWeek();
    const rows=weekComments
      .filter(item=>Number(item.week_number)===Number(week))
      .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));

    els.weekCommentsList.innerHTML=rows.length
      ? rows.map(item=>`
        <article class="week-comment">
          <div class="week-comment-head">
            <strong>${item.author_name||"Entrenador"}</strong>
            <small>${new Intl.DateTimeFormat("es-ES",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(item.created_at))}</small>
          </div>
          <p>${String(item.comment_text||"").replace(/[<>&]/g,ch=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</p>
        </article>`).join("")
      : '<div class="empty-state">Todavía no hay comentarios en esta semana.</div>';
  }

  async function loadWeekComments(){
    if(!supabase||!userId||userId==="anonymous"){
      renderWeekComments();
      return;
    }
    els.weekCommentsSyncState.textContent="Sincronizando…";
    try{
      const {data,error}=await supabase
        .from("week_comments")
        .select("*")
        .eq("user_id",userId)
        .eq("athlete_id",athleteId)
        .order("created_at",{ascending:true});
      if(error)throw error;
      weekComments=data||[];
      els.weekCommentsSyncState.textContent="Sincronizado";
      renderWeekComments();
    }catch(error){
      console.warn("Comments load failed:",error);
      els.weekCommentsSyncState.textContent="Solo local";
      renderWeekComments();
    }
  }

  async function addWeekComment(text){
    const week=commentWeek();
    if(!week||!text)return;
    const user=els.getCurrentUser?.();
    const localComment={
      id:`local-${Date.now()}`,
      user_id:userId,
      athlete_id:athleteId,
      week_number:week,
      comment_text:text,
      author_name:user?.user_metadata?.full_name||user?.email||"Entrenador",
      created_at:new Date().toISOString()
    };
    weekComments.push(localComment);
    renderWeekComments();

    if(!supabase||userId==="anonymous")return;
    els.weekCommentsSyncState.textContent="Guardando…";
    try{
      const {data,error}=await supabase
        .from("week_comments")
        .insert({
          user_id:userId,
          athlete_id:athleteId,
          week_number:week,
          comment_text:text,
          author_name:localComment.author_name
        })
        .select()
        .single();
      if(error)throw error;
      weekComments=weekComments.map(item=>item.id===localComment.id?data:item);
      els.weekCommentsSyncState.textContent="Guardado";
      renderWeekComments();
    }catch(error){
      console.warn("Comment kept locally:",error);
      els.weekCommentsSyncState.textContent="Pendiente de sincronizar";
    }
  }

  function renderCurrentWeek(){
    const summary=findCurrentWeek();
    if(!summary)return;

    const byDate=sessionsByDayForWeek(summary.week);
    const seasonWeekStart=summary.startDate;
    const todayISO=new Date().toISOString().slice(0,10);

    els.currentWeekTitle.textContent=`Semana ${summary.week}`;
    els.currentWeekMeta.innerHTML=[
      `${formatDate(summary.startDate)} – ${formatDate(summary.endDate)}`,
      summary.phase||"Sin fase",
      `Macrociclo ${summary.macrocycle||"—"}`,
      `${Math.round(summary.load*100)}% de carga`,
      summary.event||""
    ].filter(Boolean).map(value=>`<span>${value}</span>`).join("");

    const days=[];
    let totalSessions=0;
    let completedSessions=0;

    for(let dayIndex=0;dayIndex<7;dayIndex++){
      const dateISO=addDaysISO(seasonWeekStart,dayIndex);
      const sessions=(byDate[dateISO]||[]).filter(item=>item.training);

      sessions.forEach((item,index)=>{
        totalSessions++;
        if(completion[completionKey(dateISO,item.training,index)]){
          completedSessions++;
        }
      });

      days.push({date:dateISO,sessions});
    }

    const progress=totalSessions
      ? Math.round((completedSessions/totalSessions)*100)
      : 0;

    els.currentWeekProgressText.textContent=`${progress}%`;
    els.currentWeekProgressBar.style.width=`${progress}%`;

    els.currentWeekDays.innerHTML=days.map(day=>`
      <article class="current-day-card${day.date===todayISO?" today":""}">
        <header>
          <span>${new Intl.DateTimeFormat("es-ES",{weekday:"short"}).format(new Date(`${day.date}T12:00:00`))}</span>
          <strong>${new Intl.DateTimeFormat("es-ES",{day:"2-digit",month:"short"}).format(new Date(`${day.date}T12:00:00`))}</strong>
        </header>
        <div class="current-day-body">
          ${day.sessions.length?day.sessions.map((item,index)=>{
            const key=completionKey(day.date,item.training,index);
            const checked=Boolean(completion[key]);
            return `
              <label class="week-session-check${checked?" completed":""}">
                <input type="checkbox" data-completion-key="${key}" ${checked?"checked":""}>
                <span>
                  <strong>${item.training}</strong>
                  <small>${item.time?`${item.time} min`:""}${item.rpe?` · RPE ${item.rpe}`:""}</small>
                </span>
              </label>`;
          }).join(""):'<div class="weekly-rest">Descanso</div>'}
        </div>
      </article>
    `).join("");

    els.currentWeekDays.querySelectorAll("[data-completion-key]").forEach(input=>{
      input.addEventListener("change",()=>{
        completion[input.dataset.completionKey]=input.checked;
        saveJSON(COMPLETION_STORAGE_KEY,completion);
        syncCompletionToCloud(input.dataset.completionKey,input.checked);
        renderCurrentWeek();
      });
    });

    const today=days.find(day=>day.date===todayISO);
    els.todayTrainingCard.innerHTML=`
      <div class="today-card-heading">
        <div>
          <p class="eyebrow">HOY</p>
          <h2>${today?dayName(today.date):"Fuera de la semana planificada"}</h2>
        </div>
        <span class="today-count">${today?.sessions.length||0} sesiones</span>
      </div>
      ${today?.sessions.length?today.sessions.map((item,index)=>`
        <article class="today-session">
          <div>
            <strong>${item.training}</strong>
            <small>${item.time?`${item.time} minutos`:""}${item.rpe?` · RPE ${item.rpe}`:""}</small>
          </div>
          <div class="session-zone-chips">
            ${Object.entries(item.zones).filter(([,value])=>value).map(([zone,value])=>`<span>${zone.toUpperCase()} ${value}</span>`).join("")}
          </div>
        </article>`).join(""):'<div class="empty-state">Hoy no hay entrenamiento planificado.</div>'}
    `;

    const max=Math.max(...Object.values(summary.zones),1);
    els.currentWeekZones.innerHTML=Object.entries(summary.zones).map(([zone,value])=>`
      <div class="zone-summary-row">
        <span>${zone.toUpperCase()}</span>
        <div class="zone-summary-track"><div style="width:${Math.max(2,(value/max)*100)}%"></div></div>
        <strong>${value} min</strong>
      </div>
    `).join("");

    els.currentWeekStats.innerHTML=`
      <article><span>Horas</span><strong>${summary.hours.toFixed(1)}</strong></article>
      <article><span>Sesiones</span><strong>${totalSessions}</strong></article>
      <article><span>Completadas</span><strong>${completedSessions}</strong></article>
      <article><span>Carga</span><strong>${Math.round(summary.load*100)}%</strong></article>
    `;

    renderWeekComments();

    els.goToSelectedWeekButton.onclick=()=>{
      selectedWeek=summary.week;
      els.weekSelector.value=String(summary.week);
      renderWeeklySheet();
      document.querySelector('[data-planning-view="weeklyPlanningPanel"]').click();
    };
  }

  function setAthletes(athletes,currentUserId){
    userId=currentUserId||"anonymous";

    const previousValue=els.athleteSelect.value||athleteId;
    els.athleteSelect.innerHTML='<option value="general">Plan general</option>';

    athletes.forEach(athlete=>{
      const option=document.createElement("option");
      option.value=athlete.id;
      option.textContent=athlete.name;
      els.athleteSelect.appendChild(option);
    });

    athleteId=[...els.athleteSelect.options].some(option=>option.value===previousValue)
      ? previousValue
      : "general";

    els.athleteSelect.value=athleteId;
    plan=plansByAthlete[athleteId]||null;
    selectedWeek=findCurrentWeek()?.week||plan?.summary?.[0]?.week||null;
    render();
    loadPlanFromCloud();
    loadCompletionFromCloud();
    loadWeekComments();
  }

  const render=()=>{
    const has=!!plan;els.emptyState.classList.toggle("hidden",has);els.content.classList.toggle("hidden",!has);if(!has)return;
    renderKpis();buildYears();renderCalendar();renderEvents();renderPhaseFilter();renderWeekSelector();renderWeeklySheet();renderAnnualSummary();renderLibrary();renderCurrentWeek();renderSeasonTimeline();
    setMessage(`Plan cargado: ${plan.fileName}`);
  };
  async function importFile(file){
    if(!file)return;els.input.disabled=true;setMessage("Leyendo planificación…");
    try{await loadXLSX();const wb=window.XLSX.read(await file.arrayBuffer(),{type:"array",raw:true,cellDates:false});
      plan=buildAnnualPlan(wb,file.name);selectedWeek=plan.summary[0]?.week;saveCurrentPlan();render();setMessage("Planificación importada correctamente.");
    }catch(e){console.error(e);setMessage(e.message||"No se pudo importar.",true)}finally{els.input.value="";els.input.disabled=false}
  }

  renderSubnav();
  els.athleteSelect.addEventListener("change",()=>{
    athleteId=els.athleteSelect.value;
    plan=plansByAthlete[athleteId]||null;
    selectedWeek=findCurrentWeek()?.week||plan?.summary?.[0]?.week||null;
    render();
    loadPlanFromCloud();
    loadCompletionFromCloud();
    loadWeekComments();
  });
  els.input.addEventListener("change",e=>importFile(e.target.files[0]));
  els.weekSelector.addEventListener("change",()=>{
    selectedWeek=Number(els.weekSelector.value);
    renderWeeklySheet();
    renderSeasonTimeline();
    renderWeekComments();
    scrollTimelineWeekIntoView(selectedWeek,true);
  });
  els.phaseFilter.addEventListener("change",renderAnnualSummary);
  els.annualCalendarYear.addEventListener("change",renderCalendar);
  els.timelinePrevButton.addEventListener("click",()=>{
    els.seasonTimeline.scrollBy({left:-Math.max(320,els.seasonTimeline.clientWidth*.75),behavior:"smooth"});
  });
  els.timelineNextButton.addEventListener("click",()=>{
    els.seasonTimeline.scrollBy({left:Math.max(320,els.seasonTimeline.clientWidth*.75),behavior:"smooth"});
  });
  els.librarySearch.addEventListener("input",renderLibrary);
  document.querySelectorAll(".library-folder").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".library-folder").forEach(x=>x.classList.toggle("active",x===btn));libraryFilter=btn.dataset.libraryFilter;renderLibrary();
  }));
  els.addCalendarNoteButton.addEventListener("click",()=>{els.calendarNoteDate.value=new Date().toISOString().slice(0,10);els.calendarNoteDialog.showModal()});
  els.cancelCalendarNote.addEventListener("click",()=>els.calendarNoteDialog.close());
  els.weekCommentForm.addEventListener("submit",async event=>{
    event.preventDefault();
    const text=normalizeText(els.weekCommentInput.value);
    if(!text)return;
    els.weekCommentInput.value="";
    await addWeekComment(text);
  });
  els.calendarNoteForm.addEventListener("submit",e=>{
    e.preventDefault();
    notes.push({id:crypto.randomUUID(),date:els.calendarNoteDate.value,type:els.calendarNoteType.value,title:normalizeText(els.calendarNoteTitle.value),notes:normalizeText(els.calendarNoteText.value)});
    saveJSON(NOTES_STORAGE_KEY,notes);els.calendarNoteForm.reset();els.calendarNoteDialog.close();buildYears();renderCalendar();renderEvents();renderKpis();
  });
  render();
  return{setAthletes};
}
