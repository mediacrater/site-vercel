'use client';

// components/command-palette.tsx
//
// Cmd/Ctrl+K opens it. Not a port of the extension's W/A/S/D popup
// shortcuts — those were navigation within a small popup and don't
// translate to a full page. This is the modern equivalent: jump to any
// page or run a common action by typing, without touching the mouse.

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, History, Settings as SettingsIcon, LogOut, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/mediacrater/supabaseClient';

const EXTENSION_LINK =
  'https://chromewebstore.google.com/detail/mediacrater-ad-compliance/fgekklkpomdcadiaekpigidkimnkjpnf?utm_medium=command_palette';

interface Command {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  run: (router: ReturnType<typeof useRouter>) => void;
}

const COMMANDS: Command[] = [
  { id: 'dashboard', label: 'Go to Dashboard', icon: LayoutDashboard, run: (r) => r.push('/dashboard') },
  { id: 'history', label: 'Go to Scan History', icon: History, run: (r) => r.push('/scan-history') },
  { id: 'settings', label: 'Go to Settings', icon: SettingsIcon, run: (r) => r.push('/settings') },
  {
    id: 'extension',
    label: 'Get the Chrome extension',
    icon: ExternalLink,
    run: () => window.open(EXTENSION_LINK, '_blank', 'noopener,noreferrer'),
  },
  {
    id: 'signout',
    label: 'Sign Out',
    icon: LogOut,
    run: async (r) => {
      await supabase.auth.signOut();
      r.push('/signin');
    },
  },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  function runCommand(cmd: Command) {
    setOpen(false);
    cmd.run(router);
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      runCommand(filtered[activeIndex]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-black/40" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Jump to a page or action..."
          className="w-full px-4 py-3.5 bg-transparent text-sm focus:outline-none border-b border-border"
        />
        <div className="max-h-72 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">No matches</p>
          )}
          {filtered.map((cmd, i) => {
            const Icon = cmd.icon;
            return (
              <button
                key={cmd.id}
                onClick={() => runCommand(cmd)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex items-center gap-3 w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  i === activeIndex ? 'bg-secondary text-foreground' : 'text-muted-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {cmd.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
