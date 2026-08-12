import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface MenuItem {
  label: string;
  to?: string;
  disabled?: boolean;
  hint?: string;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

const MENUS: MenuDef[] = [
  {
    label: 'Operations',
    items: [
      { label: 'Patient Registration', to: '/register' },
      { label: 'Sample Collection', to: '/collection' },
      { label: 'Result Entry', to: '/orders', hint: 'pick an order' },
      { label: 'Orders', to: '/orders' },
    ],
  },
  {
    label: 'Masters',
    items: [
      { label: 'Tests', to: '/masters/tests' },
      { label: 'Packages', disabled: true, hint: 'Later stage' },
      { label: 'Sample Types', disabled: true, hint: 'Later stage' },
    ],
  },
  { label: 'Parties', items: [{ label: 'Doctors & Referrers', disabled: true, hint: 'Later stage' }] },
  { label: 'Staff', items: [{ label: 'Users & Roles', disabled: true, hint: 'Later stage' }] },
  { label: 'Inventory', items: [{ label: 'Stock & Reagents', disabled: true, hint: 'Later stage' }] },
  { label: 'Analytics', items: [{ label: 'Reports & Dashboards', disabled: true, hint: 'Later stage' }] },
  { label: 'Settings', items: [{ label: 'Organization Settings', disabled: true, hint: 'Later stage' }] },
  { label: 'Audit', items: [{ label: 'Audit Trail', disabled: true, hint: 'Later stage' }] },
];

function MenuDropdown({ menu }: { menu: MenuDef }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium transition hover:bg-white/10 ${
          open ? 'bg-white/10 text-white' : 'text-slate-100'
        }`}
        aria-expanded={open}
      >
        {menu.label}
        <svg width="10" height="10" viewBox="0 0 10 10" className={`transition ${open ? 'rotate-180' : ''}`}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[230px] rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {menu.items.map((item) =>
            item.to ? (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => {
                  setOpen(false);
                  navigate(item.to as string);
                }}
                className="block px-3 py-1.5 text-[13px] text-slate-700 transition hover:bg-brand-50 hover:text-brand-800"
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.label}
                className="flex cursor-not-allowed items-center justify-between px-3 py-1.5 text-[13px] text-slate-400"
                title={item.hint}
              >
                {item.label}
                {item.hint && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{item.hint}</span>}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function NavBar() {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 border-b border-brand-900 bg-brand-800 shadow-sm">
      <div className="mx-auto flex h-12 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
        <Link to="/register" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="#5eead4" strokeWidth="1.6" />
              <path d="M4.5 4.5h1.6v7H4.5zm2.7 0h1.6v4.8H7.2zm2.7 0h1.6v7H9.9z" fill="#5eead4" />
            </svg>
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-tight text-white">Thulir LIMS</span>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-brand-300">v2 · Stage 3</span>
          </span>
        </Link>

        <nav className="flex flex-1 items-center gap-1" aria-label="Primary">
          {MENUS.map((menu) => (
            <MenuDropdown key={menu.label} menu={menu} />
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => navigate('/register')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[13px] font-semibold text-brand-800 shadow-sm transition hover:bg-brand-50"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            New Registration
          </button>
          <span className="ml-1 inline-flex h-8 items-center gap-2 rounded-md border border-white/15 px-2.5 text-[12px] font-medium text-slate-100">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[10px] font-bold text-white">A</span>
            admin
          </span>
        </div>
      </div>
    </header>
  );
}
