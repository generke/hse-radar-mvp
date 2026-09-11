export type ImportedEmployee = {
  full_name: string;
  department: string;
  position: string;
  hire_date: string;
  medical_exam_expiry: string;
  briefing_expiry: string;
  training_expiry: string;
};

const headers: Record<string, keyof ImportedEmployee> = {
  "фио": "full_name", "ф.и.о.": "full_name", "ф.и.о": "full_name", "full name": "full_name",
  "подразделение": "department", "department": "department",
  "должность": "position", "position": "position",
  "дата приема": "hire_date", "дата приёма": "hire_date", "hire date": "hire_date",
  "медосмотр до": "medical_exam_expiry", "medical exam expiry": "medical_exam_expiry",
  "инструктаж до": "briefing_expiry", "briefing expiry": "briefing_expiry",
  "обучение до": "training_expiry", "training expiry": "training_expiry",
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function excelDate(value: string) {
  const clean = value.trim();
  if (/^\d+(\.\d+)?$/.test(clean)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(clean) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const match = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function rowsToEmployees(rows: string[][]): ImportedEmployee[] {
  if (rows.length < 2) throw new Error("В файле нет строк с работниками.");
  const mapped = rows[0].map(cell => headers[normalizeHeader(cell)]);
  const required: (keyof ImportedEmployee)[] = ["full_name", "department", "position", "hire_date", "medical_exam_expiry", "briefing_expiry", "training_expiry"];
  const missing = required.filter(key => !mapped.includes(key));
  if (missing.length) throw new Error("Не найдены обязательные столбцы. Скачайте шаблон и сохраните названия заголовков.");
  return rows.slice(1).filter(row => row.some(Boolean)).map((row, rowIndex) => {
    const record = {} as ImportedEmployee;
    mapped.forEach((key, index) => { if (key) record[key] = (row[index] || "").trim() });
    for (const key of ["hire_date", "medical_exam_expiry", "briefing_expiry", "training_expiry"] as const) record[key] = excelDate(record[key]);
    if (required.some(key => !record[key])) throw new Error(`Строка ${rowIndex + 2}: заполнены не все обязательные поля.`);
    return record;
  });
}

function parseCsv(text: string) {
  const delimiter = text.split("\n", 1)[0].includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function unzipEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Excel-файл повреждён или имеет неподдерживаемый формат.");
  const count = view.getUint16(end + 10, true), directoryOffset = view.getUint32(end + 16, true);
  const entries = new Map<string, string>(); let cursor = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true), compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true), name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet1\.xml$/.test(name)) {
      const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength, compressed = bytes.slice(start, start + compressedSize);
      let output: Uint8Array;
      if (method === 0) output = compressed;
      else if (method === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        output = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error("Метод сжатия Excel-файла не поддерживается.");
      entries.set(name, new TextDecoder().decode(output));
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXlsxXml(entries: Map<string, string>) {
  const parser = new DOMParser();
  const sharedXml = entries.get("xl/sharedStrings.xml");
  const shared = sharedXml ? Array.from(parser.parseFromString(sharedXml, "application/xml").getElementsByTagName("si")).map(node => Array.from(node.getElementsByTagName("t")).map(text => text.textContent || "").join("")) : [];
  const sheetXml = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("В книге не найден первый лист.");
  const sheet = parser.parseFromString(sheetXml, "application/xml");
  return Array.from(sheet.getElementsByTagName("row")).map(row => {
    const cells: string[] = [];
    Array.from(row.getElementsByTagName("c")).forEach(cell => {
      const reference = cell.getAttribute("r") || "A1"; let column = 0;
      for (const letter of reference.match(/[A-Z]+/)?.[0] || "A") column = column * 26 + letter.charCodeAt(0) - 64;
      const type = cell.getAttribute("t"), raw = cell.getElementsByTagName("v")[0]?.textContent || cell.getElementsByTagName("t")[0]?.textContent || "";
      cells[column - 1] = type === "s" ? shared[Number(raw)] || "" : raw;
    });
    return cells;
  });
}

export async function readEmployeesFile(file: File) {
  if (file.name.toLowerCase().endsWith(".csv")) return rowsToEmployees(parseCsv(await file.text()));
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Поддерживаются файлы .xlsx и .csv.");
  return rowsToEmployees(parseXlsxXml(await unzipEntries(await file.arrayBuffer())));
}

export function downloadEmployeeTemplate() {
  const content = "\uFEFFФИО;Подразделение;Должность;Дата приёма;Медосмотр до;Инструктаж до;Обучение до\r\nИванов Иван;Производство;Инженер;01.09.2026;01.09.2027;01.03.2027;01.09.2027";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  link.download = "shablon-importa-rabotnikov.csv"; link.click(); URL.revokeObjectURL(link.href);
}
