import { Luggage } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 md:max-w-3xl md:px-10">
      <header className="py-4 md:py-6">
        <Link to="/" className="inline-flex items-center gap-3">
          <span
            className="flex size-10 items-center justify-center rounded-md border
              border-outline-variant bg-surface-container text-primary"
          >
            <Luggage className="size-5" aria-hidden="true" />
          </span>
          <span className="flex flex-col">
            <span className="text-lg leading-6 font-semibold tracking-tight">PackSmart</span>
            <span className="text-xs text-on-surface-variant">
              Smart packing lists powered by weather &amp; AI
            </span>
          </span>
        </Link>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="py-6 text-center text-xs text-outline">
        PackSmart • Precision Travel Utilities
      </footer>
    </div>
  );
}
