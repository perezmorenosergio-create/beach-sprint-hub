function normalizeText(value){
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function makeId(name){
  return `${Date.now()}-${normalizeText(name)
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ]+/gi, "-")}-${Math.random().toString(36).slice(2,7)}`;
}

function withTimeout(promise, milliseconds, message){
  return Promise.race([
    promise,
    new Promise((_, reject)=>{
      window.setTimeout(()=>reject(new Error(message)), milliseconds);
    })
  ]);
}

async function waitForXLSX(timeoutMs=8000){
  const started=Date.now();

  while(!window.XLSX){
    if(Date.now()-started>timeoutMs){
      throw new Error(
        "No se pudo cargar el lector de Excel. Comprueba la conexión o guarda el archivo como CSV."
      );
    }
    await new Promise(resolve=>window.setTimeout(resolve,100));
  }

  return window.XLSX;
}

function parseCSV(text){
  const lines=text
    .replace(/^\uFEFF/,"")
    .split(/\r?\n/)
    .filter(line=>line.trim());

  if(!lines.length)return[];

  const delimiters=[";",",","\t"];
  const delimiter=delimiters
    .map(value=>({
      value,
      count:lines[0].split(value).length-1
    }))
    .sort((a,b)=>b.count-a.count)[0].value;

  return lines.map(line=>{
    const cells=[];
    let cell="";
    let quoted=false;

    for(let index=0;index<line.length;index++){
      const character=line[index];

      if(character==='"' && line[index+1]==='"'){
        cell+='"';
        index++;
      }else if(character==='"'){
        quoted=!quoted;
      }else if(character===delimiter && !quoted){
        cells.push(cell);
        cell="";
      }else{
        cell+=character;
      }
    }

    cells.push(cell);
    return cells;
  });
}

function indexOfAlias(headers, aliases){
  return headers.findIndex(header=>
    aliases.includes(normalizeText(header).toLowerCase())
  );
}

function rowsToAthletes(rows){
  const cleanRows=rows.filter(row=>
    Array.isArray(row) && row.some(value=>normalizeText(value))
  );

  if(!cleanRows.length)return[];

  const headers=cleanRows[0].map(value=>
    normalizeText(value).toLowerCase()
  );

  const nameAliases=[
    "nombre",
    "nombre y apellidos",
    "deportista",
    "atleta",
    "athlete",
    "name",
    "full name",
    "tripulación",
    "tripulacion",
    "crew"
  ];

  let nameIndex=indexOfAlias(headers,nameAliases);
  const hasHeader=nameIndex>=0;

  if(nameIndex<0)nameIndex=0;

  const clubIndex=indexOfAlias(
    headers,
    ["club","país","pais","country","team","federación","federacion"]
  );

  const categoryIndex=indexOfAlias(
    headers,
    ["categoría","categoria","category","event","prueba"]
  );

  const bibIndex=indexOfAlias(
    headers,
    ["dorsal","bib","lane","calle","número","numero"]
  );

  return cleanRows
    .slice(hasHeader?1:0)
    .map(row=>({
      id:makeId(row[nameIndex]),
      name:normalizeText(row[nameIndex]),
      club:clubIndex>=0?normalizeText(row[clubIndex]):"",
      category:categoryIndex>=0?normalizeText(row[categoryIndex]):"",
      bib:bibIndex>=0?normalizeText(row[bibIndex]):""
    }))
    .filter(athlete=>athlete.name);
}

async function parseExcel(file){
  const XLSX=await waitForXLSX();

  const buffer=await withTimeout(
    file.arrayBuffer(),
    15000,
    "El archivo tarda demasiado en abrirse."
  );

  const workbook=XLSX.read(buffer,{
    type:"array",
    cellDates:false,
    raw:false
  });

  if(!workbook.SheetNames.length){
    throw new Error("El Excel no contiene ninguna hoja.");
  }

  const sheet=workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json(sheet,{
    header:1,
    defval:"",
    raw:false,
    blankrows:false
  });
}

export async function importAthleteFile(file){
  if(!file){
    throw new Error("No se ha seleccionado ningún archivo.");
  }

  const extension=file.name.split(".").pop().toLowerCase();

  if(!["xlsx","xls","csv"].includes(extension)){
    throw new Error("Formato no admitido. Utiliza Excel (.xlsx/.xls) o CSV.");
  }

  let rows=[];

  if(extension==="csv"){
    const text=await withTimeout(
      file.text(),
      15000,
      "El archivo CSV tarda demasiado en abrirse."
    );
    rows=parseCSV(text);
  }else{
    rows=await parseExcel(file);
  }

  const athletes=rowsToAthletes(rows);

  if(!athletes.length){
    throw new Error(
      "No se encontraron deportistas. La primera columna debe contener los nombres."
    );
  }

  return athletes;
}

export function downloadAthleteTemplate(){
  const csv=[
    "Nombre;Club;Categoría;Dorsal",
    "Teresa Díaz;RC Mediterráneo;CW1x;1",
    "Vincent Schreiber;Austria;CM1x;2"
  ].join("\n");

  const blob=new Blob(
    ["\ufeff"+csv],
    {type:"text/csv;charset=utf-8"}
  );

  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");

  link.href=url;
  link.download="plantilla_deportistas_beach_sprint.csv";
  link.click();

  URL.revokeObjectURL(url);
}
