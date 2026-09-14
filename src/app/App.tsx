import {
  useEffect,
  useRef,
  useState,
  Component,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import {
  HashRouter,
  NavLink,
  Link,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  LayoutDashboard,
  CalendarDays,
  Archive,
  Settings,
  Search,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Columns3,
} from 'lucide-react';
import { workspace } from '../repositories/workspace';
import { BoardView, type Run } from '../features/Board';
import { Inspector } from '../features/Inspector';
import { Calendar } from '../features/Calendar';
const SettingsPage = lazy(() =>
  import('../features/Settings').then((module) => ({
    default: module.SettingsPage,
  })),
);
const ArchivePage = lazy(() =>
  import('../features/Archive').then((module) => ({
    default: module.ArchivePage,
  })),
);
import { Autosave, Modal, Markdown } from '../components/ui';
import type { Item } from '../domain/model';
import { flushDrafts } from '../services/drafts';
import { RELEASE_LABEL } from './version';

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Unable to open Kanban Calendar</h1>
        <p>
          Your local database has not been cleared. Reload to retry. If the
          problem persists, retain browser site data for recovery.
        </p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function SearchDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (item: Item) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const items =
    useLiveQuery(
      async () => workspace.search(debounced, archived),
      [debounced, archived],
    ) || [];
  return (
    <Modal title="Search your work" onClose={onClose}>
      <input
        autoFocus
        aria-label="Search titles, notes and tags"
        placeholder="Search titles, notes and tags…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Include archived work
      </label>
      <div className="search-results">
        {items.map((i) => (
          <button
            key={i.id}
            onClick={() => {
              onClose();
              onOpen(i);
            }}
          >
            <span className="eyebrow">
              {i.kind}
              {i.archivedAt ? ' · archived' : ''}
            </span>
            <strong>{i.title}</strong>
          </button>
        ))}
        {!items.length && (
          <p className="muted">
            {q ? 'No matching work.' : 'Type to search your local workspace.'}
          </p>
        )}
      </div>
    </Modal>
  );
}
function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const root = useLiveQuery(async () => workspace.root(), []);
  const projectId = location.pathname.startsWith('/projects/')
    ? location.pathname.split('/')[2]
    : undefined;
  const project = useLiveQuery(
    async () =>
      projectId ? workspace.item(projectId) : Promise.resolve(undefined),
    [projectId],
  );
  const projectBoard = useLiveQuery(
    async () =>
      projectId
        ? workspace.projectBoard(projectId)
        : Promise.resolve(undefined),
    [projectId],
  );
  const board = projectId ? projectBoard : root;
  const columns =
    useLiveQuery(
      async () => (board ? workspace.columns(board.id) : Promise.resolve([])),
      [board?.id],
    ) || [];
  const children =
    useLiveQuery(
      async () =>
        projectId ? workspace.children(projectId) : Promise.resolve([]),
      [projectId],
    ) || [];
  const scratch = useLiveQuery(async () => workspace.scratch(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  const [creating, setCreating] = useState<Item['kind'] | null>(null);
  const [title, setTitle] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [rail, setRail] = useState(true);
  const [notesPreview, setNotesPreview] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const focusBefore = useRef<HTMLElement | null>(null);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: () =>
      setFailure('Offline setup failed. Reload while online to retry.'),
  });
  const run: Run = (fn, message) => {
    void fn()
      .then(() => {
        if (message) setNotice(message);
      })
      .catch((e) =>
        setFailure(
          e instanceof Error ? e.message : 'Operation failed. Please retry.',
        ),
      );
  };
  const open = (item: Item) => {
    focusBefore.current = document.activeElement as HTMLElement;
    if (item.kind === 'project') {
      setSelected(null);
      navigate(`/projects/${item.id}`);
    } else setSelected(item.id);
  };
  const close = () => {
    setSelected(null);
    focusBefore.current?.focus();
  };
  useEffect(() => {
    void workspace
      .initialize()
      .then(() => workspace.maintain())
      .catch(() =>
        setFailure(
          'Could not open or migrate local storage. Your data has not been cleared. Reload to retry.',
        ),
      );
    const maintain = () => {
      void workspace
        .maintain()
        .catch(() =>
          setFailure(
            'Archive maintenance failed. Your data remains on this device.',
          ),
        );
    };
    const error = (e: Event) => setFailure((e as CustomEvent<string>).detail);
    window.addEventListener('focus', maintain);
    window.addEventListener('save-error', error);
    const interval = setInterval(maintain, 60000);
    return () => {
      window.removeEventListener('focus', maintain);
      window.removeEventListener('save-error', error);
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !document.querySelector('dialog[open]')
      ) {
        setSelected(null);
        return;
      }
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,[contenteditable="true"],dialog',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (e.key === '/') {
        e.preventDefault();
        setSearch(true);
      }
      if (
        e.key.toLowerCase() === 'n' &&
        columns.length &&
        (location.pathname === '/' || projectId)
      ) {
        e.preventDefault();
        setCreating(e.shiftKey && !projectId ? 'project' : 'task');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [columns.length, projectId, location.pathname]);
  const isBoard = location.pathname === '/' || !!projectId;
  const pageTitle = projectId
    ? project?.title || 'Project'
    : location.pathname === '/calendar'
      ? 'Calendar'
      : location.pathname === '/archive'
        ? 'Archive'
        : location.pathname === '/settings'
          ? 'Settings'
          : 'Dashboard';
  return (
    <div className={`app-shell ${collapsed ? 'nav-collapsed' : ''}`}>
      <nav className="sidebar" aria-label="Main navigation">
        <Link className="brand" to="/" aria-label="Kanban Calendar dashboard">
          <Columns3 size={23} />
          <span>
            Kanban<span className="brand-sub">Calendar</span>
          </span>
        </Link>
        <div className="nav-links">
          {[
            { to: '/', label: 'Dashboard', icon: LayoutDashboard },
            { to: '/calendar', label: 'Calendar', icon: CalendarDays },
            { to: '/archive', label: 'Archive', icon: Archive },
            { to: '/settings', label: 'Settings', icon: Settings },
          ].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              title={label}
              onClick={() => setSelected(null)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
        <div className="nav-footer">
          <span>
            <i />
            Local workspace
          </span>
          <small>Private by design · {RELEASE_LABEL}</small>
          <button
            aria-label="Toggle navigation"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
      </nav>
      <div className={`main-shell${isBoard ? ' board-shell' : ''}`}>
        <header className="app-header">
          <div>
            <span className="eyebrow">Personal workspace</span>
            <h1>{pageTitle}</h1>
          </div>
          <div className="button-row">
            <button className="search-trigger" onClick={() => setSearch(true)}>
              <Search size={16} />
              <span>Search</span>
              <kbd>/</kbd>
            </button>
            {isBoard && (
              <details className="new-menu">
                <summary className="primary">
                  <Plus size={16} />
                  New
                </summary>
                <div>
                  <button
                    disabled={!columns.length}
                    onClick={() => setCreating('task')}
                  >
                    New Task <kbd>N</kbd>
                  </button>
                  {!projectId && (
                    <button
                      disabled={!columns.length}
                      onClick={() => setCreating('project')}
                    >
                      New Project <kbd>⇧ N</kbd>
                    </button>
                  )}
                  {!columns.length && <small>Create a column first.</small>}
                </div>
              </details>
            )}
            {isBoard && (
              <button
                aria-label="Toggle utility rail"
                onClick={() => setRail(!rail)}
              >
                <PanelRightClose size={18} />
              </button>
            )}
          </div>
        </header>
        {needRefresh && (
          <div className="update-banner">
            Update available. Finish your edits before restarting.
            <button
              onClick={() =>
                run(async () => {
                  await flushDrafts();
                  await updateServiceWorker(true);
                })
              }
            >
              Update & restart
            </button>
          </div>
        )}
        {failure && (
          <div className="error-banner" role="alert">
            {failure}
            <button onClick={() => setFailure('')}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            {notice}
          </div>
        )}
        <main className={isBoard ? 'workspace-layout' : 'route-layout'}>
          {isBoard ? (
            <>
              <div className="board-content">
                {project && (
                  <div
                    className={`project-heading color-${project.projectColorToken || 'violet'}`}
                  >
                    <Link to="/">Dashboard</Link>
                    <span> / {project.title}</span>
                    <div className="button-row">
                      <strong>
                        {children.filter((x) => x.completedAt).length}/
                        {children.length} tasks complete
                      </strong>
                      <span className={`priority ${project.priority}`}>
                        {project.priority}
                      </span>
                      <span>
                        {project.plannedStartDate || 'No start'} →{' '}
                        {project.dueDate || 'No due date'}
                      </span>
                      <button onClick={() => setSelected(project.id)}>
                        Edit details
                      </button>
                    </div>
                    {project.archivedAt && (
                      <p className="warning">
                        Archived project · child tasks and history are
                        preserved.
                        <button
                          onClick={() =>
                            run(
                              () => workspace.restore(project.id),
                              'Project restored',
                            )
                          }
                        >
                          Restore project
                        </button>
                      </p>
                    )}
                  </div>
                )}
                {board ? (
                  <BoardView
                    key={board.id}
                    boardId={board.id}
                    onOpen={open}
                    run={run}
                  />
                ) : (
                  <div className="empty-state">
                    {projectId
                      ? 'Project not found. It may have been deleted.'
                      : 'Opening your local workspace…'}
                    <Link to="/">Dashboard</Link>
                  </div>
                )}
              </div>
              {selected ? (
                <Inspector
                  key={selected}
                  id={selected}
                  onClose={close}
                  run={run}
                />
              ) : (
                rail && (
                  <aside className="utility-rail">
                    <Calendar compact onOpen={open} run={run} />
                    <section className="scratchpad">
                      <div className="section-heading">
                        <h2>Quick Notes</h2>
                        <button onClick={() => setNotesPreview(!notesPreview)}>
                          {notesPreview ? 'Edit' : 'Preview'}
                        </button>
                      </div>
                      <p className="muted">
                        A little space to clear your mind.
                      </p>
                      {notesPreview ? (
                        <Markdown text={scratch?.content || ''} />
                      ) : (
                        <Autosave
                          label="Scratchpad"
                          draftKey="scratchpad-global"
                          value={scratch?.content || ''}
                          save={(text, expected) =>
                            workspace.saveScratch(text, expected)
                          }
                          multiline
                        />
                      )}
                      {scratch && (
                        <small className="muted">
                          Updated {new Date(scratch.updatedAt).toLocaleString()}
                        </small>
                      )}
                    </section>
                  </aside>
                )
              )}
            </>
          ) : (
            <>
              {location.pathname === '/calendar' ? (
                <Calendar onOpen={open} run={run} />
              ) : location.pathname === '/archive' ? (
                <Suspense fallback={<p role="status">Loading archive…</p>}>
                  <ArchivePage onOpen={open} run={run} />
                </Suspense>
              ) : location.pathname === '/settings' ? (
                <Suspense fallback={<p role="status">Loading settings…</p>}>
                  <SettingsPage run={run} />
                </Suspense>
              ) : (
                <p>
                  Page not found. <Link to="/">Go to Dashboard</Link>
                </p>
              )}
              {selected && (
                <Inspector
                  key={selected}
                  id={selected}
                  onClose={close}
                  run={run}
                />
              )}
            </>
          )}
        </main>
      </div>
      {search && (
        <SearchDialog onClose={() => setSearch(false)} onOpen={open} />
      )}
      {creating && board && (
        <Modal title={`New ${creating}`} onClose={() => setCreating(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await workspace.create(board.id, title, creating);
                setTitle('');
                setCreating(null);
              });
            }}
          >
            <label className="field">
              Title
              <input
                autoFocus
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <p className="muted">
              New work goes into your default column. Add details whenever
              you’re ready.
            </p>
            <button className="primary">Create {creating}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ErrorBoundary>
  );
}
