/**
 * GeM IPC Handlers (JavaScript version for Electron)
 */

import { ipcMain, BrowserView, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getGeM_PlaywrightService } from './gemPlaywright.js';
import Store from 'electron-store';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize store for GeM field mappings
const gemStore = new Store({
  name: 'gem-workflow',
  defaults: {
    savedFieldValues: [],
  },
});

export function registerGeM_IpcHandlers(getMainWindow) {
  const playwrightService = getGeM_PlaywrightService();

  ipcMain.handle('select-pdf', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0], fileName: path.basename(result.filePaths[0]) };
  });

  ipcMain.handle('compress-pdf', async (event, { filePath }) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'PDF file was not found' };
    }

    try {
      const originalBytes = fs.readFileSync(filePath);
      const document = await PDFDocument.load(originalBytes, { ignoreEncryption: false });
      const compressedBytes = await document.save({ useObjectStreams: true, addDefaultPage: false });
      const saveResult = await dialog.showSaveDialog({
        defaultPath: path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}-compressed.pdf`),
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
      });
      if (saveResult.canceled || !saveResult.filePath) return { success: false, canceled: true };
      fs.writeFileSync(saveResult.filePath, compressedBytes);
      return { success: true, path: saveResult.filePath, originalBytes: originalBytes.length, compressedBytes: compressedBytes.length };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Embedded BrowserView for GeM UI
  let gemBrowserView = null;

  const createGeMBrowserView = (win) => {
    if (!win) return null;
    if (gemBrowserView && !gemBrowserView.isDestroyed && !gemBrowserView.webContents.isDestroyed()) {
      return gemBrowserView;
    }

    gemBrowserView = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.setBrowserView(gemBrowserView);
    const [w, h] = win.getContentSize();
    // Reserve right-side column for app UI; adjust as needed
    gemBrowserView.setBounds({ x: Math.floor(w * 0.33), y: 0, width: Math.floor(w * 0.67), height: h });
    gemBrowserView.setAutoResize({ width: true, height: true });

    return gemBrowserView;
  };

  const closeGeMBrowserView = (win) => {
    try {
      if (gemBrowserView && !gemBrowserView.webContents.isDestroyed()) {
        if (win) win.removeBrowserView(gemBrowserView);
        gemBrowserView.webContents.destroy();
        gemBrowserView = null;
      }
    } catch (e) {
      gemBrowserView = null;
    }
  };

  ipcMain.handle('gem:open-browser', async (event) => {
    try {
      // The Playwright page is the page used by every later workflow step.
      // Opening only a BrowserView leaves that page uninitialized.
      return await playwrightService.openGeM();
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('gem:check-chrome-debugging', async () => {
    // Check if Chrome is running with remote debugging
    try {
      const response = await fetch('http://127.0.0.1:9222/json/version');
      if (response.ok) {
        return { success: true, chromeRunning: true };
      }
    } catch {}
    try {
      const response = await fetch('http://localhost:9222/json/version');
      if (response.ok) {
        return { success: true, chromeRunning: true };
      }
    } catch {}
    return { success: true, chromeRunning: false };
  });

  ipcMain.handle('gem:wait-for-login', async (event, timeoutMs = 300000) => {
    return await playwrightService.waitForLogin(timeoutMs);
  });

  ipcMain.handle('gem:navigate-to-orders', async (event) => {
    return await playwrightService.navigateToOrders();
  });

  ipcMain.handle('gem:extract-all-orders', async (event) => {
    const result = await playwrightService.extractAllOrders();
    if (result.success && result.orders) {
      // Remove element handle before sending to renderer to avoid serialization error
      const sanitizedOrders = result.orders.map(({ element, ...rest }) => rest);
      return { success: true, orders: sanitizedOrders };
    }
    return result;
  });

  ipcMain.handle('gem:find-matching-order', async (event, invoiceOrderNumber) => {
    const result = await playwrightService.findMatchingOrder(invoiceOrderNumber);
    if (result.success && result.order) {
      // Remove element handle before sending to renderer to avoid serialization error
      const { element, ...sanitizedOrder } = result.order;
      return { success: true, order: sanitizedOrder };
    }
    return result;
  });

  ipcMain.handle('gem:process-order', async (event, orderData) => {
    if (!orderData || !orderData.contractNumber) {
      return { success: false, error: 'Invalid order data or missing contract number' };
    }
    // Reconstruct order object (element reference is lost in IPC, so we'll find it again in main process)
    const result = await playwrightService.findMatchingOrder(orderData.contractNumber);
    if (!result.success || !result.order) {
      return { success: false, error: result.error || 'Could not find order to process' };
    }
    return await playwrightService.processOrder(result.order);
  });

  ipcMain.handle('gem:verify-order-page', async (event, expectedOrderNumber) => {
    return await playwrightService.verifyOrderPage(expectedOrderNumber);
  });

  ipcMain.handle('gem:click-generate-invoice', async (event) => {
    return await playwrightService.clickGenerateInvoice();
  });

  ipcMain.handle('gem:detect-invoice-fields', async (event) => {
    return await playwrightService.detectInvoiceFields();
  });

  ipcMain.handle('gem:fill-field', async (event, selector, value) => {
    return await playwrightService.fillField(selector, value);
  });

  ipcMain.handle('gem:get-current-url', async (event) => {
    return await playwrightService.getCurrentUrl();
  });

  ipcMain.handle('gem:get-page-title', async (event) => {
    return await playwrightService.getPageTitle();
  });

  ipcMain.handle('gem:take-screenshot', async (event, name) => {
    return await playwrightService.takeScreenshot(name);
  });

  ipcMain.handle('gem:get-screenshot', async (event) => {
    return await playwrightService.takeScreenshot();
  });

  ipcMain.handle('gem:close-browser', async (event) => {
    try {
      const win = getMainWindow ? getMainWindow() : null;
      closeGeMBrowserView(win);
    } catch (e) {}
    // Also close any Playwright-managed browser if present
    await playwrightService.close();
    return { success: true };
  });

  ipcMain.handle('gem:get-browser-state', async (event) => {
    return playwrightService.getBrowserState();
  });

  ipcMain.handle('gem:save-field-value', (event, value) => {
    try {
      const savedValues = gemStore.get('savedFieldValues') || [];
      const filtered = savedValues.filter((v) => v.fieldLabel !== value.fieldLabel);
      const updated = [value, ...filtered];
      gemStore.set('savedFieldValues', updated);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('gem:get-saved-field-values', (event) => {
    try {
      const values = gemStore.get('savedFieldValues') || [];
      return { success: true, values };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('gem:get-saved-field-value', (event, fieldLabel) => {
    try {
      const values = gemStore.get('savedFieldValues') || [];
      const value = values.find((v) => v.fieldLabel === fieldLabel);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('gem:clear-field-values', (event) => {
    try {
      gemStore.set('savedFieldValues', []);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
