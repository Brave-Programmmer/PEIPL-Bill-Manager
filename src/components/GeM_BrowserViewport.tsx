import React from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Monitor, Power, FileText } from 'lucide-react';
import { useGeM_Store } from '../store/useGeM_Store';

export const GeM_BrowserViewport: React.FC = () => {
  const browserState = useGeM_Store((state) => state.browserState);
  const setBrowserStateInStore = useGeM_Store((state) => state.setBrowserState);
  const addLog = useGeM_Store((state) => state.addSessionLog);
  const currentSession = useGeM_Store((state) => state.currentSession);

  const [screenshot, setScreenshot] = React.useState<string>('');

  const fetchScreenshot = React.useCallback(async () => {
    try {
      const state = await window.electron.gemGetBrowserState();
      setBrowserStateInStore(state);

      if (state.isOpen) {
        const result = await window.electron.gemGetScreenshot();
        if (result.success && result.base64) {
          setScreenshot(result.base64);
        }
      } else {
        setScreenshot('');
      }
    } catch (err) {
      console.error('Error fetching screenshot:', err);
    }
  }, [setBrowserStateInStore]);

  // Polling loop
  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    let initialTimer: NodeJS.Timeout;
    
    if (browserState.isOpen) {
      initialTimer = setTimeout(() => {
        fetchScreenshot();
      }, 0);
      
      timer = setInterval(() => {
        fetchScreenshot();
      }, 2500); // Poll every 2.5 seconds
    }

    return () => {
      if (initialTimer) clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
    };
  }, [browserState.isOpen, fetchScreenshot]);

  const handleDisconnect = async () => {
    try {
      addLog('Disconnecting browser manually...');
      await window.electron.gemCloseBrowser();
      setBrowserStateInStore({ isOpen: false, currentUrl: '', pageTitle: '' });
      setScreenshot('');
      addLog('Browser disconnected');
    } catch (err) {
      console.error('Failed to close browser:', err);
    }
  };


  if (!browserState.isOpen) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center h-[500px] shadow-2xl relative overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -top-10 -left-10 pointer-events-none" />
        <div className="absolute w-64 h-64 bg-purple-500/10 rounded-full blur-3xl -bottom-10 -right-10 pointer-events-none" />
        
        <Monitor className="w-12 h-12 text-slate-700 mb-4 animate-pulse" />
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Live Viewport Offline</h4>
        <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
          The automated Chrome browser is not running. Start the session using the steps on the left to see the live feed.
        </p>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[580px] shadow-2xl relative"
    >
      {/* Header bar */}
      <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </div>
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Live Browser View
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          <button
            onClick={fetchScreenshot}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Refresh View"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {/* Power disconnect button */}
          <button
            onClick={handleDisconnect}
            className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 transition-colors cursor-pointer"
            title="Disconnect Browser"
          >
            <Power className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Viewport screenshot screen */}
      <div className="flex-1 bg-slate-900 relative flex items-center justify-center overflow-hidden border-b border-slate-800">
        {screenshot ? (
          <img
            src={screenshot}
            alt="Live GeM Viewport"
            className="w-full h-full object-contain select-none"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-500 text-xs">
            <RefreshCw className="w-8 h-8 animate-spin mb-3 text-slate-600" />
            <span>Establishing live stream...</span>
          </div>
        )}

        {/* Browser State HUD */}
        <div className="absolute bottom-3 left-3 right-3 bg-slate-950/80 backdrop-blur border border-slate-800/80 rounded-lg p-2.5 flex items-center justify-between text-[11px] text-slate-300 shadow-lg">
          <div className="min-w-0 flex-1 mr-4">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Active URL</div>
            <div className="truncate font-mono text-sky-400" title={browserState.currentUrl}>
              {browserState.currentUrl || 'Waiting for navigation...'}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Connection</div>
            <div className={`font-semibold ${browserState.connectionMethod === 'connectOverCDP' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {browserState.connectionMethod === 'connectOverCDP' ? 'Chrome profile (CDP)' : 'Clean browser'}
            </div>
          </div>
        </div>
      </div>

      {/* Mini Console Logs */}
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
