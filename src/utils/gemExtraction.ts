/**
 * Invoice Data Extraction Utility
 * Extracts all relevant information from an invoice for GeM upload
 */

import type { Invoice } from './types';
import type { GeM_ExtractedInvoiceData } from './gemTypes';

export function extractInvoiceDataForGeM(invoice: Invoice): GeM_ExtractedInvoiceData {
  const defaultVendorGst = '27AADCP2938G1ZD';
  const vendorGst = invoice.companyDetails?.gstin || defaultVendorGst;

  return {
    orderNumber: invoice.orderNumber || '',
    invoiceNumber: invoice.billNumber,
    invoiceDate: invoice.date,
    gstNumber: invoice.customerGST,
    buyerName: invoice.customerName,
    department: invoice.plantName || '',
    plantName: invoice.plantName || '',
    amount: invoice.grandTotal,
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
