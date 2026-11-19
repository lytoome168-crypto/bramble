import { useEffect, useRef, useState, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Flag, GripVertical, UserRound, X } from 'lucide-react';
import {
  PRIORITY_COLORS, PRIORITY_LABELS, PRIORITY_ORDER, STATUS_COLORS, STATUS_LABELS, STATUS_ORDER,
  type Board, type CustomColumn, type Person, type Priority, type Status, type WorkItem,
} from '@shared/work';
import './BoardViews.css';

export interface BoardViewProps {
  board: Board;
  people: Person[];
  visibleItems: WorkItem[];
  onChange: (next: Board) => void;
}

// Date strings are calendar dates, not UTC timestamps. Keep all construction and
// addition in local time; use UTC only to count calendar-day boundaries.
function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}
function dayDifference(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}
function mondayOf(value: string): string {
  const day = parseDate(value).getDay();
  return addDays(value, -((day + 6) % 7));
}
function shortDate(value: string): string {
  const d = parseDate(value);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function updateItem(board: Board, id: string, patch: Partial<WorkItem>, onChange: (next: Board) => void) {
  if (!board.items.some(item => item.id === id)) return;
  onChange({ ...board, items: board.items.map(item => item.id === id ? { ...item, ...patch } : item) });
}
function initials(name: string) { return name.trim().slice(0, 1).toUpperCase() || '人'; }
function Avatar({ person }: { person?: Person }) {
  return person ? <span className="bv-avatar" style={{ backgroundColor: person.color }} title={person.name}>{initials(person.name)}</span>
    : <span className="bv-avatar bv-avatar-empty" title="未分配"><UserRound size={13} /></span>;
}
function PriorityTag({ priority }: { priority: Priority }) {
  return <span className="bv-priority" style={{ color: PRIORITY_COLORS[priority] }}><Flag size={12} fill="currentColor" />{PRIORITY_LABELS[priority]}</span>;
}

function ItemEditor({ item, people, columns, onClose, onSave }: {
  item: WorkItem; people: Person[]; columns: CustomColumn[]; onClose: () => void; onSave: (patch: Partial<WorkItem>) => void;
}) {
  const [draft, setDraft] = useState({
    name: item.name, assigneeId: item.assigneeId || '', status: item.status, priority: item.priority,
    startDate: item.startDate || '', dueDate: item.dueDate || '', notes: item.notes, custom: { ...item.custom },
  });
  const [error, setError] = useState('');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) { setError('请输入任务名称'); return; }
    if (draft.startDate && draft.dueDate && draft.startDate > draft.dueDate) {
      setError('结束日期不能早于开始日期'); return;
    }
    onSave({ ...draft, name: draft.name.trim(), assigneeId: draft.assigneeId || null, startDate: draft.startDate || null, dueDate: draft.dueDate || null });
  }
  return <div className="bv-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="bv-modal" role="dialog" aria-modal="true" aria-labelledby="bv-editor-title">
      <div className="bv-modal-heading"><div><span className="bv-eyebrow">任务详情</span><h2 id="bv-editor-title">编辑任务</h2></div><button type="button" className="bv-icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={save}>
        <label className="bv-field">任务名称<input autoFocus value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="输入任务名称" /></label>
        <div className="bv-field-grid">
          <label className="bv-field">负责人<select value={draft.assigneeId} onChange={e => setDraft({ ...draft, assigneeId: e.target.value })}><option value="">未分配</option>{people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
          <label className="bv-field">状态<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Status })}>{STATUS_ORDER.map(status => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select></label>
          <label className="bv-field">优先级<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as Priority })}>{PRIORITY_ORDER.map(priority => <option value={priority} key={priority}>{PRIORITY_LABELS[priority]}</option>)}</select></label>
          <div />
          <label className="bv-field">开始日期<input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
          <label className="bv-field">截止日期<input type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} /></label>
        </div>
        <label className="bv-field">备注<textarea rows={3} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="添加备注…" /></label>
        {columns.length > 0 && <div className="bv-field-grid">{columns.map(column => {
          const value = draft.custom[column.id] ?? '';
          const setValue = (next: string | number | null) => setDraft(current => ({ ...current, custom: { ...current.custom, [column.id]: next } }));
          return <label className="bv-field" key={column.id}>{column.name}
            {column.type === 'person' ? <select value={String(value)} onChange={e => setValue(e.target.value || null)}><option value="">未分配</option>{people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
              : column.type === 'status' ? <select value={String(value)} onChange={e => setValue(e.target.value || null)}><option value="">未设置</option>{(column.options || []).map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select>
              : <input type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'} value={String(value)} onChange={e => setValue(e.target.value === '' ? null : column.type === 'number' ? Number(e.target.value) : e.target.value)} />}
          </label>;
        })}</div>}
        {error && <p className="bv-error" role="alert">{error}</p>}
        <div className="bv-modal-actions"><button type="button" className="bv-secondary-button" onClick={onClose}>取消</button><button type="submit" className="bv-primary-button">保存更改</button></div>
      </form>
    </section>
  </div>;
}

function EditorHost({ board, people, editingId, setEditingId, onChange }: BoardViewProps & { editingId: string | null; setEditingId: (id: string | null) => void }) {
  const item = board.items.find(entry => entry.id === editingId);
  return item ? <ItemEditor key={item.id} item={item} people={people} columns={board.customColumns} onClose={() => setEditingId(null)} onSave={patch => { updateItem(board, item.id, patch, onChange); setEditingId(null); }} /> : null;
}
function startNativeDrag(event: DragEvent<HTMLElement>, id: string) {
  event.dataTransfer.setData('text/plain', id);
  event.dataTransfer.effectAllowed = 'move';
}
function dragId(event: DragEvent<HTMLElement>, visibleItems: WorkItem[]) {
  const id = event.dataTransfer.getData('text/plain');
  return visibleItems.some(item => item.id === id) ? id : null;
}

export function KanbanView(props: BoardViewProps) {
  const { board, people, visibleItems, onChange } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoverStatus, setHoverStatus] = useState<Status | null>(null);
  return <div className="bv-root bv-kanban-root">
    <div className="bv-view-intro"><span>按状态管理任务</span><span>拖动卡片以更新状态</span></div>
    <div className="bv-kanban">
      {STATUS_ORDER.map(status => {
        const items = visibleItems.filter(item => item.status === status);
        return <section className={`bv-kanban-column ${hoverStatus === status ? 'is-drag-over' : ''}`} key={status}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setHoverStatus(status); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoverStatus(null); }}
          onDrop={event => { event.preventDefault(); setHoverStatus(null); const id = dragId(event, visibleItems); if (id) updateItem(board, id, { status }, onChange); }}>
          <div className="bv-column-heading"><span className="bv-status-dot" style={{ background: STATUS_COLORS[status] }} /><strong>{STATUS_LABELS[status]}</strong><span className="bv-count">{items.length}</span></div>
          <div className="bv-column-cards">{items.map(item => {
            const person = people.find(p => p.id === item.assigneeId);
            const group = board.groups.find(g => g.id === item.groupId);
            return <button type="button" className="bv-card" key={item.id} draggable onDragStart={event => startNativeDrag(event, item.id)} onDragEnd={() => setHoverStatus(null)} onClick={() => setEditingId(item.id)}>
              <span className="bv-card-title">{item.name}</span>
              {group && <span className="bv-card-group"><span style={{ backgroundColor: group.color }} />{group.name}</span>}
              <span className="bv-card-bottom"><span className="bv-card-meta"><PriorityTag priority={item.priority} />{item.dueDate && <span className="bv-date"><CalendarDays size={12} />{shortDate(item.dueDate)}</span>}</span><Avatar person={person} /></span>
            </button>;
          })}{items.length === 0 && <div className="bv-empty-column">暂无任务</div>}</div>
        </section>;
      })}
    </div>
    <EditorHost {...props} editingId={editingId} setEditingId={setEditingId} />
  </div>;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
export function CalendarView(props: BoardViewProps) {
  const { board, people, visibleItems, onChange } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1, 12); });
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const today = dateKey(new Date());
  const first = dateKey(month);
  const gridStart = mondayOf(first);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const undated = visibleItems.filter(item => !item.dueDate);
  function moveMonth(amount: number) { setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1, 12)); }
  function renderEvent(item: WorkItem, undatedItem = false) {
    return <button type="button" key={item.id} className={`bv-calendar-event ${undatedItem ? 'is-undated' : ''}`} draggable
      onDragStart={event => startNativeDrag(event, item.id)} onDragEnd={() => setHoverDay(null)} onClick={() => setEditingId(item.id)} title={`${item.name} · ${STATUS_LABELS[item.status]}`}>
      <span className="bv-event-dot" style={{ backgroundColor: STATUS_COLORS[item.status] }} /><span>{item.name}</span>
    </button>;
  }
  return <div className="bv-root bv-calendar-root">
    <div className="bv-toolbar"><div className="bv-period"><CalendarDays size={18} /><strong>{month.getFullYear()}年 {month.getMonth() + 1}月</strong><div className="bv-period-nav"><button type="button" className="bv-icon-button" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button><button type="button" className="bv-icon-button" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button></div><button type="button" className="bv-today-button" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1, 12)); }}>今天</button></div><span className="bv-toolbar-hint" title="截止日期早于开始日期时，开始日期会同步调整">拖动任务以调整截止日期</span></div>
    <div className="bv-calendar-layout">
      <div className="bv-calendar-scroll"><div className="bv-calendar-grid">
        {WEEKDAYS.map(day => <div className="bv-weekday" key={day}>周{day}</div>)}
        {days.map(day => {
          const date = parseDate(day);
          const currentMonth = date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear();
          const items = visibleItems.filter(item => item.dueDate === day);
          return <div key={day} className={`bv-calendar-day ${!currentMonth ? 'is-outside' : ''} ${hoverDay === day ? 'is-drag-over' : ''}`}
            onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setHoverDay(day); }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoverDay(null); }}
            onDrop={event => { event.preventDefault(); setHoverDay(null); const id = dragId(event, visibleItems); const item = board.items.find(entry => entry.id === id); if (item) updateItem(board, item.id, { dueDate: day, ...(item.startDate && item.startDate > day ? { startDate: day } : {}) }, onChange); }}>
            <div className="bv-day-heading"><span className={day === today ? 'is-today' : ''}>{date.getDate()}</span></div>
            <div className="bv-day-events">{items.map(item => renderEvent(item))}</div>
          </div>;
        })}
      </div></div>
      <aside className="bv-undated"><div className="bv-undated-heading"><div><strong>未安排日期</strong><p>拖动任务到日历中安排</p></div><span className="bv-count">{undated.length}</span></div><div className="bv-undated-list">{undated.map(item => renderEvent(item, true))}{undated.length === 0 && <div className="bv-undated-empty">所有任务都有截止日期</div>}</div></aside>
    </div>
    <EditorHost {...props} editingId={editingId} setEditingId={setEditingId} />
  </div>;
}

const DAY_WIDTH = 36;
const DAYS_SHOWN = 42;
type TimelineDragMode = 'move' | 'start' | 'end';
type TimelineDraft = { id: string; start: string; end: string };
function itemRange(item: WorkItem): { start: string; end: string } | null {
  const start = item.startDate || item.dueDate;
  const end = item.dueDate || item.startDate;
  if (!start || !end) return null;
  return { start, end: end < start ? start : end };
}
function movedRange(start: string, end: string, mode: TimelineDragMode, delta: number) {
  if (mode === 'move') return { start: addDays(start, delta), end: addDays(end, delta) };
  if (mode === 'start') { const next = addDays(start, delta); return { start: next > end ? end : next, end }; }
  const next = addDays(end, delta); return { start, end: next < start ? start : next };
}

export function TimelineView(props: BoardViewProps) {
  const { board, people, visibleItems, onChange } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [axisStart, setAxisStart] = useState(() => {
    const today = dateKey(new Date());
    const first = visibleItems.map(itemRange).filter((range): range is { start: string; end: string } => !!range).sort((a, b) => a.start.localeCompare(b.start))[0];
    // Start around today where possible; otherwise open at the first scheduled task.
    const start = mondayOf(addDays(today, -7));
    return first && (first.start > addDays(start, DAYS_SHOWN - 1) || first.end < start) ? mondayOf(first.start) : start;
  });
  const [draft, setDraft] = useState<TimelineDraft | null>(null);
  const boardRef = useRef(board); boardRef.current = board;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => { cleanupRef.current?.(); }, []);
  const today = dateKey(new Date());
  const axisEnd = addDays(axisStart, DAYS_SHOWN - 1);
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(axisStart, i));
  const months: { label: string; days: number }[] = [];
  days.forEach(day => { const d = parseDate(day); const label = `${d.getFullYear()}年 ${d.getMonth() + 1}月`; const last = months[months.length - 1]; if (last?.label === label) last.days++; else months.push({ label, days: 1 }); });
  const todayOffset = dayDifference(today, axisStart);
  function beginDrag(event: ReactPointerEvent, item: WorkItem, mode: TimelineDragMode) {
    if (event.button !== 0) return;
    const range = itemRange(item); if (!range) return;
    event.preventDefault(); event.stopPropagation();
    cleanupRef.current?.();
    const startX = event.clientX;
    let moved = false;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = Math.round((moveEvent.clientX - startX) / DAY_WIDTH);
      if (Math.abs(moveEvent.clientX - startX) > 3) moved = true;
      setDraft({ id: item.id, ...movedRange(range.start, range.end, mode, delta) });
    };
    const cleanup = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); cleanupRef.current = null; };
    const onUp = (upEvent: PointerEvent) => {
      const delta = Math.round((upEvent.clientX - startX) / DAY_WIDTH);
      cleanup(); setDraft(null);
      if (moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
      if (delta !== 0) { const next = movedRange(range.start, range.end, mode, delta); updateItem(boardRef.current, item.id, { startDate: next.start, dueDate: next.end }, onChangeRef.current); }
      else if (!moved && mode === 'move') setEditingId(item.id);
    };
    const onCancel = () => { cleanup(); setDraft(null); };
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel);
  }
  return <div className="bv-root bv-timeline-root">
    <div className="bv-toolbar"><div className="bv-period"><Clock3 size={18} /><strong>项目时间线</strong><div className="bv-period-nav"><button type="button" className="bv-icon-button" aria-label="向前四周" onClick={() => setAxisStart(addDays(axisStart, -28))}><ChevronLeft size={17} /></button><button type="button" className="bv-icon-button" aria-label="向后四周" onClick={() => setAxisStart(addDays(axisStart, 28))}><ChevronRight size={17} /></button></div><button type="button" className="bv-today-button" onClick={() => setAxisStart(mondayOf(addDays(dateKey(new Date()), -7)))}>今天</button></div><span className="bv-toolbar-hint">拖动任务调整排期，拖动两端调整日期</span></div>
    <div className="bv-timeline-scroll"><div className="bv-timeline-table" style={{ width: 220 + DAYS_SHOWN * DAY_WIDTH }}>
      <div className="bv-timeline-header"><div className="bv-timeline-label bv-timeline-label-header">任务 <span>{visibleItems.length}</span></div><div className="bv-timeline-axis" style={{ width: DAYS_SHOWN * DAY_WIDTH }}>
        <div className="bv-months">{months.map(month => <div key={month.label} style={{ width: month.days * DAY_WIDTH }}>{month.label}</div>)}</div>
        <div className="bv-days">{days.map(day => { const d = parseDate(day); return <div key={day} className={`${day === today ? 'is-today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'is-weekend' : ''}`}><span>{WEEKDAYS[(d.getDay() + 6) % 7]}</span><strong>{d.getDate()}</strong></div>; })}</div>
      </div></div>
      {visibleItems.map(item => {
        const range = draft?.id === item.id ? { start: draft.start, end: draft.end } : itemRange(item);
        const person = people.find(p => p.id === item.assigneeId);
        const isVisible = range && range.end >= axisStart && range.start <= axisEnd;
        const left = range ? dayDifference(range.start, axisStart) * DAY_WIDTH : 0;
        const width = range ? (dayDifference(range.end, range.start) + 1) * DAY_WIDTH : 0;
        return <div className="bv-timeline-row" key={item.id}>
          <button type="button" className="bv-timeline-label bv-row-label" onClick={() => setEditingId(item.id)} title={item.name}><span className="bv-status-dot" style={{ backgroundColor: STATUS_COLORS[item.status] }} /><span className="bv-row-name">{item.name}</span><Avatar person={person} /></button>
          <div className="bv-timeline-track" style={{ width: DAYS_SHOWN * DAY_WIDTH }}>
            {todayOffset >= 0 && todayOffset < DAYS_SHOWN && <div className="bv-today-line" style={{ left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2 }} />}
            {isVisible && range && <div className="bv-timeline-bar" role="button" tabIndex={0} aria-label={`${item.name}，${range.start}至${range.end}。点击编辑，拖动调整日期`} title={`${item.name} · ${range.start} 至 ${range.end}`} style={{ left, width, backgroundColor: STATUS_COLORS[item.status] }} onPointerDown={event => beginDrag(event, item, 'move')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditingId(item.id); } }} onClick={() => { if (!suppressClick.current) setEditingId(item.id); }}>
              <span className="bv-bar-handle is-start" onPointerDown={event => beginDrag(event, item, 'start')} title="调整开始日期" /><span className="bv-bar-text">{item.name}</span><span className="bv-bar-handle is-end" onPointerDown={event => beginDrag(event, item, 'end')} title="调整截止日期" />
            </div>}
            {!range && <button type="button" className="bv-set-dates" onClick={() => setEditingId(item.id)}>+ 设置日期</button>}
            {range && !isVisible && <button type="button" className="bv-offscreen" onClick={() => setAxisStart(mondayOf(range.start))}>定位任务 · {shortDate(range.start)}</button>}
          </div>
        </div>;
      })}
      {visibleItems.length === 0 && <div className="bv-timeline-empty">没有符合筛选条件的任务</div>}
    </div></div>
    <div className="bv-timeline-legend"><span><i /> 今天</span><span><GripVertical size={13} /> 点击任务编辑详情</span><span>仅有一个日期的任务按单日显示</span></div>
    <EditorHost {...props} editingId={editingId} setEditingId={setEditingId} />
  </div>;
}
