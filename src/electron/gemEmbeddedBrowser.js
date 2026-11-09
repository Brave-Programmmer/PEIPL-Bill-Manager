/**
 * GeM Embedded Browser Service — native WebContentsView backend
 *
 * Renders the GeM portal *inside* the PEIPL window as a child WebContentsView,
 * so the operator never has to switch to a separate Chrome window/tab. All the
 * automation (order lookup, form detection, filling, submit) runs directly
 * against that view:
 *
 *  - DOM work via `webContents.executeJavaScript` (same scripts the CLI backend
 *    used, minus the mark-and-CDP dance — we own the page).
 *  - File upload via the CDP `DOM.setFileInputFiles` command.
 *  - Login/OTP happens in the embedded view; a persistent `persist:` partition
 *    keeps the GeM session between uploads.
 *
 * Public API mirrors GeM_AgentBrowserService so the facade can swap engines.
 */

import { WebContentsView, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

const GEM_LOGIN_URL = 'https://sso.gem.gov.in/ARXSSO/oauth/doLogin';
const GEM_ORDERS_URL =
  'https://fulfilment.gem.gov.in/fulfilment/home#WORKSPACE_ID=ORDERS_WS';

const SESSION_PARTITION = 'persist:gem-embedded';

// Injected after navigation to keep GeM's wide tables inside the viewport.
const OVERFLOW_GUARD_JS = `(() => {
  if (document.getElementById('__gem_guard')) return;
  const style = document.createElement('style');
  style.id = '__gem_guard';
  style.innerHTML = 'html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow-x:hidden!important;overflow-y:auto!important}*{box-sizing:border-box!important}div,table,main,section,article,aside,header,footer,nav{max-width:100%!important}table{table-layout:auto!important;width:100%!important}tr,td,th{word-break:break-word!important;word-wrap:break-word!important}img,iframe,embed,video{max-width:100%!important;height:auto!important}';
  document.documentElement.appendChild(style);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Service ──────────────────────────────────────────────────────────────────

export class GeM_EmbeddedService {
  constructor() {
    /** @type {import('electron').BrowserWindow | null} */
    this.window = null;
    /** @type {import('electron').WebContentsView | null} */
    this.view = null;
    /** @type {(input: {x:number,y:number,width:number,height:number}) => void} */
    this._getMainWindow = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.visible = false;
    this.engine = null;
  }

  setWindowGetter(getMainWindow) {
    this._getMainWindow = getMainWindow;
  }

  _ready() {
    return !!(this.view && this.view.webContents && !this.view.webContents.isDestroyed());
  }

  // ── View lifecycle ────────────────────────────────────────────────────────

  async openGeM() {
    try {
      const win = this._getMainWindow ? this._getMainWindow() : null;
      if (!win || win.isDestroyed()) {
        return { success: false, error: 'Main window is not available' };
      }

      if (this._ready()) {
        return { success: true, method: 'embedded', reused: true };
      }

      this.window = win;

      const view = new WebContentsView({
        webPreferences: {
          partition: SESSION_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      win.contentView.addChildView(view);
      this.view = view;
      this.engine = 'embedded';
      this._wireEvents(view);
      this._applyBounds();

      await view.webContents.loadURL(GEM_LOGIN_URL).catch(() => null);

      return { success: true, method: 'embedded' };
    } catch (error) {
      this.view = null;
      this.engine = null;
      return {
        success: false,
        error: `Failed to open embedded GeM browser: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  _wireEvents(view) {
    const wc = view.webContents;

    wc.on('did-finish-load', () => {
      wc.executeJavaScript(OVERFLOW_GUARD_JS).catch(() => null);
    });

    // Keep navigation inside the embedded view; push non-GeM links to the OS browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (/gem\.gov\.in/i.test(url)) {
        this.navigate(url).catch(() => null);
      } else if (/^https?:/i.test(url)) {
        shell.openExternal(url).catch(() => null);
      }
      return { action: 'deny' };
    });
  }

  /** Position / show-hide the native view from renderer-reported geometry. */
  setViewport(payload) {
    if (payload && typeof payload === 'object') {
      this.visible = payload.visible !== false;
      this.bounds = {
        x: Math.round(Number(payload.x) || 0),
        y: Math.round(Number(payload.y) || 0),
        width: Math.max(0, Math.round(Number(payload.width) || 0)),
        height: Math.max(0, Math.round(Number(payload.height) || 0)),
      };
    }
    this._applyBounds();
    return { success: true };
  }

  _applyBounds() {
    if (!this._ready()) return;
    const view = this.view;
    const show = this.visible && this.bounds.width > 2 && this.bounds.height > 2;
    try {
      if (typeof view.setVisible === 'function') view.setVisible(show);
      view.setBounds(show ? this.bounds : { x: 0, y: 0, width: 0, height: 0 });
    } catch {
      /* window may be mid-teardown */
    }
  }

  async close() {
    try {
      if (this.view) {
        const wc = this.view.webContents;
        this._detachDebugger(wc);
        const win = this.window;
        if (win && !win.isDestroyed()) {
          try {
            win.contentView.removeChildView(this.view);
          } catch {
            /* already detached */
          }
        }
        if (wc && !wc.isDestroyed()) wc.close();
      }
    } catch {
      /* best-effort teardown */
    } finally {
      this.view = null;
      this.window = null;
      this.visible = false;
      this.engine = null;
    }
    return { success: true };
  }

  // ── State / navigation ────────────────────────────────────────────────────

  async getBrowserState() {
    if (!this._ready()) {
      return { isOpen: false, currentUrl: '', pageTitle: '', connectionMethod: '' };
    }
    let currentUrl = '';
    let pageTitle = '';
    try {
      currentUrl = this.view.webContents.getURL();
      pageTitle = this.view.webContents.getTitle();
    } catch {
      /* transient */
    }
    return { isOpen: true, currentUrl, pageTitle, connectionMethod: 'embedded' };
  }

  async getCurrentUrl() {
    if (!this._ready()) return '';
    try {
      return this.view.webContents.getURL();
    } catch {
      return '';
    }
  }

  async getPageTitle() {
    if (!this._ready()) return '';
    try {
      return this.view.webContents.getTitle();
    } catch {
      return '';
    }
  }

  async navigate(url) {
    if (!url || typeof url !== 'string') return { success: false, error: 'Invalid URL' };
    if (!this._ready()) return { success: false, error: 'Browser not initialized' };
    try {
      await this.view.webContents.loadURL(url);
      await sleep(500);
      await this._injectGuard();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error?.message || error) };
    }
  }

  async goBack() {
    return this._nav('back');
  }

  async goForward() {
    return this._nav('forward');
  }

  async reload() {
    if (!this._ready()) return { success: false, error: 'Browser not initialized' };
    try {
      this.view.webContents.reload();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error?.message || error) };
    }
  }

  _nav(direction) {
    if (!this._ready()) return { success: false, error: 'Browser not initialized' };
    const wc = this.view.webContents;
    try {
      const history = wc.navigationHistory;
      if (history && typeof history[`canGo${direction === 'back' ? 'Back' : 'Forward'}`] === 'function') {
        const can = direction === 'back' ? history.canGoBack() : history.canGoForward();
        if (!can) return { success: false, error: `No ${direction} history` };
        direction === 'back' ? history.goBack() : history.goForward();
        return { success: true };
      }
      // Fallback for older Electron
      direction === 'back' ? wc.goBack() : wc.goForward();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error?.message || error) };
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async waitForLogin(timeoutMs = 300_000) {
    if (!this._ready()) return { success: false, error: 'Browser not initialized' };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this._ready()) return { success: false, error: 'Browser session was closed' };
      const url = await this.getCurrentUrl();
      try {
        if (new URL(url).hostname.includes('fulfilment.gem.gov.in')) {
          return { success: true };
        }
      } catch {
        if (url.includes('fulfilment.gem.gov.in')) return { success: true };
      }
      await sleep(1_200);
    }
    return { success: false, error: 'Login timeout — please try again' };
  }

  /**
   * Auto-fill the GeM SSO username & password fields from stored credentials.
   * Retries briefly in case the SSO page is still rendering after navigation.
   * OTP / captcha are always left for the operator to complete.
   */
  async autoFillLogin(username, password, attempts = 6) {
    if (!this._ready()) return { success: false, error: 'Browser not initialized' };

    const user = String(username || '');
    const pass = String(password || '');
    if (!user && !pass) return { success: false, error: 'No stored credentials to fill' };

    const js = `(() => {
      const user = ${JSON.stringify(user)};
      const pass = ${JSON.stringify(pass)};

      const isVisible = (el) => {
        if (!el) return false;
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        return el.offsetParent !== null;
      };
      const meta = (el) => (((el.getAttribute('name') || '') + ' ' + (el.getAttribute('id') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase());

      const all = Array.from(document.querySelectorAll('input'));
      const userEl =
        all.find((el) => {
          const t = (el.getAttribute('type') || 'text').toLowerCase();
          if (['password', 'hidden', 'checkbox', 'radio', 'submit', 'button', 'file'].includes(t)) return false;
          return /user|login|email|mobile|seller|account/.test(meta(el)) || t === 'email';
        }) || all.find((el) => ['text', 'email', 'tel'].includes((el.getAttribute('type') || 'text').toLowerCase()));
      const passEl = all.find((el) => (el.getAttribute('type') || '').toLowerCase() === 'password');

      const setVal = (el, value) => {
        if (!el) return false;
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      };

      const out = { foundUser: !!userEl, foundPass: !!passEl, filledUser: false, filledPass: false };
      if (userEl && user && isVisible(userEl)) out.filledUser = setVal(userEl, user);
      if (passEl && pass && isVisible(passEl)) out.filledPass = setVal(passEl, pass);
      return JSON.stringify(out);
    })()`;

    for (let i = 0; i < attempts; i++) {
      const res = await this.evalJson(js);
      if (res.success && res.value && typeof res.value === 'object') {
        const out = res.value;
        if (out.filledUser || out.filledPass) {
          return { success: true, filled: out };
        }
        if (out.foundUser || out.foundPass) {
          return { success: false, error: 'Login fields found but could not be filled', filled: out };
        }
      }
      await sleep(1_200);
    }
    return { success: false, error: 'Could not locate the GeM login fields' };
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  async _injectGuard() {
    if (this._ready()) {
      await this.view.webContents.executeJavaScript(OVERFLOW_GUARD_JS).catch(() => null);
    }
  }

  /** Run an expression and JSON-parse its string result (matches CLI backend). */
  async evalJson(jsExpression) {
    if (!this._ready()) return { success: false, error: 'Browser not initialized' };
    try {
      const raw = await this.view.webContents.executeJavaScript(jsExpression, true);
      if (raw === undefined || raw === null) return { success: true, value: null };
      if (typeof raw === 'string') {
        try {
          return { success: true, value: JSON.parse(raw) };
        } catch {
          return { success: true, value: raw };
        }
      }
      return { success: true, value: raw };
    } catch (error) {
      return { success: false, error: String(error?.message || error) };
    }
  }

  async _evalBoolean(jsExpression) {
    if (!this._ready()) return false;
    try {
      const res = await this.view.webContents.executeJavaScript(
        `(() => { try { return !!( ${jsExpression} ); } catch (e) { return false; } })()`,
        true,
      );
      return !!res;
    } catch {
      return false;
    }
  }

  async _waitForEval(jsExpression, timeoutMs = 15_000, intervalMs = 1_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this._evalBoolean(jsExpression)) return true;
      await sleep(intervalMs);
    }
    return false;
  }

  async _clickSelector(selector) {
    const res = await this.evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.click();
      return 'clicked';
    })()`);
    if (!res.success) return { success: false, error: res.error };
    if (res.value === 'missing') return { success: false, error: `Element not found: ${selector}` };
    return { success: true };
  }

  // ── Order navigation & extraction ─────────────────────────────────────────

  async navigateToOrders() {
    const nav = await this.navigate(GEM_ORDERS_URL);
    if (!nav.success) {
      return { success: false, error: `Failed to navigate to orders: ${nav.error}` };
    }
    // GeM long-polls; poll the DOM instead of waiting for networkidle.
    await this._waitForEval(
      `document.querySelector('.panel-group.orderpanel, [data-order-panel], [data-order-no]')`,
      20_000,
    );
    await sleep(1_500);
    await this._injectGuard();
    return { success: true };
  }

  async extractAllOrders() {
    const js = `(() => {
      const deepText = (el) => (el ? (el.innerText || el.textContent || '') : '');
      const txt = (el) => deepText(el).replace(/\\s+/g, ' ').trim();

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
    if (!res.success) return { success: false, error: `Failed to extract orders: ${res.error}` };
    return { success: true, orders: Array.isArray(res.value) ? res.value : [] };
  }

  async findMatchingOrder(invoiceOrderNumber) {
    const result = await this.extractAllOrders();
    if (!result.success) return { success: false, error: result.error };

    const norm = (v) =>
      String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const expected = norm(invoiceOrderNumber);

    const matched = (result.orders || []).find((o) => {
      const left = norm(o.contractNumber);
      if (!left || !expected) return false;
      return left === expected || left.includes(expected) || expected.includes(left);
    });

    if (!matched) {
      return { success: false, error: `No matching order found for: ${invoiceOrderNumber}` };
    }
    return { success: true, order: matched };
  }

  async processOrder(order) {
    const contractNumber = order?.contractNumber;
    if (!contractNumber) return { success: false, error: 'Missing contract number' };

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
        document.querySelectorAll('[data-gem-target]').forEach((el) => el.removeAttribute('data-gem-target'));
        btn.setAttribute('data-gem-target', '1');
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

    const click = await this._clickSelector("[data-gem-target='1']");
    if (!click.success) {
      return { success: false, error: `Failed to click PROCESS ORDER: ${click.error}` };
    }

    await sleep(2_500);
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
    if (!res.success) return { success: false, error: `Verification failed: ${res.error}` };
    if (!res.value) return { success: false, error: 'Order number mismatch on page' };
    return { success: true };
  }

  // ── Invoice form ──────────────────────────────────────────────────────────

  async clickGenerateInvoice() {
    const markJs = `(() => {
      const btn = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]')).find((b) => {
        const t = ((b.innerText || b.value || b.textContent || '') + '').toLowerCase();
        return t.includes('generate') && t.includes('invoice');
      });
      if (!btn) return 'notfound';
      document.querySelectorAll('[data-gem-target]').forEach((el) => el.removeAttribute('data-gem-target'));
      btn.setAttribute('data-gem-target', '1');
      return 'found';
    })()`;

    const marked = await this.evalJson(markJs);
    if (!marked.success || marked.value !== 'found') {
      return { success: false, error: 'Generate Invoice button not found' };
    }

    const click = await this._clickSelector("[data-gem-target='1']");
    if (!click.success) {
      return { success: false, error: `Failed to click Generate Invoice: ${click.error}` };
    }

    await sleep(2_500);
    await this._injectGuard();
    return { success: true };
  }

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
          if (!label) label = el.getAttribute('aria-label') || name;

          const noise = (label + ' ' + name).toLowerCase();
          if (/search|filter|captcha|csrf|token|_nonce|remember/.test(noise) && type !== 'file') return;

          const value = type === 'file' ? '' : (el.value || '');
          const esc = (s) => String(s).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
          const selector = id ? '#' + CSS.escape(id) : '[name="' + esc(name) + '"]';

          let options;
          if (el.tagName === 'SELECT') {
            options = Array.from(el.options)
              .map((o) => ({ value: String(o.value), label: (o.textContent || '').trim() }))
              .filter((o) => o.label && o.value !== '');
          }

          fields.push({
            label: label || name,
            name,
            selector,
            value,
            type,
            tag: el.tagName.toLowerCase(),
            isRequired: !!required,
            options,
          });
        } catch (e) { /* skip */ }
      });
      return JSON.stringify(fields);
    })()`;

    const res = await this.evalJson(js);
    if (!res.success) return { success: false, error: `Failed to detect fields: ${res.error}` };
    return { success: true, fields: Array.isArray(res.value) ? res.value : [] };
  }

  async fillField(selector, value) {
    if (!selector) return { success: false, error: 'Missing selector' };

    const js = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      const value = ${JSON.stringify(String(value ?? ''))};
      const tag = el.tagName.toLowerCase();
      if (tag === 'select') {
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const wantedNorm = norm(value);
        const opt = Array.from(el.options).find((o) =>
          o.value === value ||
          (o.textContent || '').trim() === value ||
          (wantedNorm && norm(o.textContent) === wantedNorm) ||
          (wantedNorm && norm(o.textContent).includes(wantedNorm)) ||
          (wantedNorm && norm(o.value).includes(wantedNorm)),
        );
        el.value = opt ? opt.value : value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'filled';
      }
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return 'filled';
    })()`;

    const res = await this.evalJson(js);
    if (!res.success) return { success: false, error: `Failed to fill "${selector}": ${res.error}` };
    if (res.value === 'missing') return { success: false, error: `Element not found: ${selector}` };
    return { success: true };
  }

  async submitInvoice() {
    const markJs = `(() => {
      const patterns = [/submit\\s*invoice/i, /upload\\s*invoice/i, /save\\s*&?\\s*submit/i, /confirm\\s*upload/i, /^submit$/i, /^save$/i, /^confirm$/i];
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'));
      const btn = candidates.find((b) => {
        const t = ((b.innerText || b.value || b.textContent || b.getAttribute('aria-label') || '') + '').trim();
        return patterns.some((re) => re.test(t));
      });
      if (!btn) return 'notfound';
      document.querySelectorAll('[data-gem-target]').forEach((el) => el.removeAttribute('data-gem-target'));
      btn.setAttribute('data-gem-target', '1');
      return 'found';
    })()`;

    const marked = await this.evalJson(markJs);
    if (!marked.success || marked.value !== 'found') {
      return { success: false, error: 'Submit / Save button not found on GeM invoice form' };
    }

    const click = await this._clickSelector("[data-gem-target='1']");
    if (!click.success) {
      return { success: false, error: `Failed to click Submit: ${click.error}` };
    }

    await sleep(2_500);

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

  // ── File upload ───────────────────────────────────────────────────────────

  _debugger() {
    const wc = this.view.webContents;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    return wc.debugger;
  }

  _detachDebugger(wc) {
    try {
      if (wc && !wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach();
    } catch {
      /* ignore */
    }
  }

  async attachPdf(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'PDF file not found' };
    }
    if (!this._ready()) return { success: false, error: 'Browser not initialized' };

    const markJs = `(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const preferred = inputs.find((el) => {
        const meta = ((el.getAttribute('name') || '') + ' ' + (el.getAttribute('id') || '') + ' ' + (el.getAttribute('accept') || '')).toLowerCase();
        return /pdf|invoice|upload|document|file/.test(meta) || !el.getAttribute('accept') || (el.getAttribute('accept') || '').includes('pdf');
      }) || inputs[0];
      if (!preferred) return 'notfound';
      document.querySelectorAll('[data-gem-file]').forEach((el) => el.removeAttribute('data-gem-file'));
      preferred.setAttribute('data-gem-file', '1');
      return preferred.getAttribute('id')
        ? '#' + CSS.escape(preferred.getAttribute('id'))
        : "[data-gem-file='1']";
    })()`;

    const marked = await this.evalJson(markJs);
    if (!marked.success) {
      return { success: false, error: `Failed to locate file input: ${marked.error}` };
    }
    if (!marked.value || marked.value === 'notfound') {
      return { success: false, error: 'No file upload field found on the GeM invoice form' };
    }

    try {
      const dbg = this._debugger();
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeId } = await dbg.sendCommand('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: marked.value,
      });
      if (!nodeId) return { success: false, error: 'Could not resolve the file input node' };
      await dbg.sendCommand('DOM.setFileInputFiles', { files: [filePath], nodeId });
    } catch (error) {
      return { success: false, error: `Failed to attach PDF: ${String(error?.message || error)}` };
    }

    await sleep(800);
    return { success: true, selector: marked.value };
  }

  // ── Screenshot (kept for compatibility) ───────────────────────────────────

  async takeScreenshot(name, dir) {
    if (!this._ready()) return { success: false, error: 'Browser not initialized' };
    try {
      const image = await this.view.webContents.capturePage();
      if (!name && !dir) {
        return { success: true, base64: `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}` };
      }
      const outDir = dir ?? os.tmpdir();
      fs.mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, `screenshot-${name || 'default'}-${Date.now()}.jpg`);
      fs.writeFileSync(filePath, image.toJPEG(85));
      return { success: true, path: filePath };
    } catch (error) {
      return { success: false, error: String(error?.message || error) };
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

/** @type {GeM_EmbeddedService | null} */
let _instance = null;

export function getGeM_EmbeddedService() {
  if (!_instance) _instance = new GeM_EmbeddedService();
  return _instance;
}
