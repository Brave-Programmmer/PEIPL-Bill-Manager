/**
 * GeM Upload - Step 1: Invoice Selection Component
 */

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Loader2, Search } from "lucide-react";

import type { Invoice } from "../utils/types";
import type { GeM_ExtractedInvoiceData } from "../utils/gemTypes";

import {
  extractInvoiceDataForGeM,
  validateExtractedData,
  formatExtractedDataForDisplay,
} from "../utils/gemExtraction";

import { useInvoiceStore } from "../store/useInvoiceStore";
import { migrateOldInvoice } from "../utils/migration";
import { useGeM_Store } from "../store/useGeM_Store";
import { canProceedToLogin } from "../utils/workflowLogic";
import { extractGemBillNumber, gemPdfKey } from "../utils/gemMatching";
import { useDisplayName } from "../utils/userProfile";

interface ValidationResult {
  isValid: boolean;
  missingFields: string[];
}

interface GeM_InvoiceSelectionProps {
  onInvoiceSelected: (data: GeM_ExtractedInvoiceData) => void;
  onNext: () => void;
  disabled?: boolean;
}

interface InvoiceScanResult {
  path: string;
  fy?: string;
  content: Invoice;
}

interface GemPdfScanResult {
  billNumber: string;
  fy?: string;
}

export const GeM_InvoiceSelection: React.FC<GeM_InvoiceSelectionProps> = ({
  onInvoiceSelected,
  onNext,
  disabled = false,
}) => {
  const displayName = useDisplayName();
  const scanPaths = useInvoiceStore((state) => state.scanPaths);
  const gemPaths = useInvoiceStore((state) => state.gemPaths);
  const [showAllBills, setShowAllBills] = useState(false);
  const [selectedFY, setSelectedFY] = useState<string>("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [extractedData, setExtractedData] =
    useState<GeM_ExtractedInvoiceData | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  type ScannedInvoice = Invoice & { scanFy: string };
  const [scannedInvoices, setScannedInvoices] = useState<ScannedInvoice[]>([]);
  const [gemPdfLookup, setGemPdfLookup] = useState<Map<string, boolean>>(new Map());

  const setExtractedDataInStore = useGeM_Store(
    (state) => state.setExtractedData,
  );

  const addLog = useGeM_Store((state) => state.addSessionLog);

  /**
   * Load scanned invoices and gem PDFs (same as Dashboard)
   */
  React.useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        const [invoiceResults, gemResults] = await Promise.all([
          window.electron?.scanInvoices(scanPaths || []) || Promise.resolve([]),
          window.electron?.scanGemPdfs(gemPaths || []) || Promise.resolve([]),
        ]);

        if (!mounted) return;

        // Migrate and set invoices
        const migrated = invoiceResults.map((r: InvoiceScanResult) => ({
          ...(migrateOldInvoice(r.content) as Invoice),
          filePath: r.path,
          scanFy: String(r.fy ?? "Unknown"),
        }));
        setScannedInvoices(migrated as ScannedInvoice[]);
        setSelectedFY(migrated[0]?.scanFy ?? "");

        // Build gem PDF lookup (same logic as Dashboard)
        const lookup = new Map<string, boolean>();
        gemResults.forEach((pdf: GemPdfScanResult) => {
          const key = gemPdfKey(pdf.billNumber, pdf.fy);
          if (extractGemBillNumber(pdf.billNumber)) lookup.set(key, true);
        });
        setGemPdfLookup(lookup);
      } catch (err) {
        console.error("Failed to load invoices/gems for GeM selection", err);
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [scanPaths, gemPaths]);

  /**
   * Extract financial years
   */
  const financialYears = useMemo(() => {
    const years = new Set<string>();
    scannedInvoices.forEach((inv) => {
      if (inv.scanFy) years.add(inv.scanFy);
    });
    return Array.from(years).sort().reverse();
  }, [scannedInvoices]);

  /**
   * Auto-select most recent FY
   */
  /**
   * Filter invoices by FY and gem status (matches Dashboard exactly)
   */
  const filteredInvoices = useMemo(() => {
    if (!selectedFY) return [];

    const result = scannedInvoices.filter((inv) => {
      return inv.scanFy === selectedFY;
    });

    // Mark gem status using same lookup logic as Dashboard
    const resultsWithStatus = result.map((inv) => {
      const hasGemPdf =
        inv.gemUploaded ||
        gemPdfLookup.get(gemPdfKey(inv.billNumber, selectedFY)) ||
        gemPdfLookup.get(gemPdfKey(inv.billNumber, "Unknown"));

      return { ...inv, hasGemPdf: !!hasGemPdf };
    });

    // Filter by pending or all
    let filtered = showAllBills
      ? resultsWithStatus
      : resultsWithStatus.filter((inv) => !inv.hasGemPdf);

    // Search filter
    const search = searchTerm.toLowerCase().trim();
    if (search) {
      filtered = filtered.filter((invoice) =>
        [invoice.billNumber, invoice.customerName]
          .join(' ')
          .toLowerCase()
          .includes(search),
      );
    }

    return filtered;
  }, [scannedInvoices, selectedFY, gemPdfLookup, showAllBills, searchTerm]);

  const handleSelectInvoice = (invoice: Invoice) => {
    try {
      setIsProcessing(true);
      setSelectedInvoice(invoice);

      const data = extractInvoiceDataForGeM(invoice);
      const validationResult = validateExtractedData(data) as ValidationResult;

      setExtractedData(data);
      setValidation(validationResult);
      setExtractedDataInStore(data);

      addLog(`Invoice ${invoice.billNumber} selected and GeM data extracted`);
    } catch (error) {
      console.error("Failed to extract invoice data:", error);
      addLog(`Failed to extract invoice ${invoice.billNumber}`);
      setValidation({
        isValid: false,
        missingFields: ["Failed to process invoice"],
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const canProceed = canProceedToLogin({
    selectedInvoice,
    extractedData,
    validation,
    isProcessing,
    disabled,
  });

  const handleProceed = () => {
    if (!canProceed || !extractedData) return;

    onInvoiceSelected(extractedData);
    onNext();
  };

  /**
   * Preview data
   */
  const displayData = useMemo(() => {
    if (!extractedData) return {};
    return formatExtractedDataForDisplay(extractedData);
  }, [extractedData]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Invoice Selection */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Step 1: Select Invoice
          </h3>

          <div className="mt-4 flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2 block">
                Financial Year
              </label>
              <select 
                value={selectedFY}
                onChange={(e) => {
                  setSelectedFY(e.target.value);
                  setSelectedInvoice(null);
                  setExtractedData(null);
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {!selectedFY && <option value="">Select FY</option>}
                {financialYears.map(fy => (
                  <option key={fy} value={fy}>{`FY ${fy}`}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                onClick={() => setShowAllBills(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${!showAllBills ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600'}`}
              >
                Pending GeM Uploads
              </button>
              <button
                onClick={() => setShowAllBills(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${showAllBills ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600'}`}
              >
                Financial Year Records
              </button>
            </div>
          </div>

          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
            {filteredInvoices.length} {showAllBills ? 'total' : 'pending'} invoice(s) in FY {selectedFY}
          </p>
        </div>

        {selectedFY && filteredInvoices.length > 0 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />

            <input
              type="text"
              placeholder="Search by invoice number or customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {!selectedFY ? (
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />

            <p className="text-slate-500 dark:text-slate-400">
              Please select a financial year.
            </p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />

            <p className="text-slate-500 dark:text-slate-400">
              No {showAllBills ? 'invoices' : 'pending invoices'} found in this financial year.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[450px] overflow-y-auto pr-1">
            {filteredInvoices.map((invoice) => {
              const isSelected =
                selectedInvoice?.billNumber === invoice.billNumber;

              return (
                <motion.button
                  key={`${invoice.billNumber}-${invoice.date}`}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectInvoice(invoice)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm"
                      : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                  }`}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {invoice.billNumber}
                      </div>

                      <div className="text-sm text-slate-600 dark:text-slate-400 truncate mt-1">
                        {invoice.customerName}
                      </div>

                      <div className="text-xs text-slate-500 mt-2">
                        {invoice.date}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 font-medium">
                        ₹{invoice.grandTotal.toLocaleString("en-IN")}
                      </span>

                      {isSelected && (
                        <CheckCircle2 className="w-5 h-5 text-blue-500" />
                      )}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* Extracted Data */}
      {extractedData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            {isProcessing ? (
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            ) : validation?.isValid ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-orange-500" />
            )}

            <h4 className="font-semibold text-slate-900 dark:text-white">
              Extracted Invoice Data
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(displayData).map(([key, value]) => (
              <div
                key={key}
                className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3"
              >
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  {key}
                </div>

                <div className="text-sm font-medium text-slate-900 dark:text-white mt-1 break-words">
                  {String(value)}
                </div>
              </div>
            ))}
          </div>

          {!validation?.isValid && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg"
            >
              <div className="font-medium text-orange-900 dark:text-orange-100">
                Invoice cannot be uploaded to GeM yet.
              </div>

              <div className="text-sm text-orange-800 dark:text-orange-200 mt-2">
                Missing required information:
              </div>

              <ul className="mt-2 text-sm text-orange-800 dark:text-orange-200 space-y-1">
                {validation?.missingFields?.map((field) => (
                  <li key={field}>• {field}</li>
                ))}
              </ul>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Actions */}
      <div className="flex justify-end">
        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className="px-6 py-2.5 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isProcessing ? `${displayName}, processing...` : "Continue to Login"}
        </button>
      </div>
    </motion.div>
  );
};
