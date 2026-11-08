/**
 * GeM Browser Service facade
 *
 * Picks the best available browser backend:
 *  1. agent-browser CLI (vercel-labs) — auto-connect to the user's real Chrome,
 *     CDP attach, or a managed headed Chrome with a persistent profile.
 *  2. Playwright service — legacy fallback when the agent-browser binary is
 *     not installed.
 *
 * If the agent-browser backend fails to open the browser at runtime, the
 * facade retries once through Playwright so the workflow still works.
 */

import { getGeM_AgentBrowserService } from './gemAgentBrowser.js';
import { getGeM_PlaywrightService } from './gemPlaywright.js';

const DELEGATED_METHODS = [
  'close',
  'getBrowserState',
  'getCurrentUrl',
  'getPageTitle',
  'goBack',
  'goForward',
  'reload',
  'navigate',
  'waitForLogin',
  'navigateToOrders',
  'extractAllOrders',
  'findMatchingOrder',
  'processOrder',
  'verifyOrderPage',
  'clickGenerateInvoice',
  'detectInvoiceFields',
  'fillField',
  'attachPdf',
  'submitInvoice',
  'takeScreenshot',
];

class GeMBrowserService {
  constructor() {
    this.agent = getGeM_AgentBrowserService();
    this.playwright = getGeM_PlaywrightService();
    this.active = this.agent.isAvailable ? this.agent : this.playwright;
    this.engine = this.active === this.agent ? 'agent-browser' : 'playwright';
  }

  /** Which backend is currently driving the browser. */
  get activeEngine() {
    return this.active === this.agent ? 'agent-browser' : 'playwright';
  }

  async openGeM(options = {}) {
    if (this.active === this.agent) {
      const result = await this.agent.openGeM(options);
      if (result.success) return result;

      // Runtime fallback: agent-browser binary exists but couldn't launch —
      // try the Playwright backend before giving up.
      const fallback = await this.playwright.openGeM();
      if (fallback.success) {
        this.active = this.playwright;
        return { ...fallback, method: `${fallback.method || 'playwright'} (fallback)` };
      }
      return result;
    }

    return this.playwright.openGeM();
  }

  async close() {
    // Close whichever backend owns a session; closing the idle one is a no-op.
    await this.active.close().catch(() => null);
    if (this.active !== this.agent) {
      await this.agent.close().catch(() => null);
    }
  }
}

for (const method of DELEGATED_METHODS) {
  GeMBrowserService.prototype[method] = function (...args) {
    const target = this.active;
    if (typeof target[method] !== 'function') {
      return Promise.resolve({ success: false, error: `Method ${method} not supported by ${this.activeEngine}` });
    }
    return target[method](...args);
  };
}

let _instance = null;

export function getGeM_BrowserService() {
  if (!_instance) {
    _instance = new GeMBrowserService();
  }
  return _instance;
}
