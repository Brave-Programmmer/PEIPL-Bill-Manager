export interface WorkflowGateState {
  selectedInvoice: unknown;
  extractedData: unknown;
  validation: { isValid?: boolean; missingFields?: string[] } | null;
  isProcessing: boolean;
  disabled?: boolean;
}

export const canProceedToLogin = (state: WorkflowGateState): boolean => {
  const hasSelectedInvoice = !!state.selectedInvoice;
  const hasExtractedData = !!state.extractedData;
  const isValid = state.validation?.isValid !== false;
  const isBusy = !!state.isProcessing || !!state.disabled;

  return hasSelectedInvoice && hasExtractedData && isValid && !isBusy;
};
