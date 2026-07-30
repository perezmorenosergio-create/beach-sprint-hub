function normalizeText(value){
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function makeId(name){
  return `${Date.now()}-${normalizeText(name)
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ]+/gi, "-")}-${Math.random().toString(36).slice(2,7)}`;
}

function parseCSV(text){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length)return[];

  const delimiters=[";",",","\t"];
  const delimiter=delimiters
    .map(d=>({d,count:lines[0].split(d).length-1}))
    .sort((a,b)=>b.count-a.count)[0].d;

  return lines.map(line=>{
    const cells=[];
    let cell="",quoted=false;

    for(let i=0;i<line.length;i++){
      const char=line[i];

      if(char==='"' && line[i+1]==='"'){
        cell+='"';
        i++;
      }else if(char==='"'){
        quoted=!quoted;
      }else if(char===delimiter && !quoted){
        cells.push(cell);
        cell="";
      }else{
        cell+=char;
      }
    }

    cells.push(cell);
    return cells;
  });
}

function indexOfAlias(headers,aliases){
  return headers.findIndex(header=>aliases.includes(normalizeText(header).toLowerCase()));
}

function rowsToAthletes(rows){
  const clean=rows.filter(row=>Array.isArray(row)&&row.some(value=>normalizeText(value)));
  if(!clean.length)return[];

  const headers=clean[0].map(value=>normalizeText(value).toLowerCase());
  const nameAliases=[
    "nombre","nombre y apellidos","deportista","atleta",
    "athlete","name","full name","tripulación","tripulacion","crew"
  ];

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
  })).filter(athlete=>athlete.name);
}

export async function importAthleteFile(file){
  const extension=file.name.split(".").pop().toLowerCase();
  let rows=[];

  if(extension==="csv"){
    rows=parseCSV(await file.text());
  }else{
    if(!window.XLSX){
      throw new Error("No se pudo cargar el lector de Excel.");
    }

    const workbook=window.XLSX.read(await file.arrayBuffer(),{type:"array"});
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    rows=window.XLSX.utils.sheet_to_json(sheet,{
      header:1,
      defval:"",
      raw:false
    });
  }

  return rowsToAthletes(rows);
}

export function downloadAthleteTemplate(){
  const csv=[
    "Nombre;Club;Categoría;Dorsal",
    "Teresa Díaz;RC Mediterráneo;CW1x;1",
    "Vincent Schreiber;Austria;CM1x;2"
  ].join("\n");

  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");

  link.href=url;
  link.download="plantilla_deportistas_beach_sprint.csv";
  link.click();

  URL.revokeObjectURL(url);
}
