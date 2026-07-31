
const PLAN_STORAGE_KEY="bst_trainer_annual_plan_v1";

function normalizeText(value){
  return String(value??"").replace(/\s+/g," ").trim();
}

function excelDateToISO(serial){
  if(!serial || typeof serial!=="number")return null;
  const utcDays=Math.floor(serial-25569);
  const utcValue=utcDays*86400;
  const date=new Date(utcValue*1000);
  return date.toISOString().slice(0,10);
}

function formatDate(iso){
  if(!iso)return"—";
  return new Intl.DateTimeFormat("es-ES",{
    day:"2-digit",
    month:"short",
    year:"numeric"
  }).format(new Date(`${iso}T12:00:00`));
}

function parseSheetRows(workbook,sheetName){
  const sheet=workbook.Sheets[sheetName];
  if(!sheet)return[];
  return window.XLSX.utils.sheet_to_json(sheet,{
    header:1,
    defval:"",
    raw:true,
    blankrows:false
  });
}

function mapSummary(rows){
  if(rows.length<4)return[];

  return rows.slice(3).map(row=>({
    index:Number(row[0])||null,
    event:normalizeText(row[1]),
    eventDate:normalizeText(row[2]),
    observations:normalizeText(row[3]),
    startDate:excelDateToISO(row[4]),
    endDate:excelDateToISO(row[5]),
    week:Number(row[6])||null,
    load:Number(row[7])||0,
    phase:normalizeText(row[8]),
    macrocycle:normalizeText(row[9]),
    accumulated:Number(row[10])||0,
    minutes:Number(row[11])||0,
    zones:{
      z1:Number(row[12])||0,
      z2:Number(row[13])||0,
      z3:Number(row[14])||0,
      z4:Number(row[15])||0,
      z5:Number(row[16])||0,
      z6:Number(row[17])||0,
      weights:Number(row[18])||0,
      other:Number(row[19])||0
    },
    hours:Number(row[20])||0
  })).filter(item=>item.week);
}

function mapPlan(rows){
  if(rows.length<2)return[];

  return rows.slice(1).map(row=>({
    code:Number(row[0])||null,
    week:Number(row[1])||null,
    date:excelDateToISO(row[2]),
    dayDate:excelDateToISO(row[3]),
    training:normalizeText(row[4]),
    time:Number(row[5])||0,
    rpe:normalizeText(row[6]),
    zones:{
      z1:Number(row[7])||0,
      z2:Number(row[8])||0,
      z3:Number(row[9])||0,
      z4:Number(row[10])||0,
      z5:Number(row[11])||0,
      z6:Number(row[12])||0,
      weights:Number(row[13])||0,
      other:Number(row[14])||0
    }
  })).filter(item=>item.week && (item.training || item.date));
}

function mapTrainingLibrary(rows){
  if(rows.length<2)return[];

  return rows.slice(1).map(row=>({
    name:normalizeText(row[0]),
    rpe:normalizeText(row[1]),
    zones:{
      z1:Number(row[2])||0,
      z2:Number(row[3])||0,
      z3:Number(row[4])||0,
      z4:Number(row[5])||0,
      z5:Number(row[6])||0,
      z6:Number(row[7])||0,
      weights:Number(row[8])||0,
      other:Number(row[9])||0
    },
    total:Number(row[10])||0
  })).filter(item=>item.name);
}

function buildAnnualPlan(workbook,fileName){
  const summary=mapSummary(parseSheetRows(workbook,"Summary"));
  const sessions=mapPlan(parseSheetRows(workbook,"Plan"));
  const trainingLibrary=mapTrainingLibrary(parseSheetRows(workbook,"Training"));

  if(!summary.length || !sessions.length){
    throw new Error(
      "El Excel no contiene las hojas Summary y Plan con la estructura esperada."
    );
  }

  return{
    importedAt:new Date().toISOString(),
    fileName,
    summary,
    sessions,
    trainingLibrary
  };
}

function zoneMinutes(zones){
  return Object.values(zones||{}).reduce((sum,value)=>sum+(Number(value)||0),0);
}

function loadStoredPlan(){
  try{
    const raw=localStorage.getItem(PLAN_STORAGE_KEY);
    return raw?JSON.parse(raw):null;
  }catch{
    return null;
  }
}

function savePlan(plan){
  localStorage.setItem(PLAN_STORAGE_KEY,JSON.stringify(plan));
}

function loadXLSX(){
  return new Promise((resolve,reject)=>{
    if(window.XLSX){
      resolve(window.XLSX);
      return;
    }

    const script=document.createElement("script");
    script.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload=()=>resolve(window.XLSX);
    script.onerror=()=>reject(new Error("No se pudo cargar el lector de Excel."));
    document.head.appendChild(script);
  });
}

export function createPlanningModule({
  input,
  message,
  emptyState,
  content,
  weeksKpi,
  hoursKpi,
  sessionsKpi,
  eventsKpi,
  weeksGrid,
  weekSelector,
  selectedWeekTitle,
  selectedWeekMeta,
  selectedWeekSessions,
  selectedWeekTotals,
  phaseFilter,
  librarySearch,
  libraryTable
}){
  let plan=loadStoredPlan();
  let selectedWeek=null;

  function setMessage(text,error=false){
    message.textContent=text;
    message.className=`planning-message ${error?"error":"success"}`;
  }

  function renderKpis(){
    const totalHours=plan.summary.reduce((sum,item)=>sum+item.hours,0);
    const sessionCount=plan.sessions.filter(item=>item.training).length;
    const events=plan.summary.filter(item=>item.event).length;

    weeksKpi.textContent=String(plan.summary.length);
    hoursKpi.textContent=totalHours.toFixed(1);
    sessionsKpi.textContent=String(sessionCount);
    eventsKpi.textContent=String(events);
  }

  function renderPhaseFilter(){
    const phases=[...new Set(plan.summary.map(item=>item.phase).filter(Boolean))];
    phaseFilter.innerHTML='<option value="">Todas las fases</option>';

    phases.forEach(phase=>{
      const option=document.createElement("option");
      option.value=phase;
      option.textContent=phase;
      phaseFilter.appendChild(option);
    });
  }

  function renderWeekSelector(){
    weekSelector.replaceChildren();

    plan.summary.forEach(item=>{
      const option=document.createElement("option");
      option.value=String(item.week);
      option.textContent=`Semana ${item.week} · ${item.phase||"Sin fase"}`;
      weekSelector.appendChild(option);
    });

    if(!selectedWeek && plan.summary.length){
      selectedWeek=plan.summary[0].week;
    }

    weekSelector.value=String(selectedWeek);
  }

  function loadColor(load){
    if(load>=1)return"load-max";
    if(load>=0.9)return"load-high";
    if(load>=0.8)return"load-medium";
    if(load>=0.7)return"load-low";
    return"load-recovery";
  }

  function renderAnnualWeeks(){
    weeksGrid.replaceChildren();

    const phase=phaseFilter.value;
    const filtered=phase
      ? plan.summary.filter(item=>item.phase===phase)
      : plan.summary;

    filtered.forEach(item=>{
      const button=document.createElement("button");
      button.type="button";
      button.className=`annual-week-card ${loadColor(item.load)}${item.week===selectedWeek?" active":""}`;

      const event=item.event
        ? `<div class="annual-week-event">${item.event}</div>`
        : "";

      button.innerHTML=`
        <div class="annual-week-top">
          <strong>S${item.week}</strong>
          <span>${Math.round(item.load*100)}%</span>
        </div>
        <div class="annual-week-hours">${item.hours.toFixed(1)} h</div>
        <div class="annual-week-phase">${item.phase||"—"} · M${item.macrocycle||"—"}</div>
        ${event}
      `;

      button.addEventListener("click",()=>{
        selectedWeek=item.week;
        weekSelector.value=String(selectedWeek);
        renderAnnualWeeks();
        renderSelectedWeek();
      });

      weeksGrid.appendChild(button);
    });
  }

  function dayLabel(iso){
    if(!iso)return"Sesión adicional";
    return new Intl.DateTimeFormat("es-ES",{
      weekday:"long",
      day:"2-digit",
      month:"short"
    }).format(new Date(`${iso}T12:00:00`));
  }

  function renderSelectedWeek(){
    const summary=plan.summary.find(item=>item.week===selectedWeek);
    if(!summary)return;

    selectedWeekTitle.textContent=`Semana ${summary.week}`;

    selectedWeekMeta.innerHTML=`
      <span>${formatDate(summary.startDate)} – ${formatDate(summary.endDate)}</span>
      <span>${summary.phase||"Sin fase"}</span>
      <span>Macrociclo ${summary.macrocycle||"—"}</span>
      <span>${Math.round(summary.load*100)}% de carga</span>
      <span>${summary.hours.toFixed(1)} horas</span>
    `;

    if(summary.event){
      selectedWeekMeta.innerHTML+=`
        <span class="week-event-chip">${summary.event}</span>
      `;
    }

    const sessions=plan.sessions.filter(item=>item.week===selectedWeek);
    const groups=new Map();

    let currentDate=null;

    sessions.forEach(item=>{
      if(item.date)currentDate=item.date;
      const key=item.date||currentDate||"extra";

      if(!groups.has(key))groups.set(key,[]);
      if(item.training)groups.get(key).push(item);
    });

    selectedWeekSessions.replaceChildren();

    for(const [date,items] of groups.entries()){
      if(!items.length)continue;

      const day=document.createElement("article");
      day.className="week-day-card";

      const sessionHtml=items.map((item,index)=>`
        <div class="week-session-row">
          <span class="week-session-number">${index+1}</span>
          <div>
            <strong>${item.training}</strong>
            <small>
              ${item.time?`${item.time} min`:""}
              ${item.rpe?` · RPE ${item.rpe}`:""}
            </small>
          </div>
          <div class="week-session-zones">
            ${Object.entries(item.zones)
              .filter(([,value])=>value)
              .map(([zone,value])=>`<span>${zone.toUpperCase()} ${value}</span>`)
              .join("")}
          </div>
        </div>
      `).join("");

      day.innerHTML=`
        <h3>${date==="extra"?"Sesiones":dayLabel(date)}</h3>
        ${sessionHtml}
      `;

      selectedWeekSessions.appendChild(day);
    }

    const zones=summary.zones;
    const max=Math.max(...Object.values(zones),1);

    selectedWeekTotals.innerHTML=Object.entries(zones).map(([zone,value])=>`
      <div class="zone-summary-row">
        <span>${zone.toUpperCase()}</span>
        <div class="zone-summary-track">
          <div style="width:${Math.max(2,(value/max)*100)}%"></div>
        </div>
        <strong>${value} min</strong>
      </div>
    `).join("");
  }

  function renderLibrary(){
    const search=normalizeText(librarySearch.value).toLowerCase();
    const items=plan.trainingLibrary.filter(item=>
      !search || item.name.toLowerCase().includes(search)
    );

    const rows=items.slice(0,250).map(item=>`
      <tr>
        <td><strong>${item.name}</strong></td>
        <td>${item.rpe||"—"}</td>
        <td>${item.total||zoneMinutes(item.zones)}</td>
        <td>${item.zones.z1||0}</td>
        <td>${item.zones.z2||0}</td>
        <td>${item.zones.z3||0}</td>
        <td>${item.zones.z4||0}</td>
        <td>${item.zones.z5||0}</td>
        <td>${item.zones.z6||0}</td>
        <td>${item.zones.weights||0}</td>
        <td>${item.zones.other||0}</td>
      </tr>
    `).join("");

    libraryTable.innerHTML=`
      <table class="planning-library-table">
        <thead>
          <tr>
            <th>Sesión</th>
            <th>RPE</th>
            <th>Total</th>
            <th>Z1</th>
            <th>Z2</th>
            <th>Z3</th>
            <th>Z4</th>
            <th>Z5</th>
            <th>Z6</th>
            <th>Fuerza</th>
            <th>Otros</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function render(){
    const hasPlan=Boolean(plan);

    emptyState.classList.toggle("hidden",hasPlan);
    content.classList.toggle("hidden",!hasPlan);

    if(!hasPlan)return;

    renderKpis();
    renderPhaseFilter();
    renderWeekSelector();
    renderAnnualWeeks();
    renderSelectedWeek();
    renderLibrary();

    setMessage(
      `Plan cargado: ${plan.fileName} · ${new Date(plan.importedAt).toLocaleString("es-ES")}`
    );
  }

  async function importFile(file){
    if(!file)return;

    input.disabled=true;
    setMessage("Leyendo planificación anual…");

    try{
      const XLSX=await loadXLSX();
      const buffer=await file.arrayBuffer();
      const workbook=XLSX.read(buffer,{
        type:"array",
        raw:true,
        cellDates:false
      });

      plan=buildAnnualPlan(workbook,file.name);
      selectedWeek=plan.summary[0]?.week||null;

      savePlan(plan);
      render();
      setMessage("Planificación anual importada correctamente.");
    }catch(error){
      console.error("Annual planning import failed:",error);
      setMessage(error.message||"No se pudo importar la planificación.",true);
    }finally{
      input.value="";
      input.disabled=false;
    }
  }

  input.addEventListener("change",event=>importFile(event.target.files[0]));
  weekSelector.addEventListener("change",()=>{
    selectedWeek=Number(weekSelector.value);
    renderAnnualWeeks();
    renderSelectedWeek();
  });
  phaseFilter.addEventListener("change",renderAnnualWeeks);
  librarySearch.addEventListener("input",renderLibrary);

  render();
}
