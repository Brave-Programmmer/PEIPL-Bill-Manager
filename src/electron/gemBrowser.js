/**
 * GeM Browser Service facade
 *
 * The embedded WebContentsView backend (gemEmbeddedBrowser.js) is the primary
 * engine: it renders GeM inside the PEIPL window so the operator never has to
 * switch to a separate Chrome tab, and automation drives that same view.
 *
 * The legacy agent-browser / Playwright backends are kept as a last-resort
 * fallback: if the embedded view cannot be created at runtime we fall back so
 * the workflow can still complete.
 */

import { getGeM_EmbeddedService } from './gemEmbeddedBrowser.js';
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
  'autoFillLogin',
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
  constructor(getMainWindow) {
    this.embedded = getGeM_EmbeddedService();
    if (typeof getMainWindow === 'function') {
      this.embedded.setWindowGetter(getMainWindow);
    }
    this.agent = getGeM_AgentBrowserService();
    this.playwright = getGeM_PlaywrightService();

    // Embedded first; agent-browser / Playwright are only used if we must fall back.
    this.active = this.embedded;
    this.engine = 'embedded';
  }

  /** Which backend is currently driving the browser. */
  get activeEngine() {
    if (this.active === this.embedded) return 'embedded';
    return this.active === this.agent ? 'agent-browser' : 'playwright';
  }

  async openGeM(options = {}) {
    const embedded = await this.embedded.openGeM(options);
    if (embedded.success) {
      this.active = this.embedded;
      this.engine = 'embedded';
      return embedded;
    }

    // Fallback 1: agent-browser CLI
    if (this.agent.isAvailable) {
      const viaAgent = await this.agent.openGeM(options);
      if (viaAgent.success) {
        this.active = this.agent;
        this.engine = 'agent-browser';
        return viaAgent;
      }
    }

    // Fallback 2: Playwright
    const viaPlaywright = await this.playwright.openGeM();
    if (viaPlaywright.success) {
      this.active = this.playwright;
      this.engine = 'playwright';
      return { ...viaPlaywright, method: `${viaPlaywright.method || 'playwright'} (fallback)` };
    }

    return embedded;
  }

  async close() {
    // Tear down every backend so no stray window/session survives.
    await this.embedded.close().catch(() => null);
    await this.agent.close().catch(() => null);
    await this.playwright.close().catch(() => null);
  }
}

for (const method of DELEGATED_METHODS) {
  GeMBrowserService.prototype[method] = function (...args) {
    const target = this.active;
    if (typeof target[method] !== 'function') {
      return Promise.resolve({
        success: false,
        error: `Method ${method} not supported by ${this.activeEngine}`,
      });
    }
    return target[method](...args);
  };
}

let _instance = null;

export function getGeM_BrowserService(getMainWindow) {
  if (!_instance) {
    _instance = new GeMBrowserService(getMainWindow);
  } else if (typeof getMainWindow === 'function') {
    _instance.embedded.setWindowGetter(getMainWindow);
  }
  return _instance;
}
