const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

contextBridge.exposeInMainWorld('electron', {
  getStoreValue: (key) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key, value) => ipcRenderer.invoke('set-store-value', key, value),
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectPdf: () => ipcRenderer.invoke('select-pdf'),
  compressPdf: (data) => ipcRenderer.invoke('compress-pdf', data),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanInvoices: (paths) => ipcRenderer.invoke('scan-invoices', paths),
  scanGemPdfs: (paths) => ipcRenderer.invoke('scan-gem-pdfs', paths),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),
  onFileOpen: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('open-file', subscription);
    return () => ipcRenderer.removeListener('open-file', subscription);
  },
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  getPrintData: () => ipcRenderer.sendSync('get-print-data'),
  printToPDF: (data) => ipcRenderer.invoke('print-to-pdf', data),
  printWindow: (data) => ipcRenderer.invoke('print-window', data),

  // GeM Automation APIs
  gemOpenBrowser: () => ipcRenderer.invoke('gem:open-browser'),
  gemCheckChromeDebugging: () => ipcRenderer.invoke('gem:check-chrome-debugging'),
  gemWaitForLogin: (timeoutMs) => ipcRenderer.invoke('gem:wait-for-login', timeoutMs),
  gemNavigateToOrders: () => ipcRenderer.invoke('gem:navigate-to-orders'),
  gemExtractAllOrders: () => ipcRenderer.invoke('gem:extract-all-orders'),
  gemFindMatchingOrder: (invoiceOrderNumber) => ipcRenderer.invoke('gem:find-matching-order', invoiceOrderNumber),
  gemProcessOrder: (orderData) => ipcRenderer.invoke('gem:process-order', orderData),
  gemVerifyOrderPage: (expectedOrderNumber) => ipcRenderer.invoke('gem:verify-order-page', expectedOrderNumber),
  gemClickGenerateInvoice: () => ipcRenderer.invoke('gem:click-generate-invoice'),
  gemDetectInvoiceFields: () => ipcRenderer.invoke('gem:detect-invoice-fields'),
  gemFillField: (selector, value) => ipcRenderer.invoke('gem:fill-field', selector, value),
  gemGetCurrentUrl: () => ipcRenderer.invoke('gem:get-current-url'),
  gemGetPageTitle: () => ipcRenderer.invoke('gem:get-page-title'),
  gemTakeScreenshot: (name) => ipcRenderer.invoke('gem:take-screenshot', name),
  gemGetScreenshot: () => ipcRenderer.invoke('gem:get-screenshot'),
  gemCloseBrowser: () => ipcRenderer.invoke('gem:close-browser'),
  gemGetBrowserState: () => ipcRenderer.invoke('gem:get-browser-state'),
  gemSaveFieldValue: (value) => ipcRenderer.invoke('gem:save-field-value', value),
  gemGetSavedFieldValues: () => ipcRenderer.invoke('gem:get-saved-field-values'),
  gemGetSavedFieldValue: (fieldLabel) => ipcRenderer.invoke('gem:get-saved-field-value', fieldLabel),
  gemClearFieldValues: () => ipcRenderer.invoke('gem:clear-field-values'),
});
