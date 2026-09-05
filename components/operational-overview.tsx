"use client";

import { useMemo, useState } from "react";
import { taskDeadlineLabel, taskDeadlineTone, type TaskItem } from "./product-panels";
import type { LearningAssignment, VisionEvent } from "./module-panels";

type Risk = { id: string; date: string | number | null | undefined; title: string | number | null | undefined; detail: string };
type QueueItem = { id: string; title: string; detail: string; date?: string | null; tone: "red" | "yellow" | "green"; module: "employees" | "tasks" | "learning" | "vision"; kind: string };

const dateTone = (value?: string | number | null): "red" | "yellow" | "green" => {
  if (!value) return "red";
  const days = Math.ceil((new Date(String(value)).getTime() - Date.now()) / 86400000);
  return days < 0 ? "red" : days <= 30 ? "yellow" : "green";
};
const formatDate = (value?: string | number | null) => value ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : "Без срока";

export function OperationalOverview({ employeeCount, risks, tasks, assignments, visionEvents, canOpen, open, addEmployee }: {
  employeeCount: number;
  risks: Risk[];
  tasks: TaskItem[];
  assignments: LearningAssignment[];
  visionEvents: VisionEvent[];
  canOpen: (section: string) => boolean;
  open: (section: string) => void;
  addEmployee: () => void;
}) {
  const [filter, setFilter] = useState<"all" | QueueItem["module"]>("all");
  const queue = useMemo<QueueItem[]>(() => {
    const activeTasks = tasks.filter(item => !["verified", "done"].includes(item.status)).map(item => ({
      id: `task-${item.id}`, title: item.title, detail: item.description || "Назначенная задача", date: item.due_date,
      tone: taskDeadlineTone(item) as QueueItem["tone"], module: "tasks" as const, kind: taskDeadlineLabel(item),
    }));
    const deadlines = risks.map(item => ({ id: `risk-${item.id}`, title: String(item.title || "Без имени"), detail: item.detail, date: item.date ? String(item.date) : null, tone: dateTone(item.date), module: "employees" as const, kind: "Срок допуска" }));
    const learning = assignments.filter(item => !["passed"].includes(item.status)).map(item => ({
      id: `learning-${item.id}`, title: item.employee_name || "Сотрудник", detail: item.course_title || "Назначенное обучение", date: item.due_date,
      tone: dateTone(item.due_date), module: "learning" as const, kind: item.status === "failed" ? "Не пройдено" : "Обучение",
    }));
    const vision = visionEvents.filter(item => !["closed", "resolved"].includes(item.status)).map(item => ({
      id: `vision-${item.id}`, title: "Событие Safety Vision", detail: item.notes || item.event_type, date: item.occurred_at,
      tone: item.status === "new" ? "red" as const : "yellow" as const, module: "vision" as const, kind: "Камера",
    }));
    return [...activeTasks, ...deadlines, ...learning, ...vision]
      .filter(item => canOpen(item.module))
      .sort((a, b) => ({ red: 0, yellow: 1, green: 2 }[a.tone] - { red: 0, yellow: 1, green: 2 }[b.tone]) || String(a.date || "").localeCompare(String(b.date || "")));
  }, [assignments, canOpen, risks, tasks, visionEvents]);
  const visible = filter === "all" ? queue : queue.filter(item => item.module === filter);
  const critical = queue.filter(item => item.tone === "red").length;
  const near = queue.filter(item => item.tone === "yellow").length;
  const activeTasks = tasks.filter(item => !["verified", "done"].includes(item.status)).length;
  const overdueLearning = assignments.filter(item => item.status !== "passed" && dateTone(item.due_date) === "red").length;
  const newVision = visionEvents.filter(item => item.status === "new").length;

  return <>
    <section className="page-heading operations-heading"><div><span className="eyebrow">ОПЕРАТИВНЫЙ ЦЕНТР</span><h1>Что требует внимания сегодня</h1><p>{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date())} · единая картина по организации</p></div>{canOpen("employees") && <button className="button dark" onClick={addEmployee}>＋ Добавить сотрудника</button>}</section>

    <section className={`operations-priority ${critical ? "is-critical" : "is-clear"}`}>
      <div><span className="priority-signal">{critical ? "КРИТИЧНО" : "СТАБИЛЬНО"}</span><h2>{critical ? `${critical} ${critical === 1 ? "вопрос требует" : "вопросов требуют"} решения` : "Критических отклонений нет"}</h2><p>{critical ? `Ещё ${near} сроков приближаются. Начните с красной зоны — очередь уже отсортирована по срочности.` : `${near} ближайших сроков находятся под контролем.`}</p></div>
      <div className="priority-score"><strong>{critical}</strong><span>просрочено</span></div>
    </section>

    <section className="operations-metrics" aria-label="Ключевые показатели">
      <button onClick={() => setFilter("all")}><i className="metric-dot red"/><strong>{critical}</strong><span>Критические</span></button>
      <button onClick={() => setFilter("all")}><i className="metric-dot yellow"/><strong>{near}</strong><span>Ближайшие сроки</span></button>
      {canOpen("tasks") && <button onClick={() => setFilter("tasks")}><i className="metric-dot blue"/><strong>{activeTasks}</strong><span>Активные задачи</span></button>}
      {canOpen("learning") && <button onClick={() => setFilter("learning")}><i className="metric-dot violet"/><strong>{overdueLearning}</strong><span>Обучение просрочено</span></button>}
      {canOpen("vision") && <button onClick={() => setFilter("vision")}><i className="metric-dot orange"/><strong>{newVision}</strong><span>События камер</span></button>}
      {canOpen("employees") && <button onClick={() => open("employees")}><i className="metric-dot green"/><strong>{employeeCount}</strong><span>Работники</span></button>}
    </section>

    <section className="operations-grid">
      <section className="panel operations-queue">
        <div className="panel-title"><div><span className="eyebrow">ЕДИНАЯ ОЧЕРЕДЬ</span><h3>Следующие действия</h3></div><span className="queue-count">{visible.length}</span></div>
        <div className="queue-filters">
          {(["all", "tasks", "employees", "learning", "vision"] as const).filter(item => item === "all" || canOpen(item)).map(item => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{({ all: "Все", tasks: "Задачи", employees: "Сроки", learning: "Обучение", vision: "Камеры" })[item]}</button>)}
        </div>
        <div className="action-queue">{visible.length ? visible.slice(0, 8).map(item => <button key={item.id} className="action-row" onClick={() => open(item.module)}><span className={`action-tone ${item.tone}`}/><span className="action-copy"><small>{item.kind}</small><strong>{item.title}</strong><span>{item.detail}</span></span><time>{formatDate(item.date)}</time><b>→</b></button>) : <div className="operations-empty"><span>✓</span><strong>Очередь пуста</strong><p>Новых действий по выбранному фильтру нет.</p></div>}</div>
      </section>

      <aside className="operations-side">
        <section className="panel radar-insight"><span className="eyebrow">RADAR INSIGHT</span><h3>{critical ? "Сначала закройте просрочки" : "Система под контролем"}</h3><p>{critical ? "Красные события уже отсортированы сверху. После них переходите к ближайшим срокам и незавершённому обучению." : "Проверьте ближайшие сроки и назначьте ответственных заранее."}</p></section>
        <section className="panel module-health"><div className="panel-title"><div><span className="eyebrow">МОДУЛИ</span><h3>Состояние системы</h3></div></div>
          {canOpen("employees") && <button onClick={() => open("employees")}><span>HSE Control</span><strong>{risks.length ? `${risks.length} сроков` : "В норме"}</strong></button>}
          {canOpen("learning") && <button onClick={() => open("learning")}><span>Обучение</span><strong>{overdueLearning ? `${overdueLearning} просрочено` : "Под контролем"}</strong></button>}
          {canOpen("vision") && <button onClick={() => open("vision")}><span>Safety Vision</span><strong>{newVision ? `${newVision} новых` : "Без событий"}</strong></button>}
        </section>
      </aside>
    </section>
  </>;
}
