/**
 * Invoice Data Extraction Utility
 * Extracts all relevant information from an invoice for GeM upload
 */

import type { Invoice } from './types';
import type { GeM_ExtractedInvoiceData } from './gemTypes';

/** GSTIN first-two-digit → Place of Supply label used on GeM forms */
const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir / 01',
  '02': 'Himachal Pradesh / 02',
  '03': 'Punjab / 03',
  '04': 'Chandigarh / 04',
  '05': 'Uttarakhand / 05',
  '06': 'Haryana / 06',
  '07': 'Delhi / 07',
  '08': 'Rajasthan / 08',
  '09': 'Uttar Pradesh / 09',
  '10': 'Bihar / 10',
  '11': 'Sikkim / 11',
  '12': 'Arunachal Pradesh / 12',
  '13': 'Nagaland / 13',
  '14': 'Manipur / 14',
  '15': 'Mizoram / 15',
  '16': 'Tripura / 16',
  '17': 'Meghalaya / 17',
  '18': 'Assam / 18',
  '19': 'West Bengal / 19',
  '20': 'Jharkhand / 20',
  '21': 'Odisha / 21',
  '22': 'Chhattisgarh / 22',
  '23': 'Madhya Pradesh / 23',
  '24': 'Gujarat / 24',
  '26': 'Dadra and Nagar Haveli and Daman and Diu / 26',
  '27': 'Maharashtra / 27',
  '28': 'Andhra Pradesh / 28',
  '29': 'Karnataka / 29',
  '30': 'Goa / 30',
  '31': 'Lakshadweep / 31',
  '32': 'Kerala / 32',
  '33': 'Tamil Nadu / 33',
  '34': 'Puducherry / 34',
  '35': 'Andaman and Nicobar Islands / 35',
  '36': 'Telangana / 36',
  '37': 'Andhra Pradesh / 37',
  '38': 'Ladakh / 38',
};

/**
 * Derive GeM "Place of Supply (State / UT)" from a GSTIN.
 * Falls back to Maharashtra / 27 (PEIPL default market) when GSTIN is missing.
 */
export function placeOfSupplyFromGst(gstin?: string | null): string {
  const code = String(gstin || '').trim().slice(0, 2);
  if (code && GST_STATE_CODES[code]) return GST_STATE_CODES[code];
  if (/^\d{2}$/.test(code)) return `State / ${code}`;
  return 'Maharashtra / 27';
}

export function extractInvoiceDataForGeM(invoice: Invoice): GeM_ExtractedInvoiceData {
  const defaultVendorGst = '27AADCP2938G1ZD';
  const vendorGst = invoice.companyDetails?.gstin || defaultVendorGst;
  const placeOfSupplyStateUt = placeOfSupplyFromGst(invoice.customerGST);

  return {
    orderNumber: invoice.orderNumber || '',
    invoiceNumber: invoice.billNumber,
    invoiceDate: invoice.date,
    gstNumber: invoice.customerGST,
    buyerName: invoice.customerName,
    department: invoice.plantName || '',
    plantName: invoice.plantName || '',
    amount: invoice.grandTotal,
    placeOfSupplyStateUt,
    placeOfSupply: 'Buyer Location',
    vendorDetails: {
      name: invoice.companyDetails?.name || '',
      gst: vendorGst,
      email: invoice.companyDetails?.email,
      mobile: invoice.companyDetails?.mobile,
    },
    metadata: {
      billNumber: invoice.billNumber,
      customerAddress: invoice.customerAddress,
      taxMode: invoice.taxMode,
      totalCGST: invoice.totalCGST,
      totalSGST: invoice.totalSGST,
      totalIGST: invoice.totalIGST,
      totalTaxableValue: invoice.totalTaxableValue,
      itemCount: invoice.items.length,
      notes: invoice.notes,
      filePath: invoice.filePath,
    },
  };
}

/**
 * Validate extracted data
 */
export function validateExtractedData(data: GeM_ExtractedInvoiceData): {
  isValid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  if (!data.orderNumber) missingFields.push('Order Number');
  if (!data.invoiceNumber) missingFields.push('Invoice Number');
  if (!data.invoiceDate) missingFields.push('Invoice Date');
  if (!data.gstNumber) missingFields.push('GST Number');
  if (!data.buyerName) missingFields.push('Buyer Name');
  if (data.amount === 0 || !data.amount) missingFields.push('Amount');
  if (!data.vendorDetails.gst) missingFields.push('Vendor GST');

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Format data for display
 */
export function formatExtractedDataForDisplay(data: GeM_ExtractedInvoiceData) {
  return {
    'Order Number': data.orderNumber,
    'Invoice Number': data.invoiceNumber,
    'Invoice Date': new Date(data.invoiceDate).toLocaleDateString('en-IN'),
    'Buyer Name': data.buyerName,
    'Plant/Department': data.plantName,
    'Amount': `₹${data.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    'Buyer GST': data.gstNumber,
    'Vendor Name': data.vendorDetails.name,
    'Vendor GST': data.vendorDetails.gst,
  };
}
