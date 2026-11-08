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

  // ── Navigation controls (parity with the agent-browser backend) ───────────

  async goBack() {
    if (!this.page) return { success: false, error: 'Browser not initialized' };
    try {
      await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error instanceof Error ? error.message : error) };
    }
  }

  async goForward() {
    if (!this.page) return { success: false, error: 'Browser not initialized' };
    try {
      await this.page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error instanceof Error ? error.message : error) };
    }
  }

  async reload() {
    if (!this.page) return { success: false, error: 'Browser not initialized' };
    try {
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error instanceof Error ? error.message : error) };
    }
  }

  async navigate(url) {
    if (!this.page) return { success: false, error: 'Browser not initialized' };
    if (!url || typeof url !== 'string') return { success: false, error: 'Invalid URL' };
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error instanceof Error ? error.message : error) };
    }
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

    try {
      let panel = matchedOrder?.element || null;

      // Re-locate by contract number when the element handle was lost over IPC
      if (!panel && matchedOrder?.contractNumber) {
        const found = await this.findMatchingOrder(matchedOrder.contractNumber);
        if (found.success && found.order?.element) {
          panel = found.order.element;
        }
      }

      if (!panel) {
        return {
          success: false,
          error: 'No element handle on matchedOrder — ensure findMatchingOrder returned it',
        };
      }

      let processButton = await panel
        .$(
          '.process-order-btn, [data-action="process"], button:has-text("PROCESS")',
        )
        .catch(() => null);

      if (!processButton) {
        const allButtons = await panel.$$('button').catch(() => []);
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
      // GeM uses long-polling; networkidle often never settles.
      await this.page
        .waitForLoadState('domcontentloaded', { timeout: 15_000 })
        .catch(() => null);
      await this.page.waitForTimeout(2_000).catch(() => null);

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
      const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const target = norm(expectedOrderNumber);
      if (!target) return { success: false, error: 'Missing expected order number' };

      const text = await this.page.evaluate(() => document.body?.innerText || '');
      if (text.includes(expectedOrderNumber)) return { success: true };

      const matches = text.match(/GEMC[-\/][0-9A-Z\-/]+/gi) || [];
      const hit = matches.some((c) => {
        const cn = norm(c);
        return cn === target || cn.includes(target) || target.includes(cn);
      });

      if (!hit) {
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
        .waitForLoadState('domcontentloaded', { timeout: 15_000 })
        .catch(() => null);
      await this.page.waitForTimeout(2_000).catch(() => null);

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
      const fields = await this.page.evaluate(() => {
        const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'radio', 'checkbox']);
        const els = Array.from(document.querySelectorAll('input, textarea, select'));
        const out = [];

        els.forEach((el, i) => {
          try {
            const type = (
              el.getAttribute('type') ||
              (el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : 'text')
            ).toLowerCase();
            if (type !== 'file' && SKIP_TYPES.has(type)) return;
            if (el.disabled || el.readOnly) return;
            if (el.getAttribute('aria-hidden') === 'true') return;

            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
            if (el.offsetParent === null && type !== 'file') return;

            const name = el.getAttribute('name') || `field_${i}`;
            const id = el.getAttribute('id') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const required = el.required || el.getAttribute('aria-required') === 'true';

            let label = placeholder;
            if (id) {
              const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
              if (lbl) label = (lbl.innerText || lbl.textContent || '').trim() || label;
            }
            if (!label) {
              const parentLabel = el.closest('label');
              if (parentLabel) label = (parentLabel.innerText || parentLabel.textContent || '').trim();
            }
            if (!label) label = el.getAttribute('aria-label') || name;

            const noise = `${label} ${name}`.toLowerCase();
            if (/search|filter|captcha|csrf|token|_nonce|remember/.test(noise) && type !== 'file') return;

            const selector = id ? `#${CSS.escape(id)}` : `[name="${name.replace(/"/g, '\\"')}"]`;
            out.push({
              label: label || name,
              name,
              selector,
              value: type === 'file' ? '' : el.value || '',
              type,
              isRequired: !!required,
            });
          } catch {
            /* skip */
          }
        });

        return out;
      });

      return { success: true, fields };
    } catch (error) {
      return {
        success: false,
        error: `Failed to detect fields: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Attach a local PDF to a file input on the invoice form.
   * @param {string} filePath
   */
  async attachPdf(filePath) {
    if (!this.page) return { success: false, error: 'Browser not initialized' };
    if (!filePath) return { success: false, error: 'PDF file not found' };

    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'PDF file not found' };
      }

      const fileInputs = await this.page.$$('input[type="file"]');
      if (!fileInputs.length) {
        return { success: false, error: 'No file upload field found on the GeM invoice form' };
      }

      let target = fileInputs[0];
      for (const input of fileInputs) {
        const meta = await input
          .evaluate((el) =>
            `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('accept') || ''}`.toLowerCase(),
          )
          .catch(() => '');
        if (/pdf|invoice|upload|document|file/.test(meta) || !meta.includes('accept') || meta.includes('pdf')) {
          target = input;
          break;
        }
      }

      await target.setInputFiles(filePath);
      await this.page.waitForTimeout(800).catch(() => null);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to attach PDF: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Click GeM Submit / Save / Confirm and check for success cues.
   */
  async submitInvoice() {
    if (!this.page) return { success: false, error: 'Browser not initialized' };

    try {
      const patterns = [
        /submit\s*invoice/i,
        /upload\s*invoice/i,
        /save\s*&?\s*submit/i,
        /confirm\s*upload/i,
        /^submit$/i,
        /^save$/i,
        /^confirm$/i,
      ];

      const handle = await this.page.evaluateHandle((patternSources) => {
        const regs = patternSources.map((s) => new RegExp(s.source, s.flags));
        const candidates = Array.from(
          document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'),
        );
        return (
          candidates.find((b) => {
            const t = ((b.innerText || b.value || b.textContent || b.getAttribute('aria-label') || '') + '').trim();
            return regs.some((re) => re.test(t));
          }) || null
        );
      }, patterns.map((re) => ({ source: re.source, flags: re.flags })));

      const element = handle.asElement();
      if (!element) {
        await handle.dispose().catch(() => null);
        return { success: false, error: 'Submit / Save button not found on GeM invoice form' };
      }

      await element.click();
      await handle.dispose().catch(() => null);
      await this.page.waitForTimeout(2_500).catch(() => null);

      const signal = await this.page.evaluate(() => {
        const t = (document.body && (document.body.innerText || document.body.textContent) || '').toLowerCase();
        const url = (location.href || '').toLowerCase();
        if (/invoice\s*(has\s*been\s*)?(submitted|uploaded|saved|created|generated)\s*successfully/.test(t)) return 'success';
        if (/successfully\s*(submitted|uploaded|saved|created)/.test(t)) return 'success';
        if (/upload\s*successful|submission\s*successful/.test(t)) return 'success';
        if (/error|failed|invalid|mandatory|required field/.test(t) && /please|correct|fill/.test(t)) return 'error';
        if (url.includes('success') || url.includes('invoice')) return 'likely';
        return 'unknown';
      });

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
    } catch (error) {
      return {
        success: false,
        error: `Failed to submit invoice: ${error instanceof Error ? error.message : String(error)}`,
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