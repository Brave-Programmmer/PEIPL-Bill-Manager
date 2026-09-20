export interface CustomerPreset {
  id: string;
  name: string;
  customerName: string;
  plantName: string;
  customerAddress: string;
  customerGST: string;
  vendorCode?: string;
  orderNumber?: string;
  outlineAgreement?: string;
  gemSellerId?: string;
}

export interface InvoiceItem {
  id: number | string;
  description: string;
  subDescriptions?: string[];
  sacHsn: string[];
  quantity: (number | string)[];
  unit: string;
  rate: number[];
  amount: number[];
  cgstRate: number;
  cgstAmount: number[];
  sgstRate: number;
  sgstAmount: number[];
  igstRate?: number;
  igstAmount?: number[];
  totalWithGST: number[];
  dates: string[];
  srNoDate: string[];
  refNo: string[];
}

export interface CompanyDetails {
  name: string;
  address: string;
  gstin: string;
  pan: string;
  mobile: string;
  email: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  branch: string;
  outlineAgreement?: string;
  gemSellerId?: string;
  vendorCode?: string;
  logo?: string;
  signature?: string;
}

export interface CustomerDetails {
  name: string;
  plantName: string;
  address: string;
  gstin: string;
  vendorCode?: string;
  outlineAgreement?: string;
  orderNumber?: string;
  jobsheetNumber?: string;
}

export interface Invoice {
  billNumber: string;
  date: string;
  orderNumber?: string;
  orderDate?: string;
  outlineAgreement?: string;
  gemSellerId?: string;
  jobsheetNo?: string;
  vendorCode?: string;
  customerName: string;
  plantName: string;
  customerAddress: string;
  customerGST: string;
  items: InvoiceItem[];
  itemsPerPage?: number;
  
  // Advanced fields
  companyDetails?: CompanyDetails;
  customerDetails?: CustomerDetails; 
  taxMode: 'GST' | 'IGST';
  discount?: number;
  tds?: number;
  freight?: number;
  roundOff?: number;
  totalTaxableValue: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  grandTotal: number;
  amountInWords: string;
  notes?: string;
  status: 'draft' | 'saved' | 'paid';
  gemUploaded?: boolean;
  showStamp?: boolean;
  filePath?: string;
}

const DEFAULT_ORDER_NUMBER = 'GEMC-511687712601789';

export function normalizeInvoiceOrderNumber(invoice: Invoice): Invoice {
  return {
    ...invoice,
    orderNumber: invoice.orderNumber || DEFAULT_ORDER_NUMBER
  };
}
