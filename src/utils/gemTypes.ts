/**
 * GeM Automated Invoice Upload Types and Interfaces
 */

export interface GeM_OrderCard {
  contractNumber: string;
  contractDate: string;
  status: string;
  department: string;
  buyerDetails: string;
  buyerName: string;
  element: unknown; // Playwright element reference
}

export interface GeM_ExtractedInvoiceData {
  orderNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  gstNumber: string;
  buyerName: string;
  department: string;
  plantName: string;
  amount: number;
  placeOfSupplyStateUt?: string;
  placeOfSupply?: string;
  vendorDetails: {
    name: string;
    gst: string;
    email?: string;
    mobile?: string;
  };
  metadata: Record<string, unknown>;
}

export interface GeM_FieldMapping {
  gemFieldLabel: string;
  gemFieldSelector?: string;
  mappedFrom?: keyof GeM_ExtractedInvoiceData;
  value?: string;
  category: 'auto-filled' | 'user-defined' | 'required';
  isRequired: boolean;
  isFilled: boolean;
}

export interface GeM_SavedFieldValue {
  fieldLabel: string;
  value: string;
  category: string;
  timestamp: number;
}

export interface GeM_UploadSession {
  sessionId: string;
  startTime: number;
  status: 'login' | 'order-search' | 'invoice-upload' | 'field-mapping' | 'review' | 'completed' | 'failed';
  selectedInvoiceNumber: string;
  selectedOrderNumber: string;
  extractedData: GeM_ExtractedInvoiceData | null;
  matchedOrder: GeM_OrderCard | null;
  fieldMappings: GeM_FieldMapping[];
  userDefinedValues: Record<string, string>;
  errors: string[];
  logs: string[];
}

export interface GeM_UploadHistory {
  id: string;
  invoiceNumber: string;
  orderNumber: string;
  uploadDate: number;
  status: 'success' | 'failed' | 'pending';
  uploadUrl?: string;
  notes?: string;
}

export interface GeM_LoginStatus {
  isLoggedIn: boolean;
  username?: string;
  loginTime?: number;
  sessionToken?: string;
}

export interface GeM_BrowserAutomationState {
  isOpen: boolean;
  isLoggedIn: boolean;
  currentUrl: string;
  pageTitle: string;
  connectionMethod?: string;
  liveScreenshot?: string;
  chromeDebuggingActive?: boolean;
}
