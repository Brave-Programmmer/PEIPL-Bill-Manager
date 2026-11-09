/**
 * GeM Upload - Step 2: Login Assistant Component
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle2, Monitor, RefreshCw, AlertTriangle, ShieldCheck, KeyRound, Eye, EyeOff, Trash2, Save, Wand2 } from 'lucide-react';
import { useGeM_Store } from '../store/useGeM_Store';
import { useDisplayName } from '../utils/userProfile';

interface GeM_LoginAssistantProps {
  onLoginSuccess: () => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

export const GeM_LoginAssistant: React.FC<GeM_LoginAssistantProps> = ({
  onLoginSuccess,
  onError,
  disabled = false,
}) => {
  const displayName = useDisplayName();
  const [isOpening, setIsOpening] = React.useState(false);
  const [, setIsBrowserOpen] = React.useState(false);
  const [, setIsWaitingForLogin] = React.useState(false);
  const [loginStatus, setLoginStatus] = React.useState<'idle' | 'opening' | 'waiting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [logs, setLogs] = React.useState<string[]>([]);
  const [chromeRunning, setChromeRunning] = React.useState<boolean | null>(null);
  const [isCheckingChrome, setIsCheckingChrome] = React.useState(false);
  const abortedWaitRef = React.useRef(false);

  // Stored GeM credentials (username/password) for auto-fill.
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [rememberCreds, setRememberCreds] = React.useState(true);
  const [showPassword, setShowPassword] = React.useState(false);
  const [hasSavedCreds, setHasSavedCreds] = React.useState(false);
  const [savingCreds, setSavingCreds] = React.useState(false);
  const [credsMessage, setCredsMessage] = React.useState('');
  const [credsError, setCredsError] = React.useState('');
  const [fillingNow, setFillingNow] = React.useState(false);

  const addLog = useGeM_Store((state) => state.addSessionLog);
  const addError = useGeM_Store((state) => state.addSessionError);
  const setLoginStatusInStore = useGeM_Store((state) => state.setLoginStatus);
  const setBrowserState = useGeM_Store((state) => state.setBrowserState);

  const addLogEntry = (message: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${message}`]);
    addLog(message);
  };

  const checkChromeDebugging = React.useCallback(async () => {
    setIsCheckingChrome(true);
    try {
      const result = await window.electron.gemCheckChromeDebugging();
      setChromeRunning(result.chromeRunning);
      return result.chromeRunning;
    } catch {
      setChromeRunning(false);
      return false;
    } finally {
      setIsCheckingChrome(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      checkChromeDebugging();
    }, 0);
    return () => clearTimeout(timer);
  }, [checkChromeDebugging]);

  const handleOpenGeM = async () => {
    setIsOpening(true);
    setLoginStatus('opening');
    setErrorMessage('');
    addLogEntry('Opening GeM login page...');

    try {
      // Load any stored credentials so we can display + auto-fill them.
      let creds = { username: '', password: '' };
      let shouldAutoFill = false;
      try {
        const saved = await window.electron.gemGetCredentials?.();
        if (saved?.success && saved.credentials) {
          creds = {
            username: saved.credentials.username || '',
            password: saved.credentials.password || '',
          };
          shouldAutoFill = saved.credentials.remember !== false;
          setUsername(creds.username);
          setPassword(creds.password);
          setRememberCreds(shouldAutoFill);
          setHasSavedCreds(!!(creds.username || creds.password));
        }
      } catch {
        /* no stored credentials */
      }

      const result = await window.electron.gemOpenBrowser();

      if (result.success) {
        setIsBrowserOpen(true);
        setBrowserState({ isOpen: true, connectionMethod: result.method });
        addLogEntry('GeM browser opened successfully');
        setLoginStatus('waiting');
        setIsOpening(false);
        setIsWaitingForLogin(true);

        // Auto-fill stored credentials into the GeM login form.
        if (shouldAutoFill && (creds.username || creds.password)) {
          addLogEntry('Auto-filling stored GeM credentials...');
          try {
            const fill = await window.electron.gemAutoFillLogin?.(creds.username, creds.password);
            if (fill?.success) {
              addLogEntry('Credentials filled — complete the OTP / captcha to log in.');
            } else {
              addLogEntry('Stored credentials ready — fill them manually if needed.');
            }
          } catch {
            /* ignore auto-fill failure */
          }
        }

        // Start waiting for login
        handleWaitForLogin();
      } else {
        const error = result.error || 'Failed to open GeM';
        setErrorMessage(error);
        setLoginStatus('error');
        addError(error);
        setIsOpening(false);
        onError?.(error);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      setLoginStatus('error');
      addError(errorMsg);
      setIsOpening(false);
      onError?.(errorMsg);
    }
  };

  const handleWaitForLogin = async () => {
    abortedWaitRef.current = false;
    addLogEntry('Waiting for you to complete login...');

    try {
      const result = await window.electron.gemWaitForLogin(300000); // 5 minute timeout

      if (abortedWaitRef.current) return;

      if (result.success) {
        addLogEntry('Login successful!');
        setLoginStatus('success');
        setIsWaitingForLogin(false);
        setLoginStatusInStore({
          isLoggedIn: true,
          loginTime: Date.now(),
        });
        onLoginSuccess();
      } else {
        const error = result.error || 'Login failed or timeout';
        setErrorMessage(error);
        setLoginStatus('error');
        addError(error);
        setIsWaitingForLogin(false);
        onError?.(error);
      }
    } catch (error) {
      if (abortedWaitRef.current) return;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      setLoginStatus('error');
      addError(errorMsg);
      setIsWaitingForLogin(false);
      onError?.(errorMsg);
    }
  };

  // Agentic run: open the embedded GeM view and start waiting for login
  // automatically when this step mounts — no manual "Open GeM Login" click.
  const autoStartRef = React.useRef(false);
  React.useEffect(() => {
    if (autoStartRef.current || disabled) return;
    autoStartRef.current = true;
    void handleOpenGeM();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const finishAsLoggedIn = (message: string) => {
    abortedWaitRef.current = true;
    addLogEntry(message);
    setLoginStatus('success');
    setIsWaitingForLogin(false);
    setLoginStatusInStore({
      isLoggedIn: true,
      loginTime: Date.now(),
    });
    onLoginSuccess();
  };

  const handleAlreadyLoggedIn = async () => {
    try {
      // Prefer confirming fulfilment host when a browser session is already open
      const url = await window.electron.gemGetCurrentUrl?.();
      const href = typeof url === 'string' ? url : '';
      if (/fulfilment\.gem\.gov\.in/i.test(href)) {
        finishAsLoggedIn('Already on GeM fulfilment — continuing');
        return;
      }
    } catch {
      /* fall through to manual confirm */
    }
    finishAsLoggedIn('User confirmed already logged in');
  };

  const handleRetry = () => {
    abortedWaitRef.current = true;
    setLoginStatus('idle');
    setErrorMessage('');
    setLogs([]);
    checkChromeDebugging();
  };

  const handleSaveCredentials = async () => {
    setSavingCreds(true);
    setCredsMessage('');
    setCredsError('');
    try {
      const result = await window.electron.gemSaveCredentials?.({ username, password, remember: rememberCreds });
      if (result?.success) {
        setHasSavedCreds(!!(username || password));
        setCredsMessage('Credentials saved on this device. They will be auto-filled next time.');
        addLogEntry('Saved GeM credentials');
      } else {
        setCredsError(result?.error || 'Failed to save credentials');
      }
    } catch (err) {
      setCredsError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSavingCreds(false);
    }
  };

  const handleClearCredentials = async () => {
    setCredsMessage('');
    setCredsError('');
    try {
      await window.electron.gemClearCredentials?.();
    } catch {
      /* best-effort */
    }
    setUsername('');
    setPassword('');
    setHasSavedCreds(false);
    setCredsMessage('Saved credentials removed.');
    addLogEntry('Cleared saved GeM credentials');
  };

  const handleFillNow = async () => {
    setFillingNow(true);
    setCredsMessage('');
    setCredsError('');
    try {
      const result = await window.electron.gemAutoFillLogin?.(username, password);
      if (result?.success) {
        addLogEntry('Filled credentials into the GeM login form');
      } else {
        setCredsError(result?.error || 'Could not find the GeM login fields to fill');
      }
    } catch (err) {
      setCredsError(err instanceof Error ? err.message : 'Auto-fill failed');
    } finally {
      setFillingNow(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 text-left"
    >
      {/* Step Title */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-white">
          Step 2: User Authentication
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          GeM opens right here inside this app — no separate browser tab or window.
          Complete the login (password and OTP) in the embedded panel, and the upload
          continues automatically once you&apos;re authenticated.
        </p>
      </div>

      {/* Saved Credentials */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-blue-500" />
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Saved GeM Credentials</h4>
          {hasSavedCreds && (
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Stored
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Store your GeM seller username &amp; password once and the app fills them on the login page.
          The password is encrypted on this device. OTP / captcha is always entered manually.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              GeM Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="GeM seller username"
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              GeM Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="GeM password"
                autoComplete="off"
                className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={rememberCreds}
              onChange={(e) => setRememberCreds(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Auto-fill these credentials when GeM opens
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={handleSaveCredentials}
              disabled={savingCreds || (!username && !password)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer"
            >
              {savingCreds ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
            <button
              onClick={handleFillNow}
              disabled={fillingNow || (!username && !password)}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer"
            >
              {fillingNow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Fill into GeM now
            </button>
            {hasSavedCreds && (
              <button
                onClick={handleClearCredentials}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>

          {credsMessage && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400">{credsMessage}</div>
          )}
          {credsError && (
            <div className="text-xs text-red-600 dark:text-red-400">{credsError}</div>
          )}
        </div>
      </div>

      {/* Connection Diagnostics HUD */}
      {loginStatus === 'idle' && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 border-b border-slate-100 dark:border-slate-700 pb-2.5">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Connection Diagnostics
            </span>
            <button
              onClick={checkChromeDebugging}
              disabled={isCheckingChrome}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingChrome ? 'animate-spin' : ''}`} />
              Check Session Status
            </button>
          </div>

          {chromeRunning === null && (
            <div className="text-xs text-slate-500 flex items-center gap-2 py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning local remote debugging ports...
            </div>
          )}

          {chromeRunning === true && (
            <div className="flex items-start gap-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 p-4 rounded-lg">
              <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                  Active Chrome Session Detected (CDP Ready)
                </div>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-400/90 mt-1 leading-relaxed">
                  A debuggable Chrome session was detected. The system will sync directly with your
                  active Chrome browser (passwords and cookies will be available). Approve the
                  remote-debugging prompt in Chrome if one appears.
                </p>
              </div>
            </div>
          )}

          {chromeRunning === false && (
            <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 p-4 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-amber-900 dark:text-amber-300">
                  No Active Chrome Session Found (Persistent Fallback)
                </div>
                <p className="text-[11px] text-amber-800 dark:text-amber-400/90 mt-1 leading-relaxed">
                  No debuggable Chrome session found. A dedicated Chrome window with its own
                  persistent profile will be launched instead — log in once and the session is
                  remembered between uploads.
                </p>
                <div className="mt-2.5 pt-2.5 border-t border-amber-200/50 dark:border-amber-800/40 text-[10px] text-slate-500 dark:text-slate-400 leading-normal">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Option:</span> To reuse your everyday Chrome profile instead:
                  <ul className="list-disc pl-3.5 mt-1 space-y-0.5">
                    <li>In Chrome, open <code className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded font-mono text-[9px] text-slate-800 dark:text-slate-200 select-all">chrome://inspect/#remote-debugging</code> and enable it, or</li>
                    <li>Start Chrome with: <code className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded font-mono text-[9px] text-slate-800 dark:text-slate-200 select-all">--remote-debugging-port=9222</code></li>
                    <li>Click "Check Session Status" above to refresh</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status Indicator */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          {loginStatus === 'idle' && <Monitor className="w-5 h-5 text-slate-400" />}
          {loginStatus === 'opening' && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
          {loginStatus === 'waiting' && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
          {loginStatus === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
          {loginStatus === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}

          <span className="font-semibold text-slate-900 dark:text-white">
            {loginStatus === 'idle' && 'Ready to open GeM'}
            {loginStatus === 'opening' && 'Opening GeM browser...'}
            {loginStatus === 'waiting' && 'Waiting for your login...'}
            {loginStatus === 'success' && 'Login successful!'}
            {loginStatus === 'error' && 'Login failed'}
          </span>
        </div>

        {/* Instructions */}
        {loginStatus === 'idle' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-900 dark:text-blue-100"
          >
            <div className="font-medium mb-2">What will happen:</div>
            <ul className="space-y-1.5 text-xs pl-1">
              <li>• A Chrome window will open, navigating directly to the GeM login page.</li>
              <li>• You will enter your GeM seller credentials manually.</li>
              <li>• Complete any OTP or captcha challenges presented.</li>
              <li>• The application automatically detects when login is complete.</li>
            </ul>
          </motion.div>
        )}

        {/* Waiting Instructions */}
        {loginStatus === 'waiting' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-900 dark:text-amber-100"
          >
            <div className="font-medium mb-1">Waiting for login...</div>
            <p className="text-xs leading-relaxed">
              Complete the login in the embedded GeM panel on the right. This waits up to 5 minutes
              before timing out. Already signed in? Use the button below to continue immediately.
            </p>
          </motion.div>
        )}

        {/* Success Message */}
        {loginStatus === 'success' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-sm text-green-900 dark:text-green-100"
          >
            Authenticated! Proceeding to find the corresponding order.
          </motion.div>
        )}

        {/* Error Message */}
        {loginStatus === 'error' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4"
          >
            <div className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">Error:</div>
            <div className="text-xs text-red-800 dark:text-red-200">{errorMessage}</div>
          </motion.div>
        )}
      </div>

      {/* Activity Log */}
      {logs.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Activity Log</div>
          <div className="max-h-36 overflow-y-auto space-y-1 scrollbar-thin">
            {logs.map((log, idx) => (
              <div key={idx} className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end flex-wrap">
        {loginStatus === 'idle' && (
          <>
            <button
              onClick={handleAlreadyLoggedIn}
              disabled={disabled || isOpening}
              className="px-6 py-2 rounded-lg font-medium border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              I&apos;m already logged in
            </button>
            <button
              onClick={handleOpenGeM}
              disabled={disabled || isOpening}
              className="px-6 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer"
            >
              {isOpening && <Loader2 className="w-4 h-4 animate-spin" />}
              {isOpening ? `${displayName}, opening GeM Login...` : 'Open GeM Login'}
            </button>
          </>
        )}

        {loginStatus === 'waiting' && (
          <button
            onClick={handleAlreadyLoggedIn}
            disabled={disabled}
            className="px-6 py-2 rounded-lg font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors cursor-pointer"
          >
            I&apos;m already logged in — Continue
          </button>
        )}

        {loginStatus === 'error' && (
          <>
            <button
              onClick={handleRetry}
              className="px-6 py-2 rounded-lg font-medium border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={handleAlreadyLoggedIn}
              className="px-6 py-2 rounded-lg font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors cursor-pointer"
            >
              I&apos;m already logged in
            </button>
            <button
              onClick={handleOpenGeM}
              disabled={disabled || isOpening}
              className="px-6 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer"
            >
              {isOpening && <Loader2 className="w-4 h-4 animate-spin" />}
              Re-open Browser
            </button>
          </>
        )}

        {loginStatus === 'success' && (
          <button
            onClick={onLoginSuccess}
            className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 transition-colors cursor-pointer"
          >
            Continue
          </button>
        )}
      </div>
    </motion.div>
  );
};
