/**
 * GeM Upload - Review & Completion
 * Confirm & Upload now re-syncs fields, optionally attaches a PDF, and submits on GeM.
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  History,
  Paperclip,
  Upload,
} from 'lucide-react';
import type {
  GeM_ExtractedInvoiceData,
  GeM_OrderCard,
  GeM_FieldMapping,
  GeM_UploadHistory,
} from '../utils/gemTypes';
import { useGeM_Store } from '../store/useGeM_Store';
import { formatExtractedDataForDisplay } from '../utils/gemExtraction';
import { useInvoiceStore } from '../store/useInvoiceStore';

interface GeM_ReviewProps {
  extractedData: GeM_ExtractedInvoiceData;
  matchedOrder: GeM_OrderCard;
  fieldMappings: GeM_FieldMapping[];
  onConfirm: (result: { success: boolean; message?: string }) => void;
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
  const [progress, setProgress] = React.useState('');
  const [uploadError, setUploadError] = React.useState('');
  const [pdfPath, setPdfPath] = React.useState<string | null>(null);
  const [pdfName, setPdfName] = React.useState('');

  const completeSession = useGeM_Store((state) => state.completeSession);
  const addLog = useGeM_Store((state) => state.addSessionLog);
  const addError = useGeM_Store((state) => state.addSessionError);
  const gemPaths = useInvoiceStore((state) => state.gemPaths);
  const saveInvoice = useInvoiceStore((state) => state.saveInvoice);
  const history = useInvoiceStore((state) => state.history);

  const unfilledCount = fieldMappings.filter((m) => m.isRequired && !m.isFilled).length;

  // Auto-suggest a matching GeM PDF from configured scan folders
  React.useEffect(() => {
    let cancelled = false;
    const suggestPdf = async () => {
      if (!gemPaths?.length || !window.electron?.scanGemPdfs) return;
      try {
        const pdfs = await window.electron.scanGemPdfs(gemPaths);
        const bill = extractedData.invoiceNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const match = (pdfs || []).find((pdf: { billNumber?: string; fileName?: string; path?: string }) => {
          const key = String(pdf.billNumber || pdf.fileName || '')
            .replace(/[^a-zA-Z0-9]/g, '')
            .toLowerCase();
          return key.includes(bill) || bill.includes(key);
        });
        if (!cancelled && match?.path) {
          setPdfPath(match.path);
          setPdfName(match.fileName || match.path.split(/[/\\]/).pop() || 'invoice.pdf');
          addLog(`Suggested GeM PDF: ${match.fileName || match.path}`);
        }
      } catch {
        /* optional convenience — ignore */
      }
    };
    void suggestPdf();
    return () => {
      cancelled = true;
    };
  }, [addLog, extractedData.invoiceNumber, gemPaths]);

  const handleSelectPdf = async () => {
    try {
      const selected = await window.electron.selectPdf?.();
      if (selected?.path) {
        setPdfPath(selected.path);
        setPdfName(selected.fileName || selected.path.split(/[/\\]/).pop() || 'invoice.pdf');
        addLog(`Selected PDF for upload: ${selected.fileName}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const markLocalInvoiceUploaded = () => {
    try {
      const existing = history.find(
        (inv) =>
          inv.billNumber === extractedData.invoiceNumber ||
          inv.orderNumber === extractedData.orderNumber,
      );
      if (existing) {
        saveInvoice({ ...existing, gemUploaded: true });
        addLog(`Marked invoice ${extractedData.invoiceNumber} as GeM-uploaded in history`);
      }
    } catch (err) {
      console.error('Failed to mark local invoice uploaded:', err);
    }
  };

  const handleConfirm = async () => {
    setIsReviewing(true);
    setUploadError('');
    addLog('User confirmed upload — syncing fields and submitting to GeM');

    try {
      // 1) Re-push mapped values so manual edits are on the page
      setProgress('Syncing form fields to GeM…');
      for (const mapping of fieldMappings) {
        if (!mapping.value || !mapping.gemFieldSelector) continue;
        const fill = await window.electron.gemFillField(mapping.gemFieldSelector, mapping.value);
        if (!fill?.success) {
          addLog(`⚠ Could not re-sync "${mapping.gemFieldLabel}": ${fill?.error || 'unknown'}`);
        }
      }

      // 2) Attach PDF when available
      if (pdfPath) {
        setProgress('Attaching invoice PDF…');
        const attach = await window.electron.gemAttachPdf(pdfPath);
        if (!attach.success) {
          const msg = attach.error || 'Failed to attach PDF';
          addLog(`⚠ PDF attach skipped: ${msg}`);
          // Non-fatal — some GeM flows don't require a file on this screen
        } else {
          addLog('✓ PDF attached to GeM form');
        }
      }

      // 3) Submit on GeM
      setProgress('Submitting invoice on GeM…');
      const submit = await window.electron.gemSubmitInvoice();
      if (!submit.success) {
        const msg = submit.error || 'GeM submission failed';
        setUploadError(msg);
        addError(msg);
        completeSession(false);
        setIsReviewing(false);
        onConfirm({ success: false, message: msg });
        return;
      }

      addLog(submit.message || '✓ Invoice submitted to GeM');
      markLocalInvoiceUploaded();
      completeSession(true);
      setIsReviewing(false);
      onConfirm({
        success: true,
        message: submit.message || 'Invoice uploaded successfully to GeM',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown upload error';
      setUploadError(msg);
      addError(msg);
      completeSession(false);
      setIsReviewing(false);
      onConfirm({ success: false, message: msg });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <CheckCircle2 className="w-6 h-6 text-green-500" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Step 5: Review & Upload
          </h3>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Verify details, attach the invoice PDF if needed, then submit directly to GeM.
        </p>
      </div>

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

      {/* PDF attach */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h4 className="font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
          <Paperclip className="w-4 h-4" />
          Invoice PDF (optional)
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Attach the invoice PDF to the GeM form before submit. A matching file from your GeM PDF folders is suggested when found.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSelectPdf}
            disabled={disabled || isReviewing}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
          >
            {pdfPath ? 'Change PDF' : 'Select PDF'}
          </button>
          {pdfPath && (
            <span className="text-sm text-emerald-700 dark:text-emerald-300 truncate max-w-md">
              {pdfName}
            </span>
          )}
          {pdfPath && (
            <button
              type="button"
              onClick={() => {
                setPdfPath(null);
                setPdfName('');
              }}
              disabled={disabled || isReviewing}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Clear
            </button>
          )}
        </div>
      </div>

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

        {unfilledCount > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-sm text-orange-900 dark:text-orange-100"
          >
            {unfilledCount} required field{unfilledCount === 1 ? '' : 's'} still empty or not pushed to GeM
          </motion.div>
        )}
      </div>

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

      {uploadError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-900 dark:text-red-100">
          {uploadError}
        </div>
      )}

      <div className="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-6">
        <div className="text-sm text-blue-900 dark:text-blue-100">
          <div className="font-semibold mb-2">Ready to upload?</div>
          <ul className="text-xs space-y-1 mb-3">
            <li>✓ Invoice data extracted and verified</li>
            <li>✓ Order matched successfully</li>
            <li>✓ Form fields mapped{pdfPath ? ' · PDF ready' : ''}</li>
            <li>✓ Confirm will submit on the live GeM page</li>
          </ul>
          {isReviewing && progress && (
            <div className="text-xs font-medium flex items-center gap-2 mt-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {progress}
            </div>
          )}
        </div>
      </div>

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
          disabled={disabled || isReviewing || unfilledCount > 0}
          className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer"
        >
          {isReviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {isReviewing ? 'Uploading…' : 'Confirm & Upload to GeM'}
        </button>
      </div>
    </motion.div>
  );
};

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
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 }}>
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          </motion.div>
          <h2 className="text-2xl font-bold text-green-900 dark:text-green-100 mb-2">
            Upload Successful!
          </h2>
          <p className="text-green-800 dark:text-green-200 mb-6">
            Your invoice has been submitted to GeM.
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
          <p className="text-red-800 dark:text-red-200 mb-4">
            {message || 'Something went wrong during upload.'}
          </p>
        </motion.div>
      )}

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
