import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { workspace } from '../repositories/workspace';
import { range, localDate, type Item, type Settings } from '../domain/model';
import type { Run } from '../services/operations';
import { useToday } from '../components/useToday';
export function Calendar({
  compact = false,
  onOpen,
  run,
}: {
  compact?: boolean;
  onOpen: (item: Item) => void;
  run: Run;
}) {
  const todayDate = useToday();
  const settings = useLiveQuery(async () => workspace.settings(), []);
  const items =
    useLiveQuery(
      async () => workspace.calendarItems(settings?.calendarShowTopLevelTasks),
      [settings?.calendarShowTopLevelTasks],
    ) || [];
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [view, setView] = useState('month');
  const [project, setProject] = useState('');
  const [zoom, setZoom] = useState(1);
  if (!settings) return null;
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + zoom, 0);
  const first = new Date(start);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(d.getDate() + i);
    return localDate(d);
  });
  const visible = items.filter(
    (x) =>
      (x.kind === 'project'
        ? settings.calendarShowProjects
        : x.parentProjectId
          ? settings.calendarShowProjectTasks
          : settings.calendarShowTopLevelTasks) &&
      (!project || x.id === project || x.parentProjectId === project),
  );
  const modes: ('actual' | 'planned')[] =
    settings.calendarMode === 'compare'
      ? ['planned', 'actual']
      : [settings.calendarMode];
  const entries = visible.flatMap((item) =>
    modes.flatMap((mode) => {
      const r = range(
        item,
        mode,
        item.kind === 'project'
          ? items.filter((x) => x.parentProjectId === item.id)
          : [],
      );
      return r ? [{ item, mode, ...r }] : [];
    }),
  );
  const move = (delta: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  const change = (patch: Partial<Settings>) =>
    run(() => workspace.saveSettings(patch));
  const token = (item: Item) =>
    item.projectColorToken ||
    items.find((x) => x.id === item.parentProjectId)?.projectColorToken ||
    (item.priority === 'high'
      ? 'rose'
      : item.priority === 'low'
        ? 'teal'
        : 'blue');
  // Use UTC only for arithmetic on date components, never for displaying dates.
  const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;
  const rangeDays =
    Math.round(dayMs(localDate(end)) - dayMs(localDate(start))) + 1;
  return (
    <section className={compact ? 'compact-calendar' : 'calendar-page'}>
      <header className="section-heading">
        <h2>{compact ? 'Calendar' : 'Your work, over time'}</h2>
        {compact && <Link to="/calendar">Open ↗</Link>}
      </header>
      <div className="calendar-controls">
        <button aria-label="Previous month" onClick={() => move(-1)}>
          <ChevronLeft size={16} />
        </button>
        <strong>
          {month.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          })}
        </strong>
        <button aria-label="Next month" onClick={() => move(1)}>
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() =>
            setMonth(
              new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            )
          }
        >
          Today
        </button>
      </div>
      {!compact && (
        <div className="calendar-filters">
          <select
            aria-label="Calendar view"
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            <option value="month">Month</option>
            <option value="timeline">Timeline</option>
          </select>
          <select
            aria-label="Calendar mode"
            value={settings.calendarMode}
            onChange={(e) =>
              change({
                calendarMode: e.target.value as Settings['calendarMode'],
              })
            }
          >
            <option value="actual">Actual</option>
            <option value="planned">Planned</option>
            <option value="compare">Compare</option>
          </select>
          {(
            [
              'calendarShowProjects',
              'calendarShowTopLevelTasks',
              'calendarShowProjectTasks',
            ] as const
          ).map((key, i) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => change({ [key]: e.target.checked })}
              />
              {['Projects', 'Top-level tasks', 'Project tasks'][i]}
            </label>
          ))}
          <select
            aria-label="Filter project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="">All projects</option>
            {items
              .filter((x) => x.kind === 'project')
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
          </select>
          {view === 'timeline' && (
            <select
              aria-label="Timeline range"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              <option value={1}>1 month</option>
              <option value={3}>3 months</option>
              <option value={6}>6 months</option>
            </select>
          )}
        </div>
      )}
      {view === 'month' || compact ? (
        <>
          <div className="weekdays">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <span key={d}>{compact ? d[0] : d}</span>
            ))}
          </div>
          <div className="month-grid">
            {days.map((day) => (
              <div
                key={day}
                className={`day ${day.slice(0, 7) !== localDate(month).slice(0, 7) ? 'outside' : ''} ${day === todayDate ? 'today' : ''}`}
              >
                <time>{Number(day.slice(-2))}</time>
                {entries
                  .filter((e) => e.start <= day && e.end >= day)
                  .slice(0, compact ? 1 : 4)
                  .map((e) => (
                    <button
                      key={`${e.item.id}-${e.mode}`}
                      className={`calendar-entry color-${token(e.item)} ${e.mode}`}
                      title={`${e.item.title} · ${e.label}${e.open ? ' · open-ended' : ''}`}
                      aria-label={`${e.item.title} · ${e.label}${e.open ? ' · open-ended' : ''}`}
                      onClick={() => onOpen(e.item)}
                    >
                      {compact
                        ? '•'
                        : `${e.item.kind === 'project' ? '▥' : '▪'} ${e.item.title}${e.open ? ' →' : ''}`}
                    </button>
                  ))}
                {!compact &&
                  entries.filter((e) => e.start <= day && e.end >= day).length >
                    4 && <small>More in timeline</small>}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="timeline">
          <div className="timeline-axis">
            <span>Work item</span>
            <span>
              {localDate(start)}{' '}
              <span className="float-right">{localDate(end)}</span>
            </span>
          </div>
          {entries
            .filter(
              (e) => e.start <= localDate(end) && e.end >= localDate(start),
            )
            .map((e) => {
              const left =
                (Math.max(0, dayMs(e.start) - dayMs(localDate(start))) /
                  rangeDays) *
                100;
              const width = Math.max(
                1,
                ((Math.min(dayMs(e.end), dayMs(localDate(end))) -
                  Math.max(dayMs(e.start), dayMs(localDate(start))) +
                  1) /
                  rangeDays) *
                  100,
              );
              const today =
                ((dayMs(todayDate) - dayMs(localDate(start))) / rangeDays) *
                100;
              return (
                <div className="timeline-row" key={`${e.item.id}-${e.mode}`}>
                  <button onClick={() => onOpen(e.item)}>
                    {e.item.title}
                    <small>
                      {e.label}
                      {e.open ? ' · open-ended' : ''}
                    </small>
                  </button>
                  <div className="timeline-track">
                    {today >= 0 && today <= 100 && (
                      <span
                        className="today-marker"
                        style={{ left: `${today}%` }}
                      />
                    )}
                    <button
                      aria-label={`${e.item.title}: ${e.label}, ${e.start} to ${e.end}${e.open ? ', open-ended' : ''}`}
                      className={`timeline-bar color-${token(e.item)} ${e.mode}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      onClick={() => onOpen(e.item)}
                    >
                      {e.open ? '→' : ' '}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
      {!entries.some(
        (e) => e.start <= localDate(end) && e.end >= localDate(start),
      ) && (
        <p className="muted calendar-empty">
          No visible work this month.
          {compact
            ? ' Projects appear here as you create them.'
            : ' Try another month or include tasks.'}
        </p>
      )}
    </section>
  );
}
