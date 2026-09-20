import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IndustrialInvoice } from '../templates/IndustrialInvoice';
import type { Invoice, CompanyDetails } from '../utils/types';
import { MitraLoadingOverlay } from '../components/MitraLoadingOverlay';

const PRINT_DATA_KEY = 'PEIPL_PRINT_DATA';

export const PrintExport: React.FC = () => {
  const [data, setData] = useState<{ invoice: Invoice; company: CompanyDetails } | null>(null);
  const location = useLocation();
  const printStartedRef = useRef(false);
  const autoPrint = new URLSearchParams(location.search).get('autoPrint') === '1';

  useEffect(() => {
    const loadData = () => {
      if (window.electron?.getPrintData) {
        const printData = window.electron.getPrintData();
        if (printData) {
          setData(printData);
          return;
        }
      }

      const stored = localStorage.getItem(PRINT_DATA_KEY);
      if (stored) {
        try {
          setData(JSON.parse(stored));
        } catch {
          localStorage.removeItem(PRINT_DATA_KEY);
        } finally {
          localStorage.removeItem(PRINT_DATA_KEY);
        }
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    if (!data || !autoPrint || printStartedRef.current) return;
    printStartedRef.current = true;
    const timer = window.setTimeout(() => {
      window.print();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [data, autoPrint]);

  useEffect(() => {
    if (!autoPrint) return;
    const handleAfterPrint = () => window.close();
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, [autoPrint]);

  if (!data) {
    return (
      <MitraLoadingOverlay
        visible
        message="Mitra is preparing your printable bill..."
        detail="I am loading the invoice layout and getting it ready for the printer."
      />
    );
  }

  return (
    <div className="bg-white min-h-screen flex justify-center overflow-visible px-4 py-4 print:px-0 print:py-0">
      <div className="print-area w-full max-w-[210mm] bg-white">
        <IndustrialInvoice invoice={data.invoice} company={data.company} />
      </div>
      <style>{`
        body { background: white !important; margin: 0; padding: 0; overflow: visible !important; }
        .print-area { width: 210mm; max-width: 210mm; background: white; }
        @page { size: A4; margin: 0; }
      `}</style>
    </div>
  );
};
