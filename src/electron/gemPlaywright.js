/**
 * GeM Playwright Automation Service
 *
 * Fixed:
 *  - Changed from launchPersistentContext to connectOverCDP to avoid profile
 *    lock issues. Users must start Chrome with --remote-debugging-port=9222.
 *  - This allows using real Chrome profile with existing sessions, bookmarks,
 *    passwords, cookies, etc.
 *  - extractAllOrders now stores the element handle on each order object so
 *    processOrder can actually reference it.
 *  - processOrder guard changed from matchedOrder.element to check for the
 *    live element handle returned by extractAllOrders.
 *  - detectInvoiceFields selector fallback fixed: `#${id}` was always truthy
 *    (even as "#undefined"). Now uses a proper conditional.
 *  - singleton instance is nulled in close() so getGeM_PlaywrightService()
 *    returns a fresh instance after a session ends.
 *  - fillField now accepts an optional timeout and surfaces the selector in
 *    error messages for easier debugging.
 *  - takeScreenshot path is configurable via an optional argument.
 *  - navigateToOrders uses domcontentloaded instead of networkidle to avoid
 *    hanging on GeM's long-polling requests.
 *  - waitForLogin URL pattern broadened to survive query-string variations.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { chromium } from 'playwright';

const normalizeGeMOrderNumber = (value) => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  return normalized || '';
};

const doesGeMOrderMatch = (candidate, expected) => {
  const left = normalizeGeMOrderNumber(candidate);
  const right = normalizeGeMOrderNumber(expected);

  if (!left || !right) return false;
  if (left === right) return true;

  return left.includes(right) || right.includes(left);
};

export class GeM_PlaywrightService {
  constructor() {
    /** @type {import('playwright').Browser | null} */
    this.browser = null;
    /** @type {import('playwright').BrowserContext | null} */
    this.context = null;
    /** @type {import('playwright').Page | null} */
    this.page = null;
    /** @type {string} */
    this.profileDir = path.join(app.getPath('userData'), 'gem-playwright-profile');

    this.GEM_LOGIN_URL = 'https://sso.gem.gov.in/ARXSSO/oauth/doLogin';
    this.GEM_ORDERS_URL =
      'https://fulfilment.gem.gov.in/fulfilment/home#WORKSPACE_ID=ORDERS_WS';
  }

  // ── Browser lifecycle ─────────────────────────────────────────────────────

  async openGeM() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.bringToFront().catch(() => null);
        return {
          success: true,
          method: this.browser ? 'connectOverCDP' : 'launchPersistentContext',
          reused: true,
        };
      }

      // First try to connect to an already-running Chrome instance with remote debugging
      // This allows using real Chrome profile with existing sessions
      try {
        this.browser = await chromium.connectOverCDP('http://localhost:9222');

        // Get the existing context and page
        const contexts = this.browser.contexts();
        this.context = contexts[0] || (await this.browser.newContext());

        const pages = this.context.pages();
        this.page = pages[0] || (await this.context.newPage());

        this.page.setDefaultTimeout(30_000);
        this.page.setDefaultNavigationTimeout(60_000);

        // Inject comprehensive CSS to prevent horizontal overflow
        await this.page.addInitScript(() => {
          const style = document.createElement('style');
          style.innerHTML = `
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              height: 100% !important;
              overflow-x: hidden !important;
              overflow-y: auto !important;
            }

            * {
              box-sizing: border-box !important;
            }

            div, table, main, section, article, aside, header, footer, nav {
              max-width: 100% !important;
              overflow-x: visible !important;
            }

            table {
              table-layout: auto !important;
              width: 100% !important;
            }

            tr, td, th {
              word-break: break-word !important;
              word-wrap: break-word !important;
            }

            img, iframe, embed, video {
              max-width: 100% !important;
              height: auto !important;
            }

            ::-webkit-scrollbar {
              width: 14px;
            }
            ::-webkit-scrollbar-track {
              background: #f1f1f1;
            }
            ::-webkit-scrollbar-thumb {
              background: #888;
              border-radius: 7px;
            }
            ::-webkit-scrollbar-thumb:hover {
              background: #555;
            }
          `;
          document.documentElement.appendChild(style);
          document.documentElement.style.overflow = 'auto';
          document.body.style.overflow = 'auto';
        });

        // Navigate to GeM login if not already there
        const currentUrl = this.page.url();
        if (!currentUrl.includes('gem.gov.in')) {
          await this.page.goto(this.GEM_LOGIN_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
          });
        }

        await this.page.bringToFront();
        return { success: true, method: 'connectOverCDP' };
      } catch (cdpError) {
        // If connectOverCDP fails, fall back to launchPersistentContext with stable profile
        console.log('connectOverCDP failed, falling back to launchPersistentContext:', cdpError.message);

        fs.mkdirSync(this.profileDir, { recursive: true });

        // Prefer installed Chrome, then fall back to Playwright's managed
        // Chromium. The latter is important on machines without Chrome or
        // without a usable remote-debugging profile.
        const launchOptions = {
          headless: false,
          ignoreHTTPSErrors: true,
          args: [
            '--start-maximized',
            '--disable-infobars',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-timer-throttling',
          ],
        };

        try {
          this.context = await chromium.launchPersistentContext(this.profileDir, {
            ...launchOptions,
            channel: 'chrome',
          });
        } catch (chromeError) {
          console.warn('System Chrome launch failed, trying managed Chromium:', chromeError?.message || chromeError);
          this.context = await chromium.launchPersistentContext(this.profileDir, launchOptions);
        }

        this.page = this.context.pages()[0] ?? (await this.context.newPage());
        this.page.setDefaultTimeout(30_000);
        this.page.setDefaultNavigationTimeout(60_000);

        // Inject comprehensive CSS to prevent horizontal overflow
        await this.page.addInitScript(() => {
          const style = document.createElement('style');
          style.innerHTML = `
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              height: 100% !important;
              overflow-x: hidden !important;
              overflow-y: auto !important;
            }

            * {
              box-sizing: border-box !important;
            }

            div, table, main, section, article, aside, header, footer, nav {
              max-width: 100% !important;
              overflow-x: visible !important;
            }

            table {
              table-layout: auto !important;
              width: 100% !important;
            }

            tr, td, th {
              word-break: break-word !important;
              word-wrap: break-word !important;
            }

            img, iframe, embed, video {
              max-width: 100% !important;
              height: auto !important;
            }

            ::-webkit-scrollbar {
              width: 14px;
            }
            ::-webkit-scrollbar-track {
              background: #f1f1f1;
            }
            ::-webkit-scrollbar-thumb {
              background: #888;
              border-radius: 7px;
            }
            ::-webkit-scrollbar-thumb:hover {
              background: #555;
            }
          `;
          document.documentElement.appendChild(style);
          document.documentElement.style.overflow = 'auto';
          document.body.style.overflow = 'auto';
        });

        await this.page.goto(this.GEM_LOGIN_URL, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });

        await this.page.bringToFront();
        return { success: true, method: 'launchPersistentContext' };
      }
    } catch (error) {
      await this.close().catch(() => null);
      return {
        success: false,
        error: `Failed to open GeM. Make sure Playwright browsers are installed or Chrome is available. ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async close() {
    // Handle both connectOverCDP and launchPersistentContext cases
    if (this.browser) {
      // For connectOverCDP, disconnect but leave the existing Chrome process running.
      await this.browser.disconnect();
      this.browser = null;
      this.context = null;
    } else if (this.context) {
      // For launchPersistentContext, close the context (which closes the launched browser)
      await this.context.close().catch(() => null);
      this.context = null;
    }
    this.page = null;

    // Reset the module-level singleton so the next caller gets a fresh instance
    resetInstance();
  }

  async getBrowserState() {
    return {
      isOpen: !!this.browser || !!this.context,
      currentUrl: this.page?.url() ?? '',
      pageTitle: this.page ? await this.page.title().catch(() => '') : '',
      connectionMethod: this.browser ? 'connectOverCDP' : 'launchPersistentContext',
    };
  }

  async getCurrentUrl() {
    return this.page?.url() ?? '';
  }

  async getPageTitle() {
    return this.page?.title().catch(() => '') ?? '';
  }

  // ── Authentication ────────────────────────────────────────────────────────

  /**
   * Poll until the browser is on a fulfilment URL, indicating the user has
   * completed the SSO login flow manually.
   * @param {number} timeoutMs
   */
  async waitForLogin(timeoutMs = 300_000) {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      // Use a URL predicate rather than a glob pattern so query strings and
      // hash fragments don't cause false negatives.
      await this.page.waitForURL(
        (url) => url.hostname.includes('fulfilment.gem.gov.in'),
        { timeout: timeoutMs },
      );

      // Best-effort wait for the orders panel — non-fatal if absent
      await this.page
        .waitForSelector(
          '[data-testid="orders-container"], .orders-list, .panel-group.orderpanel',
          { timeout: 10_000 },
        )
        .catch(() => null);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Login timeout or failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ── Order navigation ──────────────────────────────────────────────────────

  async navigateToOrders() {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      // domcontentloaded prevents hanging on GeM's long-polling XHRs;
      // we wait for the panel selector separately below.
      await this.page.goto(this.GEM_ORDERS_URL, { waitUntil: 'domcontentloaded' });

      await this.page
        .waitForSelector(
          '.panel-group.orderpanel, [data-testid="orders-container"]',
          { timeout: 15_000 },
        )
        .catch(async () => {
          await this.page.waitForLoadState('networkidle');
        });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to navigate to orders: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ── Order extraction ──────────────────────────────────────────────────────

  /**
   * Extract all order panels from the current page.
   * Each returned order includes an `element` handle so processOrder
   * can interact with the correct DOM node.
   */
  async extractAllOrders() {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      let orderElements = await this.page.$$(
        '.panel-group.orderpanel, [data-order-panel]',
      );

      if (!orderElements.length) {
        orderElements = await this.page.$$('[data-order-no]');
      }

      const orders = [];

      for (const element of orderElements) {
        try {
          // Resolve the contract number from data-attribute → nested element → text
          let contractNumber = await element.getAttribute('data-order-no').catch(() => null);

          if (!contractNumber) {
            const nested = await element.$('[data-order-no]').catch(() => null);
            if (nested) {
              contractNumber = await nested.getAttribute('data-order-no').catch(() => null);
            }
          }

          if (!contractNumber) {
            const text = await element.textContent().catch(() => '');
            const match = text?.match(/GEMC-[0-9A-Z-]+/i);
            contractNumber = match ? match[0].trim() : null;
          }

          if (!contractNumber) continue;

          const contractDate = await element
            .$('[data-contract-date], .contract-date')
            .then((el) => el?.textContent().then((t) => t?.trim() ?? '') ?? '')
            .catch(() => '');

          const status = await element
            .$('[data-status], .order-status')
            .then((el) => el?.textContent().then((t) => t?.trim() ?? '') ?? '')
            .catch(() => '');

          const department = await element
            .$('[data-department], .department')
            .then((el) => el?.textContent().then((t) => t?.trim() ?? '') ?? '')
            .catch(() => '');

          const buyerName = await element
            .$('[data-buyer], .buyer-name')
            .then((el) => el?.textContent().then((t) => t?.trim() ?? '') ?? '')
            .catch(() => '');

          orders.push({
            contractNumber,
            contractDate,
            status,
            department,
            buyerName,
            buyerDetails: buyerName,
            // Store the live element handle so processOrder can click into it
            element,
          });
        } catch {
          // Skip malformed panels; continue to the next
          continue;
        }
      }

      return { success: true, orders };
    } catch (error) {
      return {
        success: false,
        error: `Failed to extract orders: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async findMatchingOrder(invoiceOrderNumber) {
    try {
      const result = await this.extractAllOrders();
      if (!result.success || !result.orders) {
        return { success: false, error: result.error };
      }

      const normalized = normalizeGeMOrderNumber(invoiceOrderNumber);
      const matched = result.orders.find((o) => {
        const contractNo = normalizeGeMOrderNumber(o.contractNumber);
        return doesGeMOrderMatch(contractNo, normalized);
      });

      if (!matched) {
        return {
          success: false,
          error: `No matching order found for: ${invoiceOrderNumber}`,
        };
      }

      return { success: true, order: matched };
    } catch (error) {
      return {
        success: false,
        error: `Failed to find matching order: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ── Order processing ──────────────────────────────────────────────────────

  /**
   * Click the PROCESS ORDER button inside a matched order panel.
   * @param {{ element: import('playwright').ElementHandle }} matchedOrder
   */
  async processOrder(matchedOrder) {
    if (!this.page) return { success: false, error: 'Browser not initialized' };
    if (!matchedOrder?.element) {
      return {
        success: false,
        error: 'No element handle on matchedOrder — ensure findMatchingOrder returned it',
      };
    }

    try {
      let processButton = await matchedOrder.element
        .$(
          '.process-order-btn, [data-action="process"], button:has-text("PROCESS")',
        )
        .catch(() => null);

      if (!processButton) {
        const allButtons = await matchedOrder.element.$$('button').catch(() => []);
        for (const btn of allButtons) {
          const text = await btn.textContent().catch(() => '');
          if (text?.includes('PROCESS')) {
            processButton = btn;
            break;
          }
        }
      }

      if (!processButton) {
        return { success: false, error: 'PROCESS ORDER button not found' };
      }

      await processButton.click();
      await this.page
        .waitForNavigation({ waitUntil: 'networkidle', timeout: 15_000 })
        .catch(() => null);
      await this.page.waitForLoadState('networkidle');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to process order: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async verifyOrderPage(expectedOrderNumber) {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      const content = await this.page.content();
      if (!content.includes(expectedOrderNumber)) {
        return { success: false, error: 'Order number mismatch on page' };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ── Invoice form ──────────────────────────────────────────────────────────

  async clickGenerateInvoice() {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      let btn = await this.page
        .$(
          '[data-action="generate-invoice"], .generate-invoice-btn, button:has-text("Generate Invoice")',
        )
        .catch(() => null);

      if (!btn) {
        const allButtons = await this.page.$$('button');
        for (const b of allButtons) {
          const text = await b.textContent().catch(() => '');
          if (
            text?.toLowerCase().includes('generate') &&
            text?.toLowerCase().includes('invoice')
          ) {
            btn = b;
            break;
          }
        }
      }

      if (!btn) return { success: false, error: 'Generate Invoice button not found' };

      await btn.click();
      await this.page
        .waitForNavigation({ waitUntil: 'networkidle', timeout: 15_000 })
        .catch(() => null);
      await this.page.waitForLoadState('networkidle');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate invoice: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async detectInvoiceFields() {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      const inputElements = await this.page.$$('input, textarea, select');
      const fields = [];

      for (let i = 0; i < inputElements.length; i++) {
        try {
          const element = inputElements[i];
          const type = (await element.getAttribute('type').catch(() => null)) ?? 'text';
          const name =
            (await element.getAttribute('name').catch(() => null)) ?? `field_${i}`;
          const id = (await element.getAttribute('id').catch(() => null)) ?? '';
          const placeholder =
            (await element.getAttribute('placeholder').catch(() => null)) ?? '';

          let label = placeholder;

          if (id) {
            const labelEl = await this.page.$(`label[for="${id}"]`).catch(() => null);
            if (labelEl) {
              label = (await labelEl.textContent().then((t) => t?.trim())) || label;
            }
          }

          if (!label) {
            const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
            label = ariaLabel || name;
          }

          const value = await element.inputValue().catch(() => '');

          // Use a valid, specific selector — fallback to name attribute when no id
          const selector = id ? `#${id}` : `[name="${name}"]`;

          fields.push({ label: label || name, selector, value, type });
        } catch {
          continue;
        }
      }

      return { success: true, fields };
    } catch (error) {
      return {
        success: false,
        error: `Failed to detect fields: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * @param {string} selector
   * @param {string} value
   * @param {{ timeout?: number }} [options]
   */
  async fillField(selector, value, options = {}) {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      // Wait for element to be present
      await this.page.waitForSelector(selector, { timeout: options.timeout ?? 5_000 });

      // Detect element tag name
      const tagName = await this.page.$eval(selector, (el) => el.tagName.toLowerCase()).catch(() => 'input');

      if (tagName === 'select') {
        // Select element requires page.selectOption
        await this.page.selectOption(selector, value);
      } else {
        // Normal input field filling with event dispatching
        await this.page.focus(selector);
        await this.page.fill(selector, value);

        // Dispatch standard events (input, change, blur) to wake up framework validation
        await this.page.$eval(selector, (el) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }).catch(() => null);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fill field "${selector}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /**
   * @param {string} [name]  Label used in the filename.
   * @param {string} [dir] Directory to write into. Defaults to os.tmpdir().
   */
  async takeScreenshot(name, dir) {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      if (!name && !dir) {
        // Return base64 representation directly if no name/dir provided
        const buffer = await this.page.screenshot({ type: 'png' });
        return { success: true, base64: `data:image/png;base64,${buffer.toString('base64')}` };
      }
      const outDir = dir ?? os.tmpdir();
      const filePath = path.join(outDir, `screenshot-${name || 'default'}-${Date.now()}.png`);
      await this.page.screenshot({ path: filePath });
      return { success: true, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: `Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/** @type {GeM_PlaywrightService | null} */
let _instance = null;

/** Called by GeM_PlaywrightService.close() to reset the singleton. */
function resetInstance() {
  _instance = null;
}

/**
 * Returns the shared GeM_PlaywrightService instance, creating one if needed.
 * After close() is called the next call will return a fresh instance.
 */
export function getGeM_PlaywrightService() {
  if (!_instance) {
    _instance = new GeM_PlaywrightService();
  }
  return _instance;
}