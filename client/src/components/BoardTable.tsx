import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  type Board,
  type ColumnType,
  type CustomColumn,
  type Person,
  type Priority,
  type Status,
  type StatusOption,
  type WorkItem,
} from '@shared/work';
import './BoardTable.css';

type BoardTableProps = {
  board: Board;
  people: Person[];
  visibleItems: WorkItem[];
  onChange: (next: Board) => void;
};

const GROUP_COLORS = ['#28745f', '#d89524', '#6289ba', '#b36e68', '#8a819e', '#71978a'];
const COLUMN_TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'status', label: '状态' },
  { value: 'person', label: '人员' },
];

function defaultOptions(): StatusOption[] {
  return [
    { id: nanoid(), label: '待处理', color: '#a9afb5' },
    { id: nanoid(), label: '进行中', color: '#d89524' },
    { id: nanoid(), label: '已完成', color: '#4c9b76' },
  ];
}

// Names must stay nonempty on the saved board, while allowing an empty draft
// briefly when a person selects all and starts typing a replacement.
function EditableName({ value, label, placeholder, className, autoSize, onChange }: {
  value: string;
  label: string;
  placeholder: string;
  className: string;
  autoSize?: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return (
    <input
      className={className}
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      maxLength={200}
      size={autoSize ? Math.max(5, Math.min(28, draft.length + 1)) : undefined}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setDraft(value); }}
      onChange={event => {
        const next = event.target.value;
        setDraft(next);
        if (next.trim()) onChange(next);
      }}
    />
  );
}

function StatusSummary({ items }: { items: WorkItem[] }) {
  const counts = STATUS_ORDER.map(status => ({
    status,
    count: items.filter(item => item.status === status).length,
  }));
  const description = counts.map(({ status, count }) => `${STATUS_LABELS[status]} ${count}`).join('，');

  return (
    <div className="board-table-summary-track" role="img" aria-label={`状态分布：${description}`} title={description}>
      {items.length === 0 ? (
        <span className="board-table-summary-empty" />
      ) : counts.map(({ status, count }) => count > 0 && (
        <span key={status} style={{ flexGrow: count, backgroundColor: STATUS_COLORS[status] }} />
      ))}
    </div>
  );
}

function PersonSelect({
  value,
  people,
  label,
  onChange,
}: {
  value: string | null;
  people: Person[];
  label: string;
  onChange: (value: string | null) => void;
}) {
  const person = people.find(entry => entry.id === value);
  return (
    <div className="board-table-person">
      {person && <span className="board-table-person-avatar" style={{ backgroundColor: person.color }} aria-hidden="true">{person.name.slice(0, 1)}</span>}
      <select
        className={`board-table-person-select${person ? ' has-person' : ''}`}
        aria-label={label}
        value={value ?? ''}
        onChange={event => onChange(event.target.value || null)}
      >
        <option value="">未分配</option>
        {value && !person && <option value={value}>未知成员</option>}
        {people.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select>
    </div>
  );
}

function CustomCell({
  column,
  item,
  people,
  update,
}: {
  column: CustomColumn;
  item: WorkItem;
  people: Person[];
  update: (value: string | number | null) => void;
}) {
  const value = item.custom?.[column.id] ?? null;
  const label = `${item.name || '条目'}的${column.name}`;

  if (column.type === 'person') {
    return <PersonSelect value={value == null ? null : String(value)} people={people} label={label} onChange={update} />;
  }
  if (column.type === 'status') {
    const options = column.options ?? [];
    const current = options.find(option => option.id === String(value));
    return (
      <select
        className={`board-table-color-select${current ? '' : ' is-empty'}`}
        aria-label={label}
        value={value == null ? '' : String(value)}
        style={current ? { backgroundColor: current.color } : undefined}
        onChange={event => update(event.target.value || null)}
      >
        <option value="">未设置</option>
        {value != null && !current && <option value={String(value)}>未知状态</option>}
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    );
  }
  return (
    <input
      className={`board-table-cell-input${column.type === 'date' ? ' is-date' : ''}`}
      type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
      aria-label={label}
      placeholder={column.type === 'text' ? '—' : undefined}
      maxLength={column.type === 'text' ? 4000 : undefined}
      value={value == null ? '' : String(value)}
      onChange={event => {
        const next = event.target.value;
        update(next === '' ? null : column.type === 'number' ? Number(next) : next);
      }}
    />
  );
}

export default function BoardTable({ board, people, visibleItems, onChange }: BoardTableProps) {
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [columnName, setColumnName] = useState('');
  const [columnType, setColumnType] = useState<ColumnType>('text');
  const [options, setOptions] = useState<StatusOption[]>(defaultOptions);
  const [columnError, setColumnError] = useState('');
  const [deleteColumnId, setDeleteColumnId] = useState<string | null>(null);

  // Resolve visible IDs against the full board so filtered edits never replace hidden items.
  const visibleIds = useMemo(() => new Set(visibleItems.map(item => item.id)), [visibleItems]);
  const visibleByGroup = useMemo(() => {
    const grouped = new Map<string, WorkItem[]>();
    for (const item of board.items) {
      if (!visibleIds.has(item.id)) continue;
      const rows = grouped.get(item.groupId) ?? [];
      rows.push(item);
      grouped.set(item.groupId, rows);
    }
    return grouped;
  }, [board.items, visibleIds]);

  const updateItem = (id: string, patch: Partial<WorkItem>) => {
    onChange({ ...board, items: board.items.map(item => item.id === id ? { ...item, ...patch } : item) });
  };
  const updateCustom = (item: WorkItem, columnId: string, value: string | number | null) => {
    updateItem(item.id, { custom: { ...item.custom, [columnId]: value } });
  };
  const updateGroup = (id: string, patch: Partial<Board['groups'][number]>) => {
    onChange({ ...board, groups: board.groups.map(group => group.id === id ? { ...group, ...patch } : group) });
  };
  const addGroup = () => {
    onChange({
      ...board,
      groups: [...board.groups, { id: nanoid(), name: '新分组', color: GROUP_COLORS[board.groups.length % GROUP_COLORS.length] }],
    });
  };
  const addItem = (groupId: string) => {
    const item: WorkItem = {
      id: nanoid(), groupId, name: '新条目', status: 'not_started', assigneeId: null,
      startDate: null, dueDate: null, priority: 'medium', notes: '', custom: {},
    };
    onChange({ ...board, items: [...board.items, item] });
  };
  const resetColumnForm = () => {
    setColumnName('');
    setColumnType('text');
    setOptions(defaultOptions());
    setColumnError('');
  };
  const createColumn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = columnName.trim();
    if (!name) {
      setColumnError('请输入列名。');
      return;
    }
    if (columnType === 'status' && (!options.length || options.some(option => !option.label.trim()))) {
      setColumnError('请至少添加一个状态，并填写每个状态的名称。');
      return;
    }
    const column: CustomColumn = {
      id: nanoid(), name, type: columnType,
      ...(columnType === 'status' ? { options: options.map(option => ({ ...option, label: option.label.trim() })) } : {}),
    };
    onChange({ ...board, customColumns: [...board.customColumns, column] });
    setColumnDialogOpen(false);
    resetColumnForm();
  };
  const deleteColumn = () => {
    if (!deleteColumnId) return;
    onChange({
      ...board,
      customColumns: board.customColumns.filter(column => column.id !== deleteColumnId),
      items: board.items.map(item => {
        const custom = { ...item.custom };
        delete custom[deleteColumnId];
        return { ...item, custom };
      }),
    });
    setDeleteColumnId(null);
  };
  const columnToDelete = board.customColumns.find(column => column.id === deleteColumnId);
  const tableWidth = 260 + 140 + 142 + 142 + 142 + 120 + 220 + board.customColumns.length * 150 + 46;

  return (
    <div className="board-table">
      <div className="board-table-scroll">
        <div className="board-table-canvas" style={{ minWidth: tableWidth }}>
          {board.groups.map(group => {
            const items = visibleByGroup.get(group.id) ?? [];
            const total = board.items.filter(item => item.groupId === group.id).length;
            return (
              <section className="board-table-group" key={group.id} aria-label={group.name || '未命名分组'}>
                <div className="board-table-group-heading">
                  <button
                    type="button"
                    className="board-table-icon-button board-table-collapse"
                    aria-label={`${group.collapsed ? '展开' : '折叠'}${group.name || '分组'}`}
                    aria-expanded={!group.collapsed}
                    onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })}
                  >
                    {group.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  </button>
                  <span className="board-table-group-color-wrap" title="更改分组颜色">
                    <input className="board-table-group-color" type="color" aria-label={`更改${group.name || '分组'}颜色`} value={group.color} onChange={event => updateGroup(group.id, { color: event.target.value })} />
                  </span>
                  <EditableName
                    className="board-table-group-name"
                    label="分组名称"
                    value={group.name}
                    autoSize
                    placeholder="未命名分组"
                    onChange={name => updateGroup(group.id, { name })}
                  />
                  <span className="board-table-group-count">{items.length} 项{items.length !== total ? ` / 共 ${total} 项` : ''}</span>
                  {group.collapsed && <div className="board-table-collapsed-summary"><StatusSummary items={items} /></div>}
                </div>
                {!group.collapsed && (
                  <table className="board-table-grid" style={{ minWidth: tableWidth }}>
                    <colgroup>
                      <col style={{ width: 260 }} /><col style={{ width: 140 }} /><col style={{ width: 142 }} />
                      <col style={{ width: 142 }} /><col style={{ width: 142 }} /><col style={{ width: 120 }} />
                      <col style={{ width: 220 }} />
                      {board.customColumns.map(column => <col key={column.id} style={{ width: 150 }} />)}
                      <col style={{ width: 46 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col" className="board-table-name-heading" style={{ borderLeftColor: group.color }}>条目名称</th>
                        <th scope="col">状态</th><th scope="col">负责人</th><th scope="col">开始日期</th>
                        <th scope="col">截止日期</th><th scope="col">优先级</th><th scope="col">备注</th>
                        {board.customColumns.map(column => (
                          <th scope="col" key={column.id}>
                            <div className="board-table-column-heading">
                              <span title={column.name}>{column.name}</span>
                              <button type="button" className="board-table-icon-button board-table-delete-column" aria-label={`删除${column.name}列`} title="删除列" onClick={() => setDeleteColumnId(column.id)}><Trash2 size={13} /></button>
                            </div>
                          </th>
                        ))}
                        <th scope="col" className="board-table-add-column-cell">
                          <button type="button" className="board-table-icon-button" title="添加自定义列" aria-label="添加自定义列" onClick={() => setColumnDialogOpen(true)}><Plus size={16} /></button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id}>
                          <td className="board-table-name-cell" style={{ borderLeftColor: group.color }}>
                            <EditableName className="board-table-cell-input board-table-item-name" label="条目名称" value={item.name} placeholder="未命名条目" onChange={name => updateItem(item.id, { name })} />
                          </td>
                          <td className="board-table-colored-cell">
                            <select className="board-table-color-select" aria-label={`${item.name || '条目'}的状态`} value={item.status} style={{ backgroundColor: STATUS_COLORS[item.status] }} onChange={event => updateItem(item.id, { status: event.target.value as Status })}>
                              {STATUS_ORDER.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                            </select>
                          </td>
                          <td><PersonSelect value={item.assigneeId} people={people} label={`${item.name || '条目'}的负责人`} onChange={assigneeId => updateItem(item.id, { assigneeId })} /></td>
                          <td><input className="board-table-cell-input is-date" type="date" aria-label={`${item.name || '条目'}的开始日期`} title="开始日期不能晚于截止日期" max={item.dueDate ?? undefined} value={item.startDate ?? ''} onChange={event => { const startDate = event.target.value || null; if (!startDate || !item.dueDate || startDate <= item.dueDate) updateItem(item.id, { startDate }); }} /></td>
                          <td><input className="board-table-cell-input is-date" type="date" aria-label={`${item.name || '条目'}的截止日期`} title="截止日期不能早于开始日期" min={item.startDate ?? undefined} value={item.dueDate ?? ''} onChange={event => { const dueDate = event.target.value || null; if (!dueDate || !item.startDate || dueDate >= item.startDate) updateItem(item.id, { dueDate }); }} /></td>
                          <td className="board-table-colored-cell">
                            <select className="board-table-color-select" aria-label={`${item.name || '条目'}的优先级`} value={item.priority} style={{ backgroundColor: PRIORITY_COLORS[item.priority] }} onChange={event => updateItem(item.id, { priority: event.target.value as Priority })}>
                              {PRIORITY_ORDER.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
                            </select>
                          </td>
                          <td><input className="board-table-cell-input" aria-label={`${item.name || '条目'}的备注`} placeholder="添加备注" maxLength={10000} value={item.notes} onChange={event => updateItem(item.id, { notes: event.target.value })} /></td>
                          {board.customColumns.map(column => (
                            <td key={column.id}><CustomCell column={column} item={item} people={people} update={value => updateCustom(item, column.id, value)} /></td>
                          ))}
                          <td className="board-table-end-cell" />
                        </tr>
                      ))}
                      <tr className="board-table-add-row">
                        <td className="board-table-name-cell" style={{ borderLeftColor: group.color }}>
                          <button type="button" onClick={() => addItem(group.id)}><Plus size={14} /> 添加条目</button>
                        </td>
                        <td colSpan={6 + board.customColumns.length + 1} />
                      </tr>
                      <tr className="board-table-summary-row">
                        <td><span>状态汇总</span></td>
                        <td><StatusSummary items={items} /></td>
                        <td colSpan={5 + board.customColumns.length + 1} />
                      </tr>
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
          <div className="board-table-actions">
            <button type="button" className="board-table-add-group" onClick={addGroup}><Plus size={15} /> 添加分组</button>
            <button type="button" className="board-table-add-group" onClick={() => setColumnDialogOpen(true)}><Plus size={15} /> 添加自定义列</button>
          </div>
        </div>
      </div>

      <Dialog.Root open={columnDialogOpen} onOpenChange={open => { setColumnDialogOpen(open); if (!open) resetColumnForm(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="board-table-overlay" />
          <Dialog.Content className="board-table-dialog" onOpenAutoFocus={event => { event.preventDefault(); document.getElementById('board-table-column-name')?.focus(); }}>
            <div className="board-table-dialog-heading">
              <div><Dialog.Title className="board-table-dialog-title">添加自定义列</Dialog.Title><Dialog.Description className="board-table-dialog-description">为看板添加一个适合团队的字段。</Dialog.Description></div>
              <Dialog.Close className="board-table-dialog-close" aria-label="关闭"><X size={17} /></Dialog.Close>
            </div>
            <form onSubmit={createColumn}>
              <label className="board-table-field-label" htmlFor="board-table-column-name">列名</label>
              <input id="board-table-column-name" className="board-table-form-input" value={columnName} onChange={event => { setColumnName(event.target.value); setColumnError(''); }} placeholder="例如：项目阶段" maxLength={80} />
              <label className="board-table-field-label" htmlFor="board-table-column-type">字段类型</label>
              <select id="board-table-column-type" className="board-table-form-input" value={columnType} onChange={event => { setColumnType(event.target.value as ColumnType); setColumnError(''); }}>
                {COLUMN_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
              {columnType === 'status' && (
                <div className="board-table-options-editor">
                  <div className="board-table-options-header"><span className="board-table-field-label">状态选项</span><span>自定义名称和颜色</span></div>
                  {options.map((option, index) => (
                    <div className="board-table-option-row" key={option.id}>
                      <input type="color" className="board-table-option-color" aria-label={`状态选项 ${index + 1} 的颜色`} value={option.color} onChange={event => setOptions(options.map(entry => entry.id === option.id ? { ...entry, color: event.target.value } : entry))} />
                      <input className="board-table-form-input" aria-label={`状态选项 ${index + 1} 的名称`} placeholder="状态名称" value={option.label} onChange={event => { setOptions(options.map(entry => entry.id === option.id ? { ...entry, label: event.target.value } : entry)); setColumnError(''); }} maxLength={60} />
                      <button type="button" className="board-table-dialog-icon" aria-label={`删除状态选项 ${option.label || index + 1}`} onClick={() => setOptions(options.filter(entry => entry.id !== option.id))}><X size={15} /></button>
                    </div>
                  ))}
                  <button type="button" className="board-table-add-option" onClick={() => setOptions([...options, { id: nanoid(), label: '', color: GROUP_COLORS[options.length % GROUP_COLORS.length] }])}><Plus size={14} /> 添加选项</button>
                </div>
              )}
              {columnError && <p className="board-table-form-error" role="alert">{columnError}</p>}
              <div className="board-table-dialog-actions"><Dialog.Close className="board-table-button-secondary">取消</Dialog.Close><button type="submit" className="board-table-button-primary">添加列</button></div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={deleteColumnId !== null} onOpenChange={open => { if (!open) setDeleteColumnId(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="board-table-overlay" />
          <Dialog.Content className="board-table-dialog board-table-confirm-dialog">
            <div className="board-table-dialog-heading">
              <div><Dialog.Title className="board-table-dialog-title">删除“{columnToDelete?.name}”列？</Dialog.Title><Dialog.Description className="board-table-dialog-description">此操作会同时删除所有条目中该列的值，且无法撤销。</Dialog.Description></div>
              <Dialog.Close className="board-table-dialog-close" aria-label="关闭"><X size={17} /></Dialog.Close>
            </div>
            <div className="board-table-dialog-actions"><Dialog.Close className="board-table-button-secondary">取消</Dialog.Close><button type="button" className="board-table-button-danger" onClick={deleteColumn}>删除列</button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
