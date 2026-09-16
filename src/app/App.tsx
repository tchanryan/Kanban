import { ErrorBoundary } from '../components/ErrorBoundary';
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { HashRouter, Link, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Search, PanelRightClose, Plus } from 'lucide-react';
import { workspace } from '../repositories/workspace';
import { BoardView } from '../features/Board';
import type { Run } from '../services/operations';
import { SearchDialog } from '../features/SearchDialog';
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
import { Modal } from '../components/ui';
import { Scratchpad } from '../features/Scratchpad';
import type { Item } from '../domain/model';
import { flushDrafts } from '../services/drafts';
import { Sidebar } from './Sidebar';

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
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  const [creating, setCreating] = useState<Item['kind'] | null>(null);
  const [title, setTitle] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [rail, setRail] = useState(true);
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
      <Sidebar
        onNavigate={() => setSelected(null)}
        onToggle={() => setCollapsed(!collapsed)}
      />
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
                    <Scratchpad />
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
                data-autofocus
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
