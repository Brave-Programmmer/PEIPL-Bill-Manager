import type { Invoice, CompanyDetails } from './utils/types';
import type {
  GeM_OrderCard,
  GeM_SavedFieldValue,
} from './utils/gemTypes';

export interface IElectronAPI {
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  selectFolder: () => Promise<string | null>;
  scanInvoices: (paths: string[]) => Promise<any[]>;
  scanGemPdfs: (paths: string[]) => Promise<any[]>;
  selectFile: () => Promise<{ path: string; content: any } | null>;
  selectPdf: () => Promise<{ path: string; fileName: string } | null>;
  compressPdf: (data: { filePath: string }) => Promise<{ success: boolean; canceled?: boolean; path?: string; originalBytes?: number; compressedBytes?: number; error?: string }>;
  saveFile: (data: { content: any; filePath?: string }) => Promise<string | null>;
  printToPDF: (data: { invoice: Invoice; company: CompanyDetails }) => Promise<string | null>;
  printWindow: (data: { invoice: Invoice; company: CompanyDetails }) => Promise<boolean>;
  getPrintData: () => { invoice: Invoice; company: CompanyDetails } | null;
  getStoreValue: (key: string) => Promise<any>;
  setStoreValue: (key: string, value: any) => Promise<void>;
  onFileOpen: (callback: (data: any) => void) => () => void;
  
  // GeM Automation APIs
  gemOpenBrowser: () => Promise<{ success: boolean; method?: string; error?: string }>;
  gemCheckChromeDebugging: () => Promise<{ success: boolean; chromeRunning: boolean }>;
  gemWaitForLogin: (timeoutMs?: number) => Promise<{ success: boolean; error?: string }>;
  gemNavigateToOrders: () => Promise<{ success: boolean; error?: string }>;
  gemExtractAllOrders: () => Promise<{ success: boolean; orders?: any[]; error?: string }>;
  gemFindMatchingOrder: (invoiceOrderNumber: string) => Promise<{ success: boolean; order?: GeM_OrderCard; error?: string }>;
  gemProcessOrder: (orderData: GeM_OrderCard) => Promise<{ success: boolean; error?: string }>;
  gemVerifyOrderPage: (expectedOrderNumber: string) => Promise<{ success: boolean; error?: string }>;
  gemClickGenerateInvoice: () => Promise<{ success: boolean; error?: string }>;
  gemDetectInvoiceFields: () => Promise<{ success: boolean; fields?: any[]; error?: string }>;
  gemFillField: (selector: string, value: string) => Promise<{ success: boolean; error?: string }>;
  gemGetCurrentUrl: () => Promise<string>;
  gemGetPageTitle: () => Promise<string>;
  gemTakeScreenshot: (name: string) => Promise<{ success: boolean; error?: string }>;
  gemGetScreenshot: () => Promise<{ success: boolean; base64?: string; error?: string }>;
  gemCloseBrowser: () => Promise<{ success: boolean; error?: string }>;
  gemGetBrowserState: () => Promise<{ isOpen: boolean; currentUrl: string; pageTitle: string; connectionMethod?: string }>;
  gemSaveFieldValue: (value: GeM_SavedFieldValue) => Promise<{ success: boolean; error?: string }>;
  gemGetSavedFieldValues: () => Promise<{ success: boolean; values?: GeM_SavedFieldValue[]; error?: string }>;
  gemGetSavedFieldValue: (fieldLabel: string) => Promise<{ success: boolean; value?: GeM_SavedFieldValue; error?: string }>;
  gemClearFieldValues: () => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
