/**
 * GeM Browser Service — agent-browser (vercel-labs) backend
 *
 * Drives the local browser through the `agent-browser` CLI daemon instead of
 * a raw Playwright connection. Compared to the Playwright backend this gives:
 *
 *  - `--auto-connect`: discovers a running Chrome automatically (DevToolsActivePort
 *    file or ports 9222/9229) and waits for the Chrome 144+ approval prompt —
 *    no manual `--remote-debugging-port=9222` launch required.
 *  - `--cdp <port|url>`: attach to any CDP endpoint, including remote services.
 *  - Managed fallback: `--headed --profile <dir>` launches a persistent,
 *    visible Chrome window the user can fully interact with (SSO, OTP, captcha).
 *  - `--pin-tab`: the session owns its tab and never hijacks the user's active tab.
 *  - `--session gem-upload`: isolated daemon + browser state per workflow.
 *  - `eval`-based DOM extraction: order panels and invoice fields are scraped in
 *    a single round-trip instead of dozens of IPC calls.
 *  - Mark-and-click: element handles can't cross CLI invocations, so actions
 *    mark a target with a data attribute in `eval` and then use agent-browser's
 *    real CDP click (with actionability checks) on that selector.
 *
 * Public API mirrors GeM_PlaywrightService so gemIpcHandlers can swap engines.
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_NAME = 'gem-upload';
const DEFAULT_CMD_TIMEOUT = 30_000;
const NAV_TIMEOUT = 90_000;

const GEM_LOGIN_URL = 'https://sso.gem.gov.in/ARXSSO/oauth/doLogin';
const GEM_ORDERS_URL =
  'https://fulfilment.gem.gov.in/fulfilment/home#WORKSPACE_ID=ORDERS_WS';

// CSS injected after navigation to keep GeM's wide tables inside the viewport.
const OVERFLOW_GUARD_JS = `(() => {
  if (document.getElementById('__gem_ab_guard')) return;
  const style = document.createElement('style');
  style.id = '__gem_ab_guard';
  style.innerHTML = 'html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow-x:hidden!important;overflow-y:auto!important}*{box-sizing:border-box!important}div,table,main,section,article,aside,header,footer,nav{max-width:100%!important}table{table-layout:auto!important;width:100%!important}tr,td,th{word-break:break-word!important;word-wrap:break-word!important}img,iframe,embed,video{max-width:100%!important;height:auto!important}';
  document.documentElement.appendChild(style);
})();`;

// ── Binary resolution ────────────────────────────────────────────────────────

const PLATFORM_BINARIES = {
  'darwin-arm64': 'agent-browser-darwin-arm64',
  'darwin-x64': 'agent-browser-darwin-x64',
  'linux-x64': 'agent-browser-linux-x64',
  'linux-arm64': 'agent-browser-linux-arm64',
  'linux-musl-x64': 'agent-browser-linux-musl-x64',
  'linux-musl-arm64': 'agent-browser-linux-musl-arm64',
  'win32-x64': 'agent-browser-win32-x64.exe',
};

function detectMusl() {
  if (process.platform !== 'linux') return false;
  try {
    const result = spawnSync('ldd', ['--version'], { encoding: 'utf8' });
    return (result.stdout || '').toLowerCase().includes('musl');
  } catch {
    return false;
  }
}

/**
 * Locate the agent-browser native binary.
 * Order: env override → packaged extraResources → project node_modules → PATH.
 */
export function resolveAgentBrowserBinary() {
  const binName =
    PLATFORM_BINARIES[
      process.platform === 'linux' && detectMusl()
        ? `linux-musl-${process.arch}`
        : `${process.platform}-${process.arch}`
    ];
  if (!binName) return null;

  const candidates = [];

  if (process.env.AGENT_BROWSER_BIN) {
    candidates.push(process.env.AGENT_BROWSER_BIN);
  }

  if (app.isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'agent-browser', binName));
  }

  // src/electron → project root (dev) ; packaged asar keeps node_modules inside
  candidates.push(
    path.join(__dirname, '..', '..', 'node_modules', 'agent-browser', 'bin', binName),
  );

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }

  // Last resort: whatever `agent-browser` resolves to on PATH
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const res = spawnSync(whichCmd, ['agent-browser'], { encoding: 'utf8' });
    const first = (res.stdout || '').split(/\r?\n/).find(Boolean);
    if (first && fs.existsSync(first.trim())) {
      // PATH hit may be the .cmd shim; prefer the native binary next to it
      const shimDir = path.dirname(first.trim());
      const native = path.join(shimDir, binName);
      if (fs.existsSync(native)) return native;
      return first.trim();
    }
  } catch {
    /* not on PATH */
  }

  return null;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class GeM_AgentBrowserService {
  constructor() {
    this.binary = resolveAgentBrowserBinary();
    this.profileDir = path.join(app.getPath('userData'), 'gem-agent-browser-profile');
    this.initScriptPath = path.join(app.getPath('userData'), 'gem-ab-init.js');
    this.shotPath = path.join(os.tmpdir(), 'peipl-gem-viewport.jpg');

    /** Whether the agent-browser daemon currently owns a browser session. */
    this.sessionActive = false;
    /** 'auto-connect' | 'cdp' | 'managed' — reported via getBrowserState */
    this.engine = null;
    this.lastScreenshotDataUrl = null;
    this.lastScreenshotBuffer = null;
    /** Serialize CLI calls so screenshot polling never interleaves with clicks/fills. */
    this._runQueue = Promise.resolve();
  }

  get isAvailable() {
    return !!this.binary;
  }

  // ── CLI plumbing ──────────────────────────────────────────────────────────

  _ensureInitScript() {
    try {
      if (!fs.existsSync(this.initScriptPath)) {
        fs.mkdirSync(path.dirname(this.initScriptPath), { recursive: true });
        fs.writeFileSync(this.initScriptPath, OVERFLOW_GUARD_JS, 'utf8');
      }
    } catch {
      /* non-fatal: CSS guard is cosmetic */
    }
    return this.initScriptPath;
  }

  /**
   * Run one agent-browser command. Always uses --json and the dedicated session.
   * Commands are serialized through `_runQueue` so screenshot polling cannot
   * interleave with clicks/fills on the same daemon session.
   * @returns {Promise<{success:boolean, data?:any, error?:string}>}
   */
  run(args, { timeoutMs = DEFAULT_CMD_TIMEOUT } = {}) {
    const execute = () =>
      new Promise((resolve) => {
        if (!this.binary) {
          resolve({ success: false, error: 'agent-browser binary not found' });
          return;
        }

        const fullArgs = ['--json', '--session', SESSION_NAME, ...args];

        let stdout = '';
        let stderr = '';
        let settled = false;

        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(killer);
          resolve(result);
        };

        const killer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
          finish({
            success: false,
            error: `agent-browser timed out after ${timeoutMs}ms: ${args[0] || ''}`,
          });
        }, timeoutMs);

        const child = spawn(this.binary, fullArgs, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString('utf8');
        });

        child.on('error', (err) => {
          finish({ success: false, error: `Failed to launch agent-browser: ${err.message}` });
        });

        child.on('close', (code) => {
          const text = stdout.trim();
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }

          if (parsed && typeof parsed === 'object' && 'success' in parsed) {
            if (parsed.success) {
              finish({ success: true, data: parsed.data ?? null, warning: parsed.warning });
            } else {
              finish({
                success: false,
                error: parsed.error?.message || parsed.error || stderr.trim() || `agent-browser exited ${code}`,
                data: parsed.data ?? null,
              });
            }
            return;
          }

          // Non-JSON output: treat exit code as the signal
          if (code === 0) {
            finish({ success: true, data: text || null });
          } else {
            finish({
              success: false,
              error: (stderr.trim() || text || `agent-browser exited ${code}`).slice(0, 500),
            });
          }
        });
      });

    const result = this._runQueue.then(execute, execute);
    this._runQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Convenience: run an `eval` and return the parsed JSON value. */
  async evalJson(jsExpression) {
    const res = await this.run(['eval', jsExpression], { timeoutMs: 30_000 });
    if (!res.success) return { success: false, error: res.error };
    const raw = res.data?.result;
    if (raw === undefined || raw === null) return { success: true, value: null };
    try {
      return { success: true, value: JSON.parse(raw) };
    } catch {
      return { success: true, value: raw };
    }
  }

  async _injectGuard() {
    await this.evalJson(OVERFLOW_GUARD_JS).catch(() => null);
  }

  /**
   * Poll an eval expression until it returns a truthy value or time runs out.
   * agent-browser's `wait <selector>`/`--fn` are unreliable across versions,
   * so conditions are checked through `eval`, which is verified working.
   */
  async _waitForEval(jsExpression, timeoutMs = 15_000, intervalMs = 1_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.evalJson(`(() => !!(${jsExpression}))()`);
      if (res.success && res.value) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  // ── Browser lifecycle ─────────────────────────────────────────────────────

  /**
   * @param {{ mode?: 'auto'|'managed'|'attach', cdp?: string }} [options]
   *  mode 'auto'    — try the user's running Chrome (--auto-connect), then a
   *                   managed headed Chrome with a persistent profile.
   *  mode 'managed' — always launch the managed headed Chrome.
   *  mode 'attach'  — connect to `options.cdp` (port or ws URL) only.
   */
  async openGeM(options = {}) {
    try {
      if (this.sessionActive) {
        const probe = await this.run(['get', 'url'], { timeoutMs: 10_000 });
        if (probe.success) {
          return { success: true, method: this.engine, reused: true };
        }
        this.sessionActive = false;
        this.engine = null;
      }

      const mode = options.mode || 'auto';
      const initScript = this._ensureInitScript();

      // 1) Attach to the user's real Chrome (real profile, cookies, passwords)
      if (mode === 'auto' || mode === 'attach') {
        const attachArgs =
          mode === 'attach' && options.cdp
            ? ['--cdp', String(options.cdp), '--pin-tab']
            : ['--auto-connect', '--pin-tab'];

        const attach = await this.run([...attachArgs, 'open', GEM_LOGIN_URL], {
          timeoutMs: NAV_TIMEOUT,
        });

        if (attach.success) {
          this.sessionActive = true;
          this.engine = mode === 'attach' ? 'cdp' : 'auto-connect';
          await this._injectGuard();
          return { success: true, method: this.engine };
        }

        if (mode === 'attach') {
          return {
            success: false,
            error: `Could not attach to browser at ${options.cdp}: ${attach.error}`,
          };
        }
        // auto: fall through to managed launch
      }

      // 2) Managed headed Chrome with persistent profile
      fs.mkdirSync(this.profileDir, { recursive: true });

      const managed = await this.run(
        [
          '--headed',
          '--profile', this.profileDir,
          '--ignore-https-errors',
          '--init-script', initScript,
          '--args',
            '--start-maximized,--no-first-run,--no-default-browser-check,--disable-infobars,--disable-background-timer-throttling',
          'open',
          GEM_LOGIN_URL,
        ],
        { timeoutMs: NAV_TIMEOUT },
      );

      if (!managed.success) {
        return {
          success: false,
          error:
            `Failed to open GeM browser. Install agent-browser's browser with ` +
            `\`npx agent-browser install\` or start Chrome with remote debugging. ` +
            `${managed.error || ''}`,
        };
      }

      this.sessionActive = true;
      this.engine = 'managed';
      await this._injectGuard();
      return { success: true, method: this.engine };
    } catch (error) {
      this.sessionActive = false;
      this.engine = null;
      return {
        success: false,
        error: `Failed to open GeM: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async close() {
    try {
      await this.run(['close'], { timeoutMs: 15_000 }).catch(() => null);
    } finally {
      this.sessionActive = false;
      this.engine = null;
      this.lastScreenshotDataUrl = null;
      this.lastScreenshotBuffer = null;
    }
    return { success: true };
  }

  async getBrowserState() {
    let currentUrl = '';
    let pageTitle = '';

    if (this.sessionActive) {
      const [urlRes, titleRes] = await Promise.all([
        this.run(['get', 'url'], { timeoutMs: 8_000 }).catch(() => null),
        this.run(['get', 'title'], { timeoutMs: 8_000 }).catch(() => null),
      ]);
      if (urlRes?.success === false) {
        // Browser went away — mark session inactive so UI reflects reality
        this.sessionActive = false;
        this.engine = null;
      } else {
        currentUrl = urlRes?.data?.url || '';
        pageTitle = titleRes?.data?.title || '';
      }
    }

    return {
      isOpen: this.sessionActive,
      currentUrl,
      pageTitle,
      connectionMethod: this.engine || '',
    };
  }

  async getCurrentUrl() {
    const res = await this.run(['get', 'url'], { timeoutMs: 10_000 });
    return res.success ? (res.data?.url ?? '') : '';
  }

  async getPageTitle() {
    const res = await this.run(['get', 'title'], { timeoutMs: 10_000 });
    return res.success ? (res.data?.title ?? '') : '';
  }

  // ── Navigation controls ───────────────────────────────────────────────────

  async goBack() {
    const res = await this.run(['back'], { timeoutMs: 30_000 });
    return res.success ? { success: true } : { success: false, error: res.error };
  }

  async goForward() {
    const res = await this.run(['forward'], { timeoutMs: 30_000 });
    return res.success ? { success: true } : { success: false, error: res.error };
  }

  async reload() {
    const res = await this.run(['reload'], { timeoutMs: 30_000 });
    return res.success ? { success: true } : { success: false, error: res.error };
  }

  async navigate(url) {
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'Invalid URL' };
    }
    const res = await this.run(['open', url], { timeoutMs: NAV_TIMEOUT });
    if (res.success) await this._injectGuard();
    return res.success ? { success: true } : { success: false, error: res.error };
  }

  // ── Authentication ────────────────────────────────────────────────────────

  /**
   * Poll the current URL until the fulfilment host appears (SSO complete).
   */
  async waitForLogin(timeoutMs = 300_000) {
    if (!this.sessionActive) {
      return { success: false, error: 'Browser not initialized' };
    }

    const deadline = Date.now() + timeoutMs;
    let consecutiveFailures = 0;

    while (Date.now() < deadline) {
      const res = await this.run(['get', 'url'], { timeoutMs: 10_000 });

      if (!res.success) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 5) {
          this.sessionActive = false;
          this.engine = null;
          return { success: false, error: `Browser session lost: ${res.error}` };
        }
      } else {
        consecutiveFailures = 0;
        const url = res.data?.url || '';
        try {
          if (new URL(url).hostname.includes('fulfilment.gem.gov.in')) {
            return { success: true };
          }
        } catch {
          if (url.includes('fulfilment.gem.gov.in')) return { success: true };
        }
      }

      await new Promise((r) => setTimeout(r, 1_500));
    }

    return { success: false, error: 'Login timeout — please try again' };
  }

  // ── Order navigation & extraction ─────────────────────────────────────────

  async navigateToOrders() {
    const res = await this.run(['open', GEM_ORDERS_URL], { timeoutMs: NAV_TIMEOUT });
    if (!res.success) {
      return { success: false, error: `Failed to navigate to orders: ${res.error}` };
    }

    // Best-effort wait for the orders panel; GeM uses long-polling so we avoid
    // networkidle and poll the DOM directly instead.
    await this._waitForEval(
      `document.querySelector('.panel-group.orderpanel, [data-order-panel], [data-order-no]')`,
      15_000,
    );
    await this.run(['wait', '1500'], { timeoutMs: 10_000 }).catch(() => null);
    await this._injectGuard();

    return { success: true };
  }

  /**
   * Extract order panels via a single eval round-trip.
   * Element handles cannot cross CLI invocations, so orders carry plain data
   * only; processOrder re-locates the panel by contract number.
   */
  async extractAllOrders() {
    const js = `(() => {
      const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
      const deepText = (el) => (el ? (el.innerText || el.textContent || '') : '');

      let panels = Array.from(document.querySelectorAll('.panel-group.orderpanel, [data-order-panel]'));
      if (!panels.length) panels = Array.from(document.querySelectorAll('[data-order-no]'));

      const orders = [];
      for (const panel of panels) {
        try {
          let contractNumber = panel.getAttribute && panel.getAttribute('data-order-no');
          if (!contractNumber) {
            const nested = panel.querySelector('[data-order-no]');
            if (nested) contractNumber = nested.getAttribute('data-order-no');
          }
          if (!contractNumber) {
            const m = deepText(panel).match(/GEMC[-\\/][0-9A-Z\\-/]+/i);
            contractNumber = m ? m[0].trim() : null;
          }
          if (!contractNumber) continue;

          const pick = (sel) => {
            const el = panel.querySelector(sel);
            return el ? txt(el) : '';
          };

          orders.push({
            contractNumber: String(contractNumber).trim(),
            contractDate: pick('[data-contract-date], .contract-date'),
            status: pick('[data-status], .order-status'),
            department: pick('[data-department], .department'),
            buyerName: pick('[data-buyer], .buyer-name'),
            buyerDetails: pick('[data-buyer], .buyer-name'),
          });
        } catch (e) { /* skip malformed panel */ }
      }
      return JSON.stringify(orders);
    })()`;

    const res = await this.evalJson(js);
    if (!res.success) {
      return { success: false, error: `Failed to extract orders: ${res.error}` };
    }
    return { success: true, orders: Array.isArray(res.value) ? res.value : [] };
  }

  async findMatchingOrder(invoiceOrderNumber) {
    const result = await this.extractAllOrders();
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const norm = (v) =>
      String(v ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    const expected = norm(invoiceOrderNumber);

    const matched = (result.orders || []).find((o) => {
      const left = norm(o.contractNumber);
      if (!left || !expected) return false;
      return left === expected || left.includes(expected) || expected.includes(left);
    });

    if (!matched) {
      return {
        success: false,
        error: `No matching order found for: ${invoiceOrderNumber}`,
      };
    }

    return { success: true, order: matched };
  }

  /**
   * Mark the PROCESS button inside the panel matching contractNumber, then
   * perform a real CDP click on it.
   */
  async processOrder(order) {
    const contractNumber = order?.contractNumber;
    if (!contractNumber) {
      return { success: false, error: 'Missing contract number' };
    }

    const markJs = `(() => {
      const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const target = norm(${JSON.stringify(contractNumber)});
      const deepText = (el) => (el ? (el.innerText || el.textContent || '') : '');

      let panels = Array.from(document.querySelectorAll('.panel-group.orderpanel, [data-order-panel], [data-order-no]'));
      for (const panel of panels) {
        const attr = panel.getAttribute && panel.getAttribute('data-order-no');
        const nested = panel.querySelector ? panel.querySelector('[data-order-no]') : null;
        const nestedAttr = nested ? nested.getAttribute('data-order-no') : null;
        const m = deepText(panel).match(/GEMC[-\\/][0-9A-Z\\-/]+/i);
        const candidates = [attr, nestedAttr, m && m[0]];
        const hit = candidates.some((c) => {
          const n = norm(c);
          return n && (n === target || n.includes(target) || target.includes(n));
        });
        if (!hit) continue;

        const btn =
          panel.querySelector('.process-order-btn, [data-action="process"]') ||
          Array.from(panel.querySelectorAll('button, a, [role="button"]')).find((b) =>
            /process/i.test(b.innerText || b.textContent || ''),
          );
        if (!btn) return 'nobutton';
        document.querySelectorAll('[data-gem-ab-target]').forEach((el) => el.removeAttribute('data-gem-ab-target'));
        btn.setAttribute('data-gem-ab-target', '1');
        return 'found';
      }
      return 'notfound';
    })()`;

    const marked = await this.evalJson(markJs);
    if (!marked.success) {
      return { success: false, error: `Failed to locate order panel: ${marked.error}` };
    }
    if (marked.value !== 'found') {
      return {
        success: false,
        error:
          marked.value === 'nobutton'
            ? 'PROCESS ORDER button not found'
            : 'Order panel not found on page',
      };
    }

    const click = await this.run(['click', "[data-gem-ab-target='1']"], {
      timeoutMs: 30_000,
    });
    if (!click.success) {
      return { success: false, error: `Failed to click PROCESS ORDER: ${click.error}` };
    }

    // GeM uses long-polling; avoid networkidle, just let the SPA settle.
    await this.run(['wait', '2500'], { timeoutMs: 10_000 }).catch(() => null);
    await this._injectGuard();

    return { success: true };
  }

  async verifyOrderPage(expectedOrderNumber) {
    const js = `(() => {
      const t = (document.body.innerText || '');
      const n = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const target = n(${JSON.stringify(expectedOrderNumber)});
      if (!target) return false;
      if (t.includes(${JSON.stringify(expectedOrderNumber)})) return true;
      const m = t.match(/GEMC[-\\/][0-9A-Z\\-/]+/gi) || [];
      return m.some((c) => {
        const cn = n(c);
        return cn === target || cn.includes(target) || target.includes(cn);
      });
    })()`;

    const res = await this.evalJson(js);
    if (!res.success) {
      return { success: false, error: `Verification failed: ${res.error}` };
    }
    if (!res.value) {
      return { success: false, error: 'Order number mismatch on page' };
    }
    return { success: true };
  }

  // ── Invoice form ──────────────────────────────────────────────────────────

  /**
   * Click the Generate Invoice button: try the semantic locator first, then
   * fall back to mark-and-click on text content.
   */
  async clickGenerateInvoice() {
    const semantic = await this.run(
      ['find', 'role', 'button', 'click', '--name', 'Generate Invoice'],
      { timeoutMs: 20_000 },
    );

    if (!semantic.success) {
      const markJs = `(() => {
        const btn = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]')).find((b) => {
          const t = ((b.innerText || b.value || b.textContent || '') + '').toLowerCase();
          return t.includes('generate') && t.includes('invoice');
        });
        if (!btn) return 'notfound';
        document.querySelectorAll('[data-gem-ab-target]').forEach((el) => el.removeAttribute('data-gem-ab-target'));
        btn.setAttribute('data-gem-ab-target', '1');
        return 'found';
      })()`;

      const marked = await this.evalJson(markJs);
      if (!marked.success || marked.value !== 'found') {
        return { success: false, error: 'Generate Invoice button not found' };
      }

      const click = await this.run(['click', "[data-gem-ab-target='1']"], {
        timeoutMs: 30_000,
      });
      if (!click.success) {
        return { success: false, error: `Failed to click Generate Invoice: ${click.error}` };
      }
    }

    await this.run(['wait', '2500'], { timeoutMs: 10_000 }).catch(() => null);
    await this._injectGuard();

    return { success: true };
  }

  /**
   * Detect invoice form fields in one eval round-trip.
   * Skips hidden/disabled/button inputs so junk fields don't block Continue.
   */
  async detectInvoiceFields() {
    const js = `(() => {
      const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'radio', 'checkbox']);
      const els = Array.from(document.querySelectorAll('input, textarea, select'));
      const fields = [];
      els.forEach((el, i) => {
        try {
          const type = (el.getAttribute('type') || (el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : 'text')).toLowerCase();
          if (type !== 'file' && SKIP_TYPES.has(type)) return;
          if (el.disabled || el.readOnly) return;
          if (el.getAttribute('aria-hidden') === 'true') return;

          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
          if (el.offsetParent === null && type !== 'file') return;

          const name = el.getAttribute('name') || ('field_' + i);
          const id = el.getAttribute('id') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          const required = el.required || el.getAttribute('aria-required') === 'true';

          let label = placeholder;
          if (id) {
            const lbl = document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
            if (lbl) label = (lbl.innerText || lbl.textContent || '').trim() || label;
          }
          if (!label) {
            const parentLabel = el.closest('label');
            if (parentLabel) label = (parentLabel.innerText || parentLabel.textContent || '').trim();
          }
          if (!label) {
            label = el.getAttribute('aria-label') || name;
          }

          // Drop obvious chrome/search noise
          const noise = (label + ' ' + name).toLowerCase();
          if (/search|filter|captcha|csrf|token|_nonce|remember/.test(noise) && type !== 'file') return;

          const value = type === 'file' ? '' : (el.value || '');
          const esc = (s) => String(s).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
          const selector = id ? '#' + CSS.escape(id) : '[name="' + esc(name) + '"]';

          fields.push({
            label: label || name,
            name,
            selector,
            value,
            type,
            tag: el.tagName.toLowerCase(),
            isRequired: !!required,
          });
        } catch (e) { /* skip */ }
      });
      return JSON.stringify(fields);
    })()`;

    const res = await this.evalJson(js);
    if (!res.success) {
      return { success: false, error: `Failed to detect fields: ${res.error}` };
    }
    return { success: true, fields: Array.isArray(res.value) ? res.value : [] };
  }

  /**
   * Attach a local PDF to the first matching file input on the invoice form.
   * @param {string} filePath
   */
  async attachPdf(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'PDF file not found' };
    }

    const markJs = `(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const preferred = inputs.find((el) => {
        const meta = ((el.getAttribute('name') || '') + ' ' + (el.getAttribute('id') || '') + ' ' + (el.getAttribute('accept') || '')).toLowerCase();
        return /pdf|invoice|upload|document|file/.test(meta) || !el.getAttribute('accept') || (el.getAttribute('accept') || '').includes('pdf');
      }) || inputs[0];
      if (!preferred) return 'notfound';
      document.querySelectorAll('[data-gem-ab-file]').forEach((el) => el.removeAttribute('data-gem-ab-file'));
      preferred.setAttribute('data-gem-ab-file', '1');
      return preferred.getAttribute('id')
        ? '#' + CSS.escape(preferred.getAttribute('id'))
        : "[data-gem-ab-file='1']";
    })()`;

    const marked = await this.evalJson(markJs);
    if (!marked.success) {
      return { success: false, error: `Failed to locate file input: ${marked.error}` };
    }
    if (!marked.value || marked.value === 'notfound') {
      return { success: false, error: 'No file upload field found on the GeM invoice form' };
    }

    const upload = await this.run(['upload', String(marked.value), filePath], {
      timeoutMs: 60_000,
    });
    if (!upload.success) {
      return { success: false, error: `Failed to attach PDF: ${upload.error}` };
    }

    await this.run(['wait', '800'], { timeoutMs: 5_000 }).catch(() => null);
    return { success: true, selector: marked.value };
  }

  /**
   * Click GeM Submit / Save / Confirm on the invoice form and check for success cues.
   */
  async submitInvoice() {
    const semanticNames = [
      'Submit Invoice',
      'Submit',
      'Save Invoice',
      'Confirm Upload',
      'Confirm',
      'Upload Invoice',
      'Save & Submit',
      'Save and Submit',
    ];

    let clicked = false;
    for (const name of semanticNames) {
      const semantic = await this.run(
        ['find', 'role', 'button', 'click', '--name', name],
        { timeoutMs: 8_000 },
      );
      if (semantic.success) {
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      const markJs = `(() => {
        const patterns = [/submit\\s*invoice/i, /upload\\s*invoice/i, /save\\s*&?\\s*submit/i, /confirm\\s*upload/i, /^submit$/i, /^save$/i, /^confirm$/i];
        const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'));
        const btn = candidates.find((b) => {
          const t = ((b.innerText || b.value || b.textContent || b.getAttribute('aria-label') || '') + '').trim();
          return patterns.some((re) => re.test(t));
        });
        if (!btn) return 'notfound';
        document.querySelectorAll('[data-gem-ab-target]').forEach((el) => el.removeAttribute('data-gem-ab-target'));
        btn.setAttribute('data-gem-ab-target', '1');
        return 'found';
      })()`;

      const marked = await this.evalJson(markJs);
      if (!marked.success || marked.value !== 'found') {
        return { success: false, error: 'Submit / Save button not found on GeM invoice form' };
      }

      const click = await this.run(['click', "[data-gem-ab-target='1']"], {
        timeoutMs: 30_000,
      });
      if (!click.success) {
        return { success: false, error: `Failed to click Submit: ${click.error}` };
      }
    }

    await this.run(['wait', '2500'], { timeoutMs: 10_000 }).catch(() => null);

    const successJs = `(() => {
      const t = (document.body && (document.body.innerText || document.body.textContent) || '').toLowerCase();
      const url = (location.href || '').toLowerCase();
      if (/invoice\\s*(has\\s*been\\s*)?(submitted|uploaded|saved|created|generated)\\s*successfully/.test(t)) return 'success';
      if (/successfully\\s*(submitted|uploaded|saved|created)/.test(t)) return 'success';
      if (/upload\\s*successful|submission\\s*successful/.test(t)) return 'success';
      if (/error|failed|invalid|mandatory|required field/.test(t) && /please|correct|fill/.test(t)) return 'error';
      if (url.includes('success') || url.includes('invoice')) return 'likely';
      return 'unknown';
    })()`;

    const check = await this.evalJson(successJs);
    const signal = check.success ? check.value : 'unknown';

    if (signal === 'error') {
      return {
        success: false,
        error: 'GeM reported a validation or submission error. Check the form and try again.',
        signal,
      };
    }

    return {
      success: true,
      signal,
      message:
        signal === 'success'
          ? 'GeM confirmed the invoice submission'
          : 'Submit clicked — please verify success on the GeM page',
    };
  }

  /**
   * Fill a form field. `select` elements use agent-browser's `select`
   * (matches by value or visible label); everything else uses `fill`.
   */
  async fillField(selector, value, options = {}) {
    if (!selector) return { success: false, error: 'Missing selector' };

    // Resolve the element kind so we pick fill vs select
    const tagRes = await this.evalJson(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.tagName.toLowerCase() : 'missing'; })()`,
    );
    const tag = tagRes.success ? tagRes.value : 'input';
    if (tag === 'missing') {
      return { success: false, error: `Element not found: ${selector}` };
    }

    const text = String(value ?? '');
    const res =
      tag === 'select'
        ? await this.run(['select', selector, '--', text], { timeoutMs: options.timeout ?? 15_000 })
        : await this.run(['fill', selector, '--', text], { timeoutMs: options.timeout ?? 15_000 });

    if (!res.success) {
      // Some fills fail on the `--` marker parsing; retry without it once
      const retry =
        tag === 'select'
          ? await this.run(['select', selector, text], { timeoutMs: options.timeout ?? 15_000 })
          : await this.run(['fill', selector, text], { timeoutMs: options.timeout ?? 15_000 });
      if (!retry.success) {
        return {
          success: false,
          error: `Failed to fill field "${selector}": ${res.error || retry.error}`,
        };
      }
    }

    // Nudge framework validation listeners (GeM's Angular/React forms)
    await this.evalJson(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); el.dispatchEvent(new Event('blur', {bubbles:true})); return true; })()`,
    ).catch(() => null);

    return { success: true };
  }

  // ── Screenshot / viewport feed ─────────────────────────────────────────────

  /**
   * @param {string} [name]  Label used in the filename.
   * @param {string} [dir]   Directory to write into. Defaults to os.tmpdir().
   */
  async takeScreenshot(name, dir) {
    if (!this.sessionActive) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      if (!name && !dir) {
        // Viewport feed: jpeg to a fixed temp path, returned as a data URL.
        const shot = await this.run(
          [
            'screenshot',
            this.shotPath,
            '--screenshot-format',
            'jpeg',
            '--screenshot-quality',
            '70',
          ],
          { timeoutMs: 20_000 },
        );
        if (!shot.success) {
          return { success: false, error: shot.error };
        }

        const buffer = fs.readFileSync(this.shotPath);
        // Skip re-encoding when nothing changed
        if (this.lastScreenshotBuffer && buffer.equals(this.lastScreenshotBuffer)) {
          return { success: true, base64: this.lastScreenshotDataUrl };
        }
        this.lastScreenshotBuffer = buffer;
        this.lastScreenshotDataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        return { success: true, base64: this.lastScreenshotDataUrl };
      }

      const outDir = dir ?? os.tmpdir();
      fs.mkdirSync(outDir, { recursive: true });
      const filePath = path.join(
        outDir,
        `screenshot-${name || 'default'}-${Date.now()}.jpg`,
      );
      const shot = await this.run(
        ['screenshot', filePath, '--screenshot-format', 'jpeg', '--screenshot-quality', '85'],
        { timeoutMs: 30_000 },
      );
      if (!shot.success) return { success: false, error: shot.error };
      return { success: true, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: `Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

/** @type {GeM_AgentBrowserService | null} */
let _instance = null;

export function getGeM_AgentBrowserService() {
  if (!_instance) {
    _instance = new GeM_AgentBrowserService();
  }
  return _instance;
}

/** Test helper / IPC diagnostics */
export function isAgentBrowserAvailable() {
  return !!resolveAgentBrowserBinary();
}
