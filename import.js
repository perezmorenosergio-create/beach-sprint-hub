import {makeId,normalizeText} from "./data.js";

function parseCSV(text){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length)return[];
  const candidates=[";",",","\t"];
  const delimiter=candidates.map(d=>({d,count:(lines[0].split(d).length-1)})).sort((a,b)=>b.count-a.count)[0].d;
  return lines.map(line=>{
    const cells=[];let cell="";let quoted=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'&&line[i+1]==='"'){cell+='"';i++}
      else if(c==='"'){quoted=!quoted}
      else if(c===delimiter&&!quoted){cells.push(cell);cell=""}
      else cell+=c;
    }
    cells.push(cell);return cells;
  });
}
function indexOfAlias(headers,aliases){return headers.findIndex(h=>aliases.includes(normalizeText(h).toLowerCase()))}
function rowsToAthletes(rows){
  const clean=rows.filter(row=>Array.isArray(row)&&row.some(v=>normalizeText(v)));
  if(!clean.length)return[];
  const headers=clean[0].map(v=>normalizeText(v).toLowerCase());
  const nameAliases=["nombre","nombre y apellidos","deportista","atleta","athlete","name","full name","tripulación","tripulacion","crew"];
  let nameIndex=indexOfAlias(headers,nameAliases);
  const hasHeader=nameIndex>=0;
  if(nameIndex<0)nameIndex=0;
  const clubIndex=indexOfAlias(headers,["club","país","pais","country","team"]);
  const categoryIndex=indexOfAlias(headers,["categoría","categoria","category","event"]);
  const bibIndex=indexOfAlias(headers,["dorsal","bib","lane","calle"]);
  return clean.slice(hasHeader?1:0).map(row=>({
    id:makeId(row[nameIndex]),
    name:normalizeText(row[nameIndex]),
    club:clubIndex>=0?normalizeText(row[clubIndex]):"",
    category:categoryIndex>=0?normalizeText(row[categoryIndex]):"",
    bib:bibIndex>=0?normalizeText(row[bibIndex]):""
  })).filter(a=>a.name);
}
export async function importAthleteFile(file){
  const ext=file.name.split(".").pop().toLowerCase();
  let rows=[];
  if(ext==="csv")rows=parseCSV(await file.text());
  else{
    if(!window.XLSX)throw new Error("No se pudo cargar el lector de Excel.");
    const workbook=window.XLSX.read(await file.arrayBuffer(),{type:"array"});
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    rows=window.XLSX.utils.sheet_to_json(sheet,{header:1,defval:"",raw:false});
  }
  return rowsToAthletes(rows);
}
export function downloadAthleteTemplate(){
  const csv="Nombre;Club;Categoría;Dorsal\nTeresa Díaz;RC Mediterráneo;CW1x;1\nVincent Schreiber;Austria;CM1x;2\n";
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");
  a.href=url;a.download="plantilla_deportistas_beach_sprint.csv";a.click();URL.revokeObjectURL(url);
}
