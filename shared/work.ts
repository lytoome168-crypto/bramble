export type Status = 'not_started' | 'in_progress' | 'blocked' | 'review' | 'done';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';
export type ColumnType = 'text' | 'number' | 'date' | 'status' | 'person';
export interface Person { id: string; name: string; role: string; color: string; userId?: number | null }
export interface StatusOption { id: string; label: string; color: string }
export interface CustomColumn { id: string; name: string; type: ColumnType; options?: StatusOption[] }
export interface WorkItem { id: string; groupId: string; name: string; status: Status; assigneeId: string | null; startDate: string | null; dueDate: string | null; priority: Priority; notes: string; custom: Record<string, string | number | null> }
export interface Group { id: string; name: string; color: string; collapsed?: boolean }
export interface Board { id: string; revision?: number; name: string; description: string; groups: Group[]; items: WorkItem[]; customColumns: CustomColumn[]; automation: { completionEnabled: boolean; digestEnabled: boolean; scheduleStatus?: string } }
export interface Notification { id: string; boardId: string; personId: string; title: string; body: string; createdAt: string; read: boolean; kind: 'completion' | 'digest' }
export interface RunLog { id: string; boardId: string; kind: 'manual' | 'scheduled' | 'completion'; status: string; message: string; createdAt: string }
export interface WorkspaceData { boards: Board[]; people: Person[]; notifications: Notification[]; logs: RunLog[] }
export const STATUS_LABELS: Record<Status,string> = { not_started:'未开始', in_progress:'进行中', blocked:'受阻', review:'审核中', done:'已完成' };
export const STATUS_COLORS: Record<Status,string> = { not_started:'#a9afb5', in_progress:'#d89524', blocked:'#cf5856', review:'#6289ba', done:'#4c9b76' };
export const PRIORITY_LABELS: Record<Priority,string> = { urgent:'紧急', high:'高', medium:'中', low:'低' };
export const PRIORITY_COLORS: Record<Priority,string> = { urgent:'#c25b58', high:'#d78353', medium:'#d7ad58', low:'#89a596' };
export const STATUS_ORDER: Status[] = ['not_started','in_progress','blocked','review','done'];
export const PRIORITY_ORDER: Priority[] = ['urgent','high','medium','low'];
export function singaporeToday(): string { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export function isOverdue(item: WorkItem, today = singaporeToday()): boolean { return !!item.dueDate && item.dueDate < today && item.status !== 'done'; }
