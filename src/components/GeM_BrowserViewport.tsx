import React from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Monitor, Power, FileText, ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import { useGeM_Store } from '../store/useGeM_Store';

/**
 * GeM_BrowserViewport
 *
 * The GeM portal is rendered *inside the app* as a native WebContentsView owned
 * by the Electron main process. This component is just the slot: it measures its
 * own geometry and reports it to main, which overlays the native view exactly
 * over the body region. Header controls and logs stay in the DOM above/below the
 * slot so they remain clickable.
 */
export const GeM_BrowserViewport: React.FC = () => {
  const browserState = useGeM_Store((state) => state.browserState);
  const setBrowserStateInStore = useGeM_Store((state) => state.setBrowserState);
  const addLog = useGeM_Store((state) => state.addSessionLog);
  const currentSession = useGeM_Store((state) => state.currentSession);

  const bodyRef = React.useRef<HTMLDivElement>(null);
  const viewVisibleRef = React.useRef(false);

  // ── Report the slot geometry to main so the native view lines up ──────────
  const syncBounds = React.useCallback(() => {
    const api = window.electron?.gemUpdateViewport;
    if (!api) return;

    const el = bodyRef.current;
    if (!el) {
      if (viewVisibleRef.current) {
        viewVisibleRef.current = false;
        void api({ visible: false, x: 0, y: 0, width: 0, height: 0 });
      }
      return;
    }

    const rect = el.getBoundingClientRect();

    // Never let the view creep under the sticky app header (it would cover the
    // header's buttons, since a native view always sits above DOM content).
    const header = document.querySelector('header');
    const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const minTop = Math.max(headerBottom, 72) + 6;

    const top = Math.max(rect.top, minTop);
    const bottom = Math.min(rect.bottom, window.innerHeight - 6);
    const height = Math.max(0, bottom - top);
    const width = Math.max(0, rect.width);
    const visible = height > 60 && width > 60;

    viewVisibleRef.current = visible;
    void api({
      visible,
      x: Math.round(rect.left),
      y: Math.round(top),
      width: Math.round(width),
      height: Math.round(height),
    });
  }, []);

  React.useEffect(() => {
    if (!browserState.isOpen) return;
    const api = window.electron?.gemUpdateViewport;
    if (!api) return;

    syncBounds();

    const el = bodyRef.current;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncBounds()) : null;
    if (el && ro) ro.observe(el);

    const onChange = () => syncBounds();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    const interval = window.setInterval(syncBounds, 700);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
      window.clearInterval(interval);
      viewVisibleRef.current = false;
      void api({ visible: false, x: 0, y: 0, width: 0, height: 0 });
    };
  }, [browserState.isOpen, syncBounds]);

  // ── Keep the URL / title HUD fresh ────────────────────────────────────────
  React.useEffect(() => {
    if (!browserState.isOpen) return;
    let alive = true;
    const tick = async () => {
      try {
        const state = await window.electron.gemGetBrowserState();
        if (alive && state) setBrowserStateInStore(state);
      } catch {
        /* transient */
      }
    };
    void tick();
    const timer = window.setInterval(tick, 2200);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [browserState.isOpen, setBrowserStateInStore]);

  const [navBusy, setNavBusy] = React.useState(false);

  const engineLabel = React.useMemo(() => {
    switch (browserState.connectionMethod) {
      case 'embedded':
        return { text: 'In-app browser', cls: 'text-emerald-400' };
      case 'auto-connect':
      case 'cdp':
      case 'connectOverCDP':
        return { text: 'Your Chrome', cls: 'text-emerald-400' };
      case 'managed':
      case 'launchPersistentContext':
        return { text: 'Managed browser', cls: 'text-sky-400' };
      default:
        return { text: browserState.connectionMethod || 'Browser', cls: 'text-amber-400' };
    }
  }, [browserState.connectionMethod]);

  const handleDisconnect = async () => {
    try {
      addLog('Disconnecting browser manually...');
      await window.electron.gemCloseBrowser();
      setBrowserStateInStore({ isOpen: false, currentUrl: '', pageTitle: '' });
      addLog('Browser disconnected');
    } catch (err) {
      console.error('Failed to close browser:', err);
    }
  };

  const runNav = async (action: () => Promise<{ success: boolean; error?: string }>, label: string) => {
    if (navBusy) return;
    setNavBusy(true);
    try {
      const result = await action();
      if (!result?.success) {
        addLog(`${label} failed${result?.error ? `: ${result.error}` : ''}`);
      }
      setTimeout(syncBounds, 600);
    } catch (err) {
      console.error(`${label} error:`, err);
    } finally {
      setNavBusy(false);
    }
  };

  if (!browserState.isOpen) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center h-[calc(100vh-240px)] min-h-[440px] shadow-2xl relative overflow-hidden">
        <div className="absolute w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -top-10 -left-10 pointer-events-none" />
        <div className="absolute w-64 h-64 bg-purple-500/10 rounded-full blur-3xl -bottom-10 -right-10 pointer-events-none" />

        <Monitor className="w-12 h-12 text-slate-700 mb-4 animate-pulse" />
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">In-app browser idle</h4>
        <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
          GeM opens inside this window automatically — no separate Chrome tab to switch to.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[calc(100vh-190px)] min-h-[560px] shadow-2xl relative"
    >
      {/* Header bar (DOM — sits above the native view) */}
      <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </div>
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            GeM (in-app)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => runNav(() => window.electron.gemGoBack(), 'Back')}
            disabled={navBusy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
            title="Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => runNav(() => window.electron.gemGoForward(), 'Forward')}
            disabled={navBusy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
            title="Forward"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => runNav(() => window.electron.gemReload(), 'Reload')}
            disabled={navBusy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
            title="Reload page"
          >
            <RotateCw className={`w-3.5 h-3.5 ${navBusy ? 'animate-spin' : ''}`} />
          </button>
          <div className="w-px h-4 bg-slate-700 mx-1" />
          <button
            onClick={syncBounds}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Re-align view"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDisconnect}
            className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 transition-colors cursor-pointer"
            title="Close GeM browser"
          >
            <Power className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body — the native view is overlaid here by the main process */}
      <div ref={bodyRef} className="flex-1 bg-slate-900 relative overflow-hidden border-b border-slate-800">
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 text-xs pointer-events-none">
          <RefreshCw className="w-7 h-7 animate-spin mb-3" />
          <span>Waking up the in-app GeM browser…</span>
        </div>

        {/* URL HUD */}
        <div className="absolute bottom-3 left-3 right-3 bg-slate-950/85 backdrop-blur border border-slate-800/80 rounded-lg p-2.5 flex items-center justify-between text-[11px] text-slate-300 shadow-lg pointer-events-none">
          <div className="min-w-0 flex-1 mr-4">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Active URL</div>
            <div className="truncate font-mono text-sky-400" title={browserState.currentUrl}>
              {browserState.currentUrl || 'Waiting for navigation...'}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Connection</div>
            <div className={`font-semibold ${engineLabel.cls}`}>{engineLabel.text}</div>
          </div>
        </div>
      </div>

      {/* Mini console logs */}
      {currentSession && currentSession.logs.length > 0 && (
        <div className="h-28 bg-slate-950 p-3 overflow-y-auto font-mono text-[10px] text-slate-400 select-text border-t border-slate-900 scrollbar-thin">
          <div className="text-[9px] text-slate-500 font-sans uppercase tracking-wider font-bold mb-1.5 flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            Session Console Logs
          </div>
          <ul className="space-y-1 text-left">
            {currentSession.logs.slice(-6).map((log, idx) => (
              <li key={idx} className="leading-normal truncate border-l border-slate-800 pl-1.5">
                {log}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
};
