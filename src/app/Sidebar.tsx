import { Link, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  Archive,
  Settings,
  PanelLeftClose,
  Columns3,
} from 'lucide-react';
import { RELEASE_LABEL } from './version';
interface SidebarProps {
  onNavigate: () => void;
  onToggle: () => void;
}
export function Sidebar({ onNavigate, onToggle }: SidebarProps) {
  return (
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
          <NavLink key={to} to={to} end title={label} onClick={onNavigate}>
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
        <button aria-label="Toggle navigation" onClick={onToggle}>
          <PanelLeftClose size={18} />
        </button>
      </div>
    </nav>
  );
}
