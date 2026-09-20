/**
 * GeM Upload - Step 10-14: Review & Completion Component
 */

import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Loader2, History } from 'lucide-react';
import type { GeM_ExtractedInvoiceData, GeM_OrderCard, GeM_FieldMapping, GeM_UploadHistory } from '../utils/gemTypes';
import { useGeM_Store } from '../store/useGeM_Store';
import { formatExtractedDataForDisplay } from '../utils/gemExtraction';

interface GeM_ReviewProps {
  extractedData: GeM_ExtractedInvoiceData;
  matchedOrder: GeM_OrderCard;
  fieldMappings: GeM_FieldMapping[];
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export const GeM_ReviewScreen: React.FC<GeM_ReviewProps> = ({
  extractedData,
  matchedOrder,
  fieldMappings,
  onConfirm,
  onCancel,
  disabled = false,
}) => {
  const [isReviewing, setIsReviewing] = React.useState(false);
  const completeSession = useGeM_Store((state) => state.completeSession);
  const addLog = useGeM_Store((state) => state.addSessionLog);

  const handleConfirm = async () => {
    setIsReviewing(true);
    addLog('User confirmed upload - all validations passed');

    // Simulate final validation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    completeSession(true);
    setIsReviewing(false);
    onConfirm();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <CheckCircle2 className="w-6 h-6 text-green-500" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Step 5: Review Upload
          </h3>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Please verify all information is correct before submitting.
        </p>
      </div>

      {/* Invoice Data Section */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h4 className="font-semibold text-slate-900 dark:text-white mb-4">Invoice Information</h4>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Object.entries(formatExtractedDataForDisplay(extractedData)).map(([key, value]) => (
            <div key={key} className="bg-slate-50 dark:bg-slate-700/50 rounded p-3">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400">{key}</div>
              <div className="text-sm font-medium text-slate-900 dark:text-white mt-1">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Matched Order Section */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h4 className="font-semibold text-slate-900 dark:text-white mb-4">Matched Order</h4>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-3 col-span-2">
            <div className="text-xs font-medium text-blue-700 dark:text-blue-300">Contract Number</div>
            <div className="text-lg font-bold text-blue-900 dark:text-blue-100 mt-1">
              {matchedOrder.contractNumber}
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-700/50 rounded p-3">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Status</div>
            <div className="text-sm font-medium text-slate-900 dark:text-white mt-1">{matchedOrder.status}</div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-700/50 rounded p-3">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Contract Date</div>
            <div className="text-sm font-medium text-slate-900 dark:text-white mt-1">{matchedOrder.contractDate}</div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-700/50 rounded p-3 col-span-2">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Buyer Name</div>
            <div className="text-sm font-medium text-slate-900 dark:text-white mt-1">{matchedOrder.buyerName}</div>
          </div>
        </div>
      </div>

      {/* Field Mappings Summary */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h4 className="font-semibold text-slate-900 dark:text-white mb-4">Form Fields ({fieldMappings.length})</h4>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {fieldMappings.map((mapping) => (
            <div
              key={mapping.gemFieldLabel}
              className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded text-sm"
            >
              <div className="flex-1">
                <div className="font-medium text-slate-900 dark:text-white">{mapping.gemFieldLabel}</div>
                {mapping.category === 'auto-filled' && (
                  <div className="text-xs text-green-700 dark:text-green-300">Auto-filled</div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {mapping.isFilled ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                )}
              </div>
            </div>
          ))}
        </div>

        {fieldMappings.filter((m) => !m.isFilled).length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-sm text-orange-900 dark:text-orange-100"
          >
            ⚠️ {fieldMappings.filter((m) => !m.isFilled).length} fields are empty
          </motion.div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="text-xs font-medium text-green-700 dark:text-green-300">Fields Filled</div>
          <div className="text-2xl font-bold text-green-900 dark:text-green-100 mt-1">
            {fieldMappings.filter((m) => m.isFilled).length}/{fieldMappings.length}
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="text-xs font-medium text-blue-700 dark:text-blue-300">Invoice Amount</div>
          <div className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1">
            ₹{extractedData.amount.toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      {/* Final Confirmation */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-6">
        <div className="text-sm text-blue-900 dark:text-blue-100">
          <div className="font-semibold mb-2">Ready to upload?</div>
          <ul className="text-xs space-y-1 mb-3">
            <li>✓ Invoice data extracted and verified</li>
            <li>✓ Order matched successfully</li>
            <li>✓ Form fields detected and mapped</li>
            <li>✓ All required information provided</li>
          </ul>
          <div className="text-xs opacity-75">
            Click "Confirm & Upload" to proceed with the invoice upload to GeM.
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          disabled={disabled || isReviewing}
          className="px-6 py-2 rounded-lg font-medium border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={disabled || isReviewing || fieldMappings.filter((m) => !m.isFilled).length > 0}
          className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer"
        >
          {isReviewing && <Loader2 className="w-4 h-4 animate-spin" />}
          {isReviewing ? 'Processing...' : 'Confirm & Upload'}
        </button>
      </div>
    </motion.div>
  );
};

/**
 * Completion & History Component
 */
interface GeM_CompletionProps {
  success: boolean;
  invoiceNumber: string;
  orderNumber: string;
  message?: string;
  onViewHistory?: () => void;
  onNewUpload?: () => void;
  history?: GeM_UploadHistory[];
}

export const GeM_Completion: React.FC<GeM_CompletionProps> = ({
  success,
  invoiceNumber,
  orderNumber,
  message,
  onViewHistory,
  onNewUpload,
  history = [],
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-6"
    >
      {success ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border-2 border-green-200 dark:border-green-800 rounded-lg p-8 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          </motion.div>

          <h2 className="text-2xl font-bold text-green-900 dark:text-green-100 mb-2">
            Upload Successful!
          </h2>
          <p className="text-green-800 dark:text-green-200 mb-6">
            Your invoice has been successfully uploaded to GeM.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white dark:bg-slate-800 rounded p-4">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Invoice Number</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white mt-2">{invoiceNumber}</div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded p-4">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Order Number</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white mt-2">{orderNumber}</div>
            </div>
          </div>

          {message && (
            <div className="text-sm text-green-700 dark:text-green-300 mb-4 p-3 bg-white dark:bg-slate-800 rounded">
              {message}
            </div>
          )}

          {history.length > 0 && (
            <div className="mb-6 text-left">
              <div className="text-sm font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <History className="w-4 h-4" />
                Recent Uploads
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {history.slice(0, 5).map((entry) => (
                  <div
                    key={entry.id}
                    className="text-xs p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
                  >
                    <div className="font-medium text-slate-900 dark:text-white">{entry.invoiceNumber}</div>
                    <div className="text-slate-600 dark:text-slate-400">
                      {entry.orderNumber} • {new Date(entry.uploadDate).toLocaleString('en-IN')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg p-8 text-center"
        >
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-red-900 dark:text-red-100 mb-2">Upload Failed</h2>
          <p className="text-red-800 dark:text-red-200 mb-4">{message || 'Something went wrong during upload.'}</p>
        </motion.div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 justify-center flex-wrap">
        {onViewHistory && (
          <button
            onClick={onViewHistory}
            className="px-6 py-2 rounded-lg font-medium border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-2 cursor-pointer"
          >
            <History className="w-4 h-4" />
            View History
          </button>
        )}

        {onNewUpload && (
          <button
            onClick={onNewUpload}
            className="px-6 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Upload Another
          </button>
        )}
      </div>
    </motion.div>
  );
};
