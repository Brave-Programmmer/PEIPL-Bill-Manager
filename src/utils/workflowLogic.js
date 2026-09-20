export const canProceedToLogin = (state) => {
  const hasSelectedInvoice = !!state.selectedInvoice;
  const hasExtractedData = !!state.extractedData;
  const isValid = state.validation?.isValid !== false;
  const isBusy = !!state.isProcessing || !!state.disabled;

  return hasSelectedInvoice && hasExtractedData && isValid && !isBusy;
};
