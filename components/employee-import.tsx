"use client";

import { ChangeEvent, useState } from "react";
import { downloadEmployeeTemplate, readEmployeesFile, type ImportedEmployee } from "@/lib/excel-import";

export function EmployeeImport({ close, submit, limit }: { close: () => void; submit: (rows: ImportedEmployee[]) => Promise<void>; limit?: number }) {
  const [rows, setRows] = useState<ImportedEmployee[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setError("");
    try {
      const parsed = await readEmployeesFile(file);
      if (limit !== undefined && parsed.length > limit) throw new Error(`В тарифе Free можно импортировать ещё ${limit} работников.`);
      setRows(parsed);
    } catch (reason) { setRows([]); setError(reason instanceof Error ? reason.message : "Не удалось прочитать файл."); }
  }
  async function save() { setBusy(true); setError(""); try { await submit(rows); close(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Импорт не выполнен."); } finally { setBusy(false); } }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="modal import-modal">
    <div className="modal-head"><div><span className="eyebrow">МАССОВОЕ ДОБАВЛЕНИЕ</span><h2>Импорт работников</h2></div><button type="button" onClick={close}>×</button></div>
    <div className="import-drop"><input type="file" accept=".xlsx,.csv" onChange={choose}/><strong>Выберите Excel-файл</strong><span>.xlsx или .csv · первая строка должна содержать заголовки</span></div>
    <button className="template-link" type="button" onClick={downloadEmployeeTemplate}>↓ Скачать шаблон для Excel</button>
    {error && <div className="inline-notice error">{error}</div>}
    {rows.length > 0 && <div className="import-preview"><strong>Готово к импорту: {rows.length}</strong><div>{rows.slice(0, 5).map((row, index) => <span key={`${row.full_name}-${index}`}>{row.full_name}<small>{row.department} · {row.position}</small></span>)}</div>{rows.length > 5 && <small>и ещё {rows.length - 5}</small>}</div>}
    <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Отмена</button><button type="button" className="button dark" disabled={busy || !rows.length} onClick={save}>{busy ? "Импорт…" : `Импортировать ${rows.length || ""}`}</button></div>
  </section></div>;
}
