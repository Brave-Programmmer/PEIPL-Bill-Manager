/**
 * GeM IPC Handlers
 * Handles all IPC communication for GeM automation between React and Electron
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getGeM_PlaywrightService } from './gemPlaywright';
import Store from 'electron-store';
import type { GeM_SavedFieldValue } from '../utils/gemTypes';

// Initialize store for GeM field mappings
const gemStore = new Store({
  name: 'gem-workflow',
  defaults: {
    savedFieldValues: [] as GeM_SavedFieldValue[],
  },
});

export function registerGeM_IpcHandlers() {
  const playwrightService = getGeM_PlaywrightService();

  /**
   * Open GeM in browser
   */
  ipcMain.handle('gem:open-browser', async (event) => {
    return await playwrightService.openGeM();
  });

  /**
   * Check if Chrome is running with remote debugging
   */
  ipcMain.handle('gem:check-chrome-debugging', async () => {
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

  /**
   * Wait for user login
   */
  ipcMain.handle('gem:wait-for-login', async (event, timeoutMs = 300000) => {
    return await playwrightService.waitForLogin(timeoutMs);
  });

  /**
   * Navigate to orders page
   */
  ipcMain.handle('gem:navigate-to-orders', async (event) => {
    return await playwrightService.navigateToOrders();
  });

  /**
   * Extract all orders from page
   */
  ipcMain.handle('gem:extract-all-orders', async (event) => {
    const result = await playwrightService.extractAllOrders();
    if (result.success && result.orders) {
      // Remove element handle before sending to renderer to avoid serialization error
      const sanitizedOrders = result.orders.map(({ element, ...rest }) => rest);
      return { success: true, orders: sanitizedOrders };
    }
    return result;
  });

  /**
   * Find matching order by invoice order number
   */
  ipcMain.handle('gem:find-matching-order', async (event, invoiceOrderNumber: string) => {
    const result = await playwrightService.findMatchingOrder(invoiceOrderNumber);
    if (result.success && result.order) {
      // Remove element handle before sending to renderer to avoid serialization error
      const { element, ...sanitizedOrder } = result.order;
      return { success: true, order: sanitizedOrder };
    }
    return result;
  });

  /**
   * Process (click) the matched order
   */
  ipcMain.handle('gem:process-order', async (event, orderData: any) => {
    if (!orderData || !orderData.contractNumber) {
      return { success: false, error: 'Invalid order data or missing contract number' };
    }
    // Reconstruct order object (element reference is lost in IPC, so we'll find it again)
    const result = await playwrightService.findMatchingOrder(orderData.contractNumber);
    if (!result.success || !result.order) {
      return { success: false, error: result.error || 'Could not find order to process' };
    }
    return await playwrightService.processOrder(result.order);
  });

  /**
   * Verify current order page
   */
  ipcMain.handle('gem:verify-order-page', async (event, expectedOrderNumber: string) => {
    return await playwrightService.verifyOrderPage(expectedOrderNumber);
  });

  /**
   * Click generate invoice button
   */
  ipcMain.handle('gem:click-generate-invoice', async (event) => {
    return await playwrightService.clickGenerateInvoice();
  });

  /**
   * Detect invoice form fields
   */
  ipcMain.handle('gem:detect-invoice-fields', async (event) => {
    return await playwrightService.detectInvoiceFields();
  });

  /**
   * Fill a form field
   */
  ipcMain.handle('gem:fill-field', async (event, selector: string, value: string) => {
    return await playwrightService.fillField(selector, value);
  });

  /**
   * Get current page URL
   */
  ipcMain.handle('gem:get-current-url', async (event) => {
    return await playwrightService.getCurrentUrl();
  });

  /**
   * Get page title
   */
  ipcMain.handle('gem:get-page-title', async (event) => {
    return await playwrightService.getPageTitle();
  });

  /**
   * Take screenshot
   */
  ipcMain.handle('gem:take-screenshot', async (event, name: string) => {
    return await playwrightService.takeScreenshot(name);
  });

  /**
   * Close browser
   */
  ipcMain.handle('gem:close-browser', async (event) => {
    await playwrightService.close();
    return { success: true };
  });

  /**
   * Get browser state
   */
  ipcMain.handle('gem:get-browser-state', async (event) => {
    return playwrightService.getBrowserState();
  });

  /**
   * Save field value to persistent store
   */
  ipcMain.handle('gem:save-field-value', (event, value: GeM_SavedFieldValue) => {
    try {
      const savedValues: GeM_SavedFieldValue[] = gemStore.get('savedFieldValues') as any;
      const filtered = savedValues.filter((v) => v.fieldLabel !== value.fieldLabel);
      const updated = [value, ...filtered];
      gemStore.set('savedFieldValues', updated);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  /**
   * Get all saved field values
   */
  ipcMain.handle('gem:get-saved-field-values', (event) => {
    try {
      const values = gemStore.get('savedFieldValues') as GeM_SavedFieldValue[];
      return { success: true, values };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  /**
   * Get saved field value by label
   */
  ipcMain.handle('gem:get-saved-field-value', (event, fieldLabel: string) => {
    try {
      const values: GeM_SavedFieldValue[] = gemStore.get('savedFieldValues') as any;
      const value = values.find((v) => v.fieldLabel === fieldLabel);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  /**
   * Clear all saved field values
   */
  ipcMain.handle('gem:clear-field-values', (event) => {
    try {
      gemStore.set('savedFieldValues', []);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
