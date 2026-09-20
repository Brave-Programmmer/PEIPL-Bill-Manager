import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInvoiceDataForGeM, validateExtractedData } from './gemExtraction.ts';

const mockInvoice = {
  billNumber: 'BILL-001',
  date: '2026-01-15',
  orderNumber: 'GEMC-511687712601789',
  customerName: 'Rashtriya Chemicals & Fertilizers Ltd',
  plantName: 'S.G. INSTRUMENT PLANT',
  customerAddress: 'Mumbai',
  customerGST: '27AAACR2831H1ZK',
  items: [],
  taxMode: 'GST',
  totalTaxableValue: 1000,
  totalCGST: 90,
  totalSGST: 90,
  totalIGST: 0,
  grandTotal: 1180,
  amountInWords: 'One thousand one hundred eighty',
  status: 'draft',
  companyDetails: {
    name: 'PUJARI ENGINEERS INDIA (P) LTD.',
    address: 'B-21, Flat No.101',
    gstin: '',
    pan: 'AADCP2938G',
    mobile: '9820027556',
    email: 'spujari79@gmail.com',
    bankName: 'HDFC Bank',
    accountNo: '50100000000000',
    ifsc: 'HDFC0000123',
    branch: 'Mumbai Main',
  },
} as any;

test('defaults the vendor GST to the company GSTIN when the invoice lacks one', () => {
  const extracted = extractInvoiceDataForGeM(mockInvoice);

  assert.equal(extracted.vendorDetails.gst, '27AADCP2938G1ZD');
  assert.equal(validateExtractedData(extracted).isValid, true);
});
