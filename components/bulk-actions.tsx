"use client";

export function SelectBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="select-box" title={label}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}

export function BulkActions({
  count,
  allSelected,
  onToggleAll,
  onClear,
  onComplete,
  onDelete,
  busy = false,
}: {
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  onComplete?: () => void;
  onDelete: () => void;
  busy?: boolean;
}) {
  return (
    <div className={`bulk-actions ${count ? "visible" : ""}`} aria-live="polite">
      <button type="button" className="bulk-select-all" onClick={onToggleAll} disabled={busy}>
        {allSelected ? "Снять выбор" : "Выбрать всё"}
      </button>
      <strong>{count ? `Выбрано: ${count}` : "Выберите записи"}</strong>
      {count > 0 && (
        <div>
          {onComplete && (
            <button type="button" className="bulk-complete" onClick={onComplete} disabled={busy}>
              ✓ Отметить выполненными
            </button>
          )}
          <button type="button" className="bulk-delete" onClick={onDelete} disabled={busy}>
            Удалить выбранные
          </button>
          <button type="button" className="bulk-clear" onClick={onClear} disabled={busy} aria-label="Снять выбор">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
