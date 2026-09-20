import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Printer, FileDown, ShieldCheck, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

import { IndustrialInvoice } from '../templates/IndustrialInvoice';
import { MitraLoadingOverlay } from './MitraLoadingOverlay';
import type { Invoice, CompanyDetails } from '../utils/types';
import {
  DEFAULT_ITEMS_PER_PAGE,
  MAX_ITEMS_PER_PAGE,
  MIN_ITEMS_PER_PAGE,
  normalizeItemsPerPage,
} from '../utils/pagination';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice;
  company: CompanyDetails;
  onUpdateInvoice?: (updates: Partial<Invoice>) => void;
}

export const PrintPreview: React.FC<Props> = ({ isOpen, onClose, invoice, company, onUpdateInvoice }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTask, setLoadingTask] = useState<'print' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentItemsPerPage = normalizeItemsPerPage(invoice.itemsPerPage ?? DEFAULT_ITEMS_PER_PAGE);

  const handlePrint = async () => {
    try {
      setIsLoading(true);
      setLoadingTask('print');
      setError(null);
      if (window.electron?.printWindow) {
        await window.electron.printWindow({ invoice, company });
      } else {
        const printPayload = { invoice, company, createdAt: Date.now() };
        localStorage.setItem('PEIPL_PRINT_DATA', JSON.stringify(printPayload));
        window.open(
          `${window.location.origin}${window.location.pathname}#/print-export?autoPrint=1`,
          '_blank',
          'width=1200,height=900,noopener,noreferrer'
        );
      }
    } catch (err) {
      console.error('Print failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to print invoice');
    } finally {
      setIsLoading(false);
      setLoadingTask(null);
    }
  };

  const handleSavePDF = async () => {
    try {
      setIsLoading(true);
      setLoadingTask('pdf');
      setError(null);
      if (window.electron?.printToPDF) {
        await window.electron.printToPDF({ invoice, company });
      } else {
        alert('PDF Saving is only available in the desktop app.');
      }
    } catch (err) {
      console.error('PDF generation failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to save PDF');
    } finally {
      setIsLoading(false);
      setLoadingTask(null);
    }
  };

  const toggleStamp = () => {
    if (!onUpdateInvoice) return;

    onUpdateInvoice({
      showStamp: !invoice.showStamp,
    });
  };

  const updateItemsPerPage = (nextValue: number) => {
    if (!onUpdateInvoice) return;
    onUpdateInvoice({
      itemsPerPage: normalizeItemsPerPage(nextValue),
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
        >
          <MitraLoadingOverlay
            visible={isLoading}
            message={loadingTask === 'pdf' ? 'Mitra is creating your PDF...' : 'Mitra is preparing your print...'}
            detail={loadingTask === 'pdf' ? 'I am packaging the invoice into a clean, shareable document.' : 'I am handing the finished invoice to the printer.'}
          />
          {/* Modal Container */}
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative flex h-[95vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            {/* Toolbar */}
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 p-4 backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/90">
              <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                  Print Preview
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Preview and export your invoice
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                  <label htmlFor="invoice-items-per-page" className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Page size
                  </label>
                  <input
                    id="invoice-items-per-page"
                    type="number"
                    min={MIN_ITEMS_PER_PAGE}
                    max={MAX_ITEMS_PER_PAGE}
                    step={1}
                    value={currentItemsPerPage}
                    onChange={(event) => updateItemsPerPage(Number(event.target.value))}
                    disabled={isLoading}
                    className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-bold text-slate-700 outline-none transition-all focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>

                <button
                  type="button"
                  onClick={toggleStamp}
                  disabled={isLoading}
                  className={clsx(
                    'flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
                    invoice.showStamp
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  )}
                >
                  <ShieldCheck size={18} />
                  {invoice.showStamp ? 'Stamp Applied' : 'Apply Stamp'}
                </button>

                <button 
                  onClick={handlePrint}
                  disabled={isLoading}
                  className={clsx(
                    "flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-primary-700 transition-all shadow-lg shadow-primary-500/20",
                    isLoading && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Printer size={18} />}
                  Print Invoice
                </button>
                <button 
                  onClick={handleSavePDF}
                  disabled={isLoading}
                  className={clsx(
                    "flex items-center gap-2 bg-accent text-foreground px-4 py-2 rounded-xl font-bold hover:bg-accent/80 transition-all",
                    isLoading && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isLoading ? <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /> : <FileDown size={18} />}
                  Save PDF
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
                <AlertCircle size={18} className="flex-shrink-0" />
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="ml-auto text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Invoice Content */}
            <div className="custom-scrollbar flex-1 overflow-y-auto bg-slate-100 p-6 dark:bg-slate-800">
              <div className="mx-auto w-full max-w-[850px] rounded-xl bg-white shadow-2xl" data-invoice-print>
                <IndustrialInvoice invoice={invoice} company={company} />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};