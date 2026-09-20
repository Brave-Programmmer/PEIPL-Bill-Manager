import test from 'node:test';
import assert from 'node:assert/strict';
import { canProceedToLogin } from './workflowLogic.js';

test('blocks navigation when the invoice validation is not complete', () => {
  const result = canProceedToLogin({
    selectedInvoice: { billNumber: 'BILL-001' },
    extractedData: { invoiceNumber: 'INV-001' },
    validation: { isValid: false, missingFields: ['Buyer name'] },
    isProcessing: false,
    disabled: false,
  });

  assert.equal(result, false);
});

test('allows navigation once the invoice is selected and validated', () => {
  const result = canProceedToLogin({
    selectedInvoice: { billNumber: 'BILL-002' },
    extractedData: { invoiceNumber: 'INV-002' },
    validation: { isValid: true, missingFields: [] },
    isProcessing: false,
    disabled: false,
  });

  assert.equal(result, true);
});
