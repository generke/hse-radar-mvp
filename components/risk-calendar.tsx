"use client";

import { useMemo, useState } from "react";

type Deadline = { date?: string | null; tone: "red" | "yellow" | "green"; title: string };

export function RiskCalendar({ deadlines }: { deadlines: Deadline[] }) {
  const [offset, setOffset] = useState(0);
  const month = useMemo(() => {
    const value = new Date(); value.setDate(1); value.setMonth(value.getMonth() + offset); value.setHours(0, 0, 0, 0); return value;
  }, [offset]);
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const firstDay = (month.getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const today = new Date();
  const marked = useMemo(() => {
    const result = new Map<number, number>();
    deadlines.forEach(item => {
      if (!item.date) return; const date = new Date(`${item.date.slice(0, 10)}T00:00:00`);
      if (date.getFullYear() === year && date.getMonth() === monthIndex) result.set(date.getDate(), (result.get(date.getDate()) || 0) + 1);
    });
    return result;
  }, [deadlines, monthIndex, year]);
  const cells = Array.from({ length: firstDay + days }, (_, index) => index < firstDay ? null : index - firstDay + 1);
  return <section className="panel risk-calendar">
    <div className="calendar-head"><div><span className="eyebrow">КАЛЕНДАРЬ РИСКОВ</span><h3>{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month)}</h3></div><div><button aria-label="Предыдущий месяц" onClick={() => setOffset(value => value - 1)}>←</button><button aria-label="Текущий месяц" onClick={() => setOffset(0)}>•</button><button aria-label="Следующий месяц" onClick={() => setOffset(value => value + 1)}>→</button></div></div>
    <div className="calendar-weekdays">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="calendar-days">{cells.map((day, index) => day ? <div key={day} className={`${marked.has(day) ? "has-deadline" : ""} ${today.getFullYear() === year && today.getMonth() === monthIndex && today.getDate() === day ? "is-today" : ""}`} title={marked.has(day) ? `${marked.get(day)} активных срока` : undefined}><span>{day}</span>{marked.has(day) && <i>{marked.get(day)}</i>}</div> : <div key={`empty-${index}`} />)}</div>
    <p><i /> Красным отмечены даты активных сроков и возможных просрочек.</p>
  </section>;
}
