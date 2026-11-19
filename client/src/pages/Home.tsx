import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Bolt, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Filter, FolderClosed, Grid2X2, Inbox, Layers3, LayoutGrid, ListTodo, LoaderCircle, LogOut, Menu, MoreHorizontal, Plus, Search, SlidersHorizontal, Sparkles, Table2, Users, X, Zap } from 'lucide-react';
import { useAuth } from '@/_core/hooks/useAuth';
import { startLogin } from '@/const';
import { trpc } from '@/lib/trpc';
import { TRPCClientError } from '@trpc/client';
import BoardTable from '@/components/BoardTable';
import { KanbanView, CalendarView, TimelineView } from '@/components/BoardViews';
import { isOverdue, type Board, type Notification, type WorkspaceData } from '@shared/work';
import { toast } from 'sonner';

type View = 'table' | 'kanban' | 'calendar' | 'timeline';
type ModalName = 'ai' | 'automation' | 'inbox' | 'newBoard' | 'people' | null;

function Logo({ small = false }: {small?: boolean}) {
  return <span className={`logo-mark ${small ? 'small' : ''}`} aria-hidden="true"><svg viewBox="0 0 28 28" fill="none"><path d="M8 5.5v17M14 5.5v17M20 5.5v17M5.5 8h17M5.5 14h17M5.5 20h17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M7 7l14 14M21 7L7 21" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/></svg></span>;
}
function Modal({ title, eyebrow, children, onClose, wide = false }: {title:string; eyebrow?:string; children:React.ReactNode; onClose:()=>void; wide?:boolean}) {
  useEffect(() => { const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape') onClose()}; window.addEventListener('keydown',onKey); return()=>window.removeEventListener('keydown',onKey); },[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget) onClose()}}><section className={`modal-card ${wide?'modal-wide':''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div>{eyebrow&&<div className="modal-eyebrow">{eyebrow}</div>}<h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={17}/></button></div>{children}</section></div>;
}
function Avatar({name,color,size='normal'}:{name:string;color:string;size?:'normal'|'large'}) {
 const initials=name.trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
 return <span className={`avatar ${size==='large'?'avatar-large':''}`} style={{background:color}} title={name}>{initials}</span>
}
function relativeTime(s:string) { const d=new Date(s); return Number.isNaN(d.getTime()) ? s : new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Singapore'}).format(d); }

export default function Home() {
  const auth=useAuth();
  const query=trpc.workspace.get.useQuery(undefined,{enabled:auth.isAuthenticated,retry:1,refetchOnWindowFocus:true,refetchInterval:15000});
  const save=trpc.workspace.saveBoard.useMutation();
  const create=trpc.workspace.createBoard.useMutation();
  const createAI=trpc.workspace.createAI.useMutation();
  const createPerson=trpc.workspace.createPerson.useMutation();
  const linkPerson=trpc.workspace.linkPerson.useMutation();
  const runDigest=trpc.workspace.runDigest.useMutation();
  const markRead=trpc.workspace.markRead.useMutation();
  const [data,setData]=useState<WorkspaceData|null>(null);
  const [boardId,setBoardId]=useState<string>('');
  const [view,setView]=useState<View>('table');
  const [search,setSearch]=useState('');
  const [personFilter,setPersonFilter]=useState('');
  const [onlyOverdue,setOnlyOverdue]=useState(false);
  const [modal,setModal]=useState<ModalName>(null);
  const [aiPrompt,setAiPrompt]=useState('');
  const [newName,setNewName]=useState('');
  const [newPersonName,setNewPersonName]=useState('');
  const [newPersonRole,setNewPersonRole]=useState('');
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const [saveConflict,setSaveConflict]=useState(false);
  const [mobileNav,setMobileNav]=useState(false);
  const pending=useRef<Map<string,Board>>(new Map());
  const writing=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const inflight=useRef<Promise<void>|null>(null);
  const dataRef=useRef<WorkspaceData|null>(null);
  const saveRef=useRef(save.mutateAsync); saveRef.current=save.mutateAsync;
  useEffect(()=>{dataRef.current=data},[data]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(pending.current.size||writing.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[]);
  useEffect(()=>{if(query.data && !writing.current && pending.current.size===0){setData(query.data as WorkspaceData);setBoardId(old=>old && query.data.boards.some((x:Board)=>x.id===old)?old:query.data.boards[0]?.id||'')}},[query.data]);
  const board=data?.boards.find(x=>x.id===boardId)||data?.boards[0];
  const people=data?.people||[];
  const myPerson=people.find(p=>p.userId===auth.user?.id);
  const filtered=useMemo(()=>{if(!board)return [];const q=search.trim().toLocaleLowerCase();return board.items.filter(i=>(!q||`${i.name} ${i.notes}`.toLocaleLowerCase().includes(q))&&(!personFilter||i.assigneeId===personFilter)&&(!onlyOverdue||isOverdue(i)))},[board,search,personFilter,onlyOverdue]);
  const unread=(data?.notifications||[]).filter(n=>!n.read).length;
  function flush():Promise<void>{
    if(inflight.current)return inflight.current.then(()=>pending.current.size?flush():undefined);
    writing.current=true; setSaving(true);
    const operation=Promise.resolve().then(async()=>{
      let active:[string,Board]|undefined;
      try { while(pending.current.size){active=pending.current.entries().next().value as [string,Board];pending.current.delete(active[0]);const saved=await saveRef.current({board:active[1]});const queued=pending.current.get(active[0]);if(queued)pending.current.set(active[0],{...queued,revision:saved.revision});setData(old=>old?{...old,boards:old.boards.map(b=>b.id===saved.id?{...b,revision:saved.revision}:b)}:old);active=undefined;}setSaveError(false);setSaveConflict(false);const refreshed=await query.refetch();if(refreshed.data)setData(old=>old?{...old,notifications:refreshed.data!.notifications,logs:refreshed.data!.logs}:old); }
      catch(e){if(active&&!pending.current.has(active[0]))pending.current.set(active[0],active[1]);const conflict=e instanceof TRPCClientError && e.data?.code==='CONFLICT';setSaveConflict(conflict);setSaveError(true);toast.error(conflict?'其他成员已修改此看板，本地更改尚未保存':'保存失败，请重试',{description:conflict?'点击右上角状态可选择放弃本地更改并加载最新版本。':e instanceof Error?e.message:'网络连接异常'});throw e;}
      finally {writing.current=false;setSaving(false);inflight.current=null}
    });
    inflight.current=operation;
    return operation;
  }
  function updateBoard(next:Board){
    setData(old=>old?{...old,boards:old.boards.map(b=>b.id===next.id?next:b)}:old);
    setSaving(true);
    pending.current.set(next.id,next); if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{void flush().catch(()=>{})},400);
  }
  async function reload(){if(timer.current)clearTimeout(timer.current);if(pending.current.size||writing.current)await flush();const r=await query.refetch();if(r.data){const fresh=r.data as WorkspaceData;setData(old=>({...fresh,boards:fresh.boards.map(b=>(pending.current.has(b.id)||writing.current)?old?.boards.find(x=>x.id===b.id)||b:b)}));return fresh}return null;}
  async function resolveConflict(){if(!window.confirm('其他成员更新了看板。放弃本地尚未保存的更改并加载最新版本？'))return;pending.current.clear();setSaveError(false);setSaveConflict(false);setSaving(false);const r=await query.refetch();if(r.data)setData(r.data as WorkspaceData);}
  async function makeBoard(){if(!newName.trim())return;try{const result=await create.mutateAsync({name:newName.trim()});const next=await reload();setBoardId((result as Board).id || next?.boards.at(-1)?.id || '');setNewName('');setModal(null);setView('table');toast.success('看板已创建')}catch(e){toast.error(e instanceof Error?e.message:'创建失败')}}
  async function makeAI(){if(!aiPrompt.trim())return;try{const result=await createAI.mutateAsync({prompt:aiPrompt.trim()});await reload();setBoardId(result.board.id);setAiPrompt('');setModal(null);setView('table');toast.success('AI 看板已创建')}catch(e){toast.error(e instanceof Error?e.message:'AI 生成失败，请重试')}}
  async function claimPerson(personId:string){if(myPerson&&myPerson.id!==personId&&!window.confirm('切换身份后，你将不再看到原身份的收件箱。确定切换吗？'))return;try{await linkPerson.mutateAsync({personId});await reload();toast.success('身份已关联，可接收分配给你的通知')}catch(e){toast.error(e instanceof Error?e.message:'关联失败')}}
  async function addAndClaimPerson(){if(!newPersonName.trim()||!newPersonRole.trim())return;if(myPerson&&!window.confirm('添加并关联新成员后，你将不再看到原身份的收件箱。确定继续吗？'))return;try{const person=await createPerson.mutateAsync({name:newPersonName.trim(),role:newPersonRole.trim()});await linkPerson.mutateAsync({personId:person.id});setNewPersonName('');setNewPersonRole('');await reload();toast.success('成员已添加并关联到你的账号')}catch(e){await reload();toast.error(e instanceof Error?e.message:'添加失败')}}
  async function handleDigest(){if(!board)return;try{await flush();const result=await runDigest.mutateAsync({boardId:board.id});await reload();toast.success(result.message)}catch(e){toast.error(e instanceof Error?e.message:'运行失败')}}
  async function openNotification(n:Notification){try{if(!n.read){await markRead.mutateAsync({id:n.id});setData(old=>old?{...old,notifications:old.notifications.map(x=>x.id===n.id?{...x,read:true}:x)}:old)}if(n.boardId){setBoardId(n.boardId);setModal(null)}}catch{toast.error('无法更新通知')}}
  function addItem(){if(!board)return;const group=board.groups[0];if(!group){toast.error('请先添加分组');return}updateBoard({...board,items:[...board.items,{id:crypto.randomUUID(),groupId:group.id,name:'新条目',status:'not_started',assigneeId:null,startDate:null,dueDate:null,priority:'medium',notes:'',custom:{}}]});toast.success('已添加新条目')}
  if(auth.loading)return <div className="loading-screen"><Logo/><span>正在打开工作区</span><LoaderCircle size={16} className="spin"/></div>;
  if(!auth.isAuthenticated)return <div className="login-page"><div className="login-shell"><div className="brand login-brand"><Logo/><span>bramble<span className="brand-dot">.</span></span></div><div className="login-rule"/><div className="login-kicker">一个更清晰的工作空间</div><h1>让工作，<br/>有序向前。</h1><p>把团队、计划和进度放在一起，专注于真正重要的事。</p><button className="login-button" onClick={startLogin}>使用 Manus 登录 <ChevronRight size={17}/></button><div className="login-foot">为持续推进的团队而设计</div></div></div>;
  if(query.isLoading&&!data)return <div className="loading-screen"><Logo/><span>正在加载工作区</span><LoaderCircle size={16} className="spin"/></div>;
  if(!data||!board)return <div className="loading-screen"><Logo/><span>工作区暂时不可用</span><button className="plain-button" onClick={()=>query.refetch()}>重试</button></div>;
  const completed=board.items.filter(i=>i.status==='done').length;
  const overdue=board.items.filter(i=>isOverdue(i)).length;
  const progress=board.items.length?Math.round(completed/board.items.length*100):0;
  const views:{id:View;label:string;icon:typeof Table2}[]=[{id:'table',label:'表格',icon:Table2},{id:'kanban',label:'看板',icon:LayoutGrid},{id:'calendar',label:'日历',icon:CalendarDays},{id:'timeline',label:'时间线',icon:Layers3}];
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <div className="brand"><Logo/><span>bramble<span className="brand-dot">.</span></span><button className="mobile-close icon-button" onClick={()=>setMobileNav(false)}><X size={17}/></button></div>
      <button className="workspace-switch" onClick={()=>setModal('people')}><span className="workspace-icon">W</span><span><b>团队工作区</b><small>共享工作空间</small></span><ChevronDown size={14}/></button>
      <div className="side-section side-main">
        <button className="side-link selected" onClick={()=>{setView('table');setMobileNav(false)}}><Grid2X2 size={16}/><span>工作区</span></button>
        <button className="side-link" onClick={()=>{setPersonFilter('');setOnlyOverdue(true);setMobileNav(false)}}><ListTodo size={16}/><span>待处理事项</span><span className="side-count">{overdue}</span></button>
        <button className="side-link" onClick={()=>{setModal('inbox');setMobileNav(false)}}><Inbox size={16}/><span>收件箱</span>{unread>0&&<span className="unread-count">{unread}</span>}</button>
      </div>
      <div className="side-divider"/>
      <div className="section-heading"><span>工作区看板</span><button onClick={()=>setModal('newBoard')} title="新建看板"><Plus size={15}/></button></div>
      <div className="board-links">{data.boards.map((b,i)=><button key={b.id} className={`board-link ${b.id===board.id?'active':''}`} onClick={()=>{setBoardId(b.id);setSearch('');setOnlyOverdue(false);setPersonFilter('');setMobileNav(false)}}><span className="board-symbol" style={{color:['#b7835c','#5d8e79','#b36d69','#7894a5'][i%4]}}><Table2 size={15}/></span><span>{b.name}</span>{b.id===board.id&&<MoreHorizontal size={15}/>}</button>)}</div>
      <button className="create-side" onClick={()=>setModal('newBoard')}><Plus size={15}/> 新建看板</button>
      <div className="sidebar-bottom"><div className="side-bottom-note"><span className="side-bottom-dot"/> 工作空间已同步</div><button className="profile-button" onClick={()=>void auth.logout()} title="点击退出登录"><span className="profile-avatar">{(auth.user?.name||'U').slice(0,1).toUpperCase()}</span><span><b>{auth.user?.name||'团队成员'}</b><small>Manus 账号</small></span><LogOut size={15}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={()=>setMobileNav(true)}><Menu size={18}/></button><div className="breadcrumbs"><span>工作区</span><ChevronRight size={13}/><b>{board.name}</b></div><div className="top-actions"><button className="save-indicator" onClick={()=>{if(saveConflict)void resolveConflict();else if(saveError)void flush().catch(()=>{})}} title={saveError?'点击处理未保存的更改':''}><span className={saving||saveError?'saving-dot':'saved-dot'}/>{saving?'正在保存':saveConflict?'存在冲突，点击处理':saveError?'保存失败，点击重试':'所有更改已保存'}</button><button className="icon-button top-bell" onClick={()=>{void query.refetch();setModal('inbox')}} title="收件箱"><Bell size={17}/>{unread>0&&<i/>}</button><button className="top-profile" onClick={()=>setModal('people')} title="团队成员">{(auth.user?.name||'U').slice(0,1).toUpperCase()}</button></div></header>
      <main className="main-content">
        <div className="board-heading"><div className="heading-text"><div className="eyebrow"><span className="eyebrow-dot"/> 工作区 / 看板</div><div className="title-line"><h1>{board.name}</h1><button className="icon-button title-more" onClick={()=>setModal('automation')} aria-label="看板设置"><MoreHorizontal size={18}/></button></div><p>{board.description||'把重要的工作集中在这里，让每一步都清晰可见。'}</p></div><div className="heading-actions"><div className="avatar-stack" onClick={()=>setModal('people')} role="button" title="查看团队成员">{people.slice(0,4).map(p=><Avatar key={p.id} name={p.name} color={p.color}/>)}{people.length>4&&<span className="avatar avatar-more">+{people.length-4}</span>}</div><button className="outline-button" onClick={()=>setModal('automation')}><Zap size={15}/> 自动化</button><button className="ai-button" onClick={()=>setModal('ai')}><Sparkles size={15}/> AI 创建看板</button></div></div>
        <div className="overview-line"><div><b>{board.items.length}</b> 个条目 <span className="overview-separator">·</span> <b>{completed}</b> 已完成 <span className="overview-separator">·</span> <b className={overdue?'overdue-number':''}>{overdue}</b> 已逾期</div><div className="mini-progress"><span>总体进度</span><div className="mini-progress-bar"><i style={{width:`${progress}%`}}/></div><b>{progress}%</b></div></div>
        <nav className="view-tabs" aria-label="看板视图">{views.map(v=><button key={v.id} onClick={()=>setView(v.id)} className={view===v.id?'active':''}><v.icon size={15}/>{v.label}</button>)}</nav>
        <div className="board-toolbar"><div className="toolbar-left"><button className="new-item-button" onClick={addItem}><Plus size={15}/> 新建条目</button><span className="toolbar-divider"/><div className="search-control"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索条目" aria-label="搜索条目"/>{search&&<button onClick={()=>setSearch('')} aria-label="清除搜索"><X size={13}/></button>}</div><label className={`filter-control ${personFilter?'filter-active':''}`}><Users size={15}/><select value={personFilter} onChange={e=>setPersonFilter(e.target.value)} aria-label="按负责人筛选"><option value="">负责人</option>{people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><ChevronDown size={13}/></label><button className={`filter-control overdue-filter ${onlyOverdue?'filter-active':''}`} onClick={()=>setOnlyOverdue(!onlyOverdue)}><Filter size={14}/>仅看逾期</button></div><div className="toolbar-right"><span>{filtered.length} / {board.items.length} 条</span><button className="icon-button" title="清除筛选" onClick={()=>{setSearch('');setPersonFilter('');setOnlyOverdue(false)}}><SlidersHorizontal size={15}/></button></div></div>
        <div className="view-body">{view==='table'&&<BoardTable board={board} people={people} visibleItems={filtered} onChange={updateBoard}/ >}{view==='kanban'&&<KanbanView board={board} people={people} visibleItems={filtered} onChange={updateBoard}/ >}{view==='calendar'&&<CalendarView board={board} people={people} visibleItems={filtered} onChange={updateBoard}/ >}{view==='timeline'&&<TimelineView board={board} people={people} visibleItems={filtered} onChange={updateBoard}/ >}</div>
        <footer className="workspace-footer"><span>BRAMBLE WORKSPACE</span><span>让每一步，都看得见。</span></footer>
      </main>
    </div>
    {modal==='ai'&&<Modal title="用一句话，开始一个项目" eyebrow="BRAMBLE AI" onClose={()=>setModal(null)}><p className="modal-copy">告诉 AI 你想完成什么，它会为你创建包含分组、任务、负责人和日期的新看板。</p><label className="field-label" htmlFor="ai-prompt">描述你的项目</label><textarea id="ai-prompt" className="modal-input prompt-input" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="例如：为我们的新产品制定一份从策划到上线的项目计划"/><div className="ai-hint"><Sparkles size={14}/> 生成 10–20 个可编辑条目</div><div className="modal-actions"><button className="outline-button" onClick={()=>setModal(null)}>取消</button><button className="ai-button" disabled={!aiPrompt.trim()||createAI.isPending} onClick={makeAI}>{createAI.isPending?<LoaderCircle size={15} className="spin"/>:<Sparkles size={15}/>} {createAI.isPending?'正在规划…':'生成看板'}</button></div></Modal>}
    {modal==='newBoard'&&<Modal title="新建看板" eyebrow="WORKSPACE" onClose={()=>setModal(null)}><p className="modal-copy">为一项新工作创建专属的协作空间。</p><label className="field-label" htmlFor="board-name">看板名称</label><input id="board-name" className="modal-input" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void makeBoard()}} placeholder="例如：下一季度规划"/><div className="modal-actions"><button className="outline-button" onClick={()=>setModal(null)}>取消</button><button className="primary-button" disabled={!newName.trim()||create.isPending} onClick={makeBoard}>创建看板</button></div></Modal>}
    {modal==='automation'&&<Modal title="看板自动化" eyebrow="AUTOMATIONS" onClose={()=>setModal(null)} wide><p className="modal-copy">让重复的提醒自动发生。设置仅应用于 <b>{board.name}</b>。</p><div className="automation-list"><div className="automation-item"><span className="automation-icon green"><CheckCircle2 size={18}/></span><div><b>完成时通知负责人</b><p>条目状态变为“已完成”时，向负责人发送应用内通知。</p></div><button className={`switch ${board.automation.completionEnabled?'on':''}`} aria-label="完成通知开关" aria-checked={board.automation.completionEnabled} role="switch" onClick={()=>updateBoard({...board,automation:{...board.automation,completionEnabled:!board.automation.completionEnabled}})}><i/></button></div><div className="automation-item"><span className="automation-icon amber"><Clock3 size={18}/></span><div><b>每日逾期摘要</b><p>每天 08:00（Asia/Singapore）汇总未完成的逾期条目，发送到应用内收件箱。</p></div><button className={`switch ${board.automation.digestEnabled?'on':''}`} aria-label="每日摘要开关" aria-checked={board.automation.digestEnabled} role="switch" onClick={()=>updateBoard({...board,automation:{...board.automation,digestEnabled:!board.automation.digestEnabled}})}><i/></button></div></div>{board.automation.scheduleStatus!=='active'&&<div className="schedule-notice"><Clock3 size={14}/><span><b>定时任务尚未配置。</b>网站发布后，首次登录工作区时会尝试自动配置；配置成功前仍可使用“立即运行”。</span></div>}<div className="automation-run"><div><b>运行记录</b><p>定时重试不会重复发送同一天的摘要。</p></div><button className="outline-button" disabled={runDigest.isPending} onClick={handleDigest}>{runDigest.isPending?<LoaderCircle size={14} className="spin"/>:<Zap size={14}/>}立即运行</button></div><div className="logs">{data.logs.filter(l=>l.boardId===board.id).slice(0,8).map(log=><div className="log-row" key={log.id}><span className="log-dot"/><span>{log.message}</span><time>{relativeTime(log.createdAt)}</time></div>)}{!data.logs.some(l=>l.boardId===board.id)&&<div className="empty-small">还没有运行记录</div>}</div></Modal>}
    {modal==='inbox'&&<Modal title="收件箱" eyebrow="INBOX" onClose={()=>setModal(null)} wide><p className="modal-copy">{myPerson?`查看发送给 ${myPerson.name} 的完成提醒和逾期摘要。`:'关联团队身份后，即可接收分配给你的通知。'}</p><div className="inbox-list">{data.notifications.length?data.notifications.map(n=>{const person=people.find(p=>p.id===n.personId);return <button className={`notification-row ${!n.read?'unread':''}`} key={n.id} onClick={()=>openNotification(n)}><span className="notification-icon">{n.kind==='digest'?<Clock3 size={17}/>:<Check size={17}/>}</span><span className="notification-content"><b>{n.title}</b><small>{n.body}</small><em>{person?.name||'团队成员'} · {relativeTime(n.createdAt)}</em></span>{!n.read&&<i/>}</button>}):<div className="empty-inbox"><Inbox size={24}/><b>收件箱是空的</b><span>{myPerson?'新的工作提醒会出现在这里。':'先关联你的团队身份。'}</span>{!myPerson&&<button className="outline-button" onClick={()=>setModal('people')}>关联身份</button>}</div>}</div></Modal>}
    {modal==='people'&&<Modal title="团队成员与身份" eyebrow="WORKSPACE" onClose={()=>setModal(null)}><p className="modal-copy">将 Manus 账号关联到一位成员，即可接收其个人通知。在共享演示空间中，任何登录用户都可认领尚未关联的成员，并查看其历史通知；已关联成员不能被其他账号认领。</p><div className="people-list">{people.map(p=><div className="person-row" key={p.id}><Avatar name={p.name} color={p.color} size="large"/><span className="person-info"><b>{p.name}</b><small>{p.role}</small></span>{p.userId===auth.user?.id?<span className="identity-badge">我的身份</span>:p.userId?<span className="identity-muted">已关联</span>:<button className="identity-link" disabled={linkPerson.isPending} onClick={()=>claimPerson(p.id)}>关联我的账号</button>}</div>)}</div><div className="person-add"><b>或添加一位新成员</b><div><input className="modal-input" placeholder="姓名" value={newPersonName} onChange={e=>setNewPersonName(e.target.value)}/><input className="modal-input" placeholder="角色" value={newPersonRole} onChange={e=>setNewPersonRole(e.target.value)}/></div><button className="outline-button" disabled={!newPersonName.trim()||!newPersonRole.trim()||createPerson.isPending||linkPerson.isPending} onClick={addAndClaimPerson}><Plus size={14}/> 添加并关联</button></div></Modal>}
  </div>;
}
