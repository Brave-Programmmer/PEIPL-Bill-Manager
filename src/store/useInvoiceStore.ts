import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Invoice, InvoiceItem, CompanyDetails, CustomerPreset } from '../utils/types';
import { normalizeInvoiceOrderNumber } from '../utils/types';
import { parseNumeric } from '../utils/formatters';

interface InvoiceState {
  currentInvoice: Invoice | null;
  history: Invoice[];
  companyDetails: CompanyDetails;
  customerPresets: CustomerPreset[];
  theme: 'light' | 'dark';
  scanPaths: string[];
  gemPaths: string[];
  
  // Actions
  setScanPaths: (paths: string[]) => void;
  addScanPath: (path: string) => void;
  removeScanPath: (path: string) => void;
  setGemPaths: (paths: string[]) => void;
  addGemPath: (path: string) => void;
  removeGemPath: (path: string) => void;
  setCurrentInvoice: (invoice: Invoice | null) => void;
  updateCurrentInvoice: (updates: Partial<Invoice>) => void;
  saveInvoice: (invoice: Invoice) => void;
  deleteInvoice: (billNumber: string) => void;
  setCompanyDetails: (details: CompanyDetails) => void;
  savePreset: (preset: CustomerPreset) => void;
  deletePreset: (id: string) => void;
  toggleTheme: () => void;
  
  // Calculations
  calculateTotals: (items: InvoiceItem[], taxMode: 'GST' | 'IGST') => {
    totalTaxableValue: number;
    totalCGST: number;
    totalSGST: number;
    totalIGST: number;
    grandTotal: number;
  };
}

const DEFAULT_COMPANY: CompanyDetails = {
  name: 'PUJARI ENGINEERS INDIA (P) LTD.',
  address: 'B-21, Flat No.101, Siddeshwar Co-op Hsg. Soc; Sector-9, Gharonda, Ghansoli, Navi, Mumbai -400 701.',
  gstin: '27AADCP2938G1ZD',
  pan: 'AADCP2938G',
  mobile: '9820027556',
  email: 'spujari79@gmail.com',
  bankName: 'HDFC Bank',
  accountNo: '50100000000000',
  ifsc: 'HDFC0000123',
  branch: 'Mumbai Main',
  outlineAgreement: '4600002141',
  gemSellerId: 'RXON210002099996',
  vendorCode: '102237',
};

const DEFAULT_PRESETS: CustomerPreset[] = [
  {
    id: 'default-rcf',
    name: 'RCF TROMBAY (Default)',
    customerName: 'RASHTRIYA CHEMICALS & FERTILIZERS LTD',
    plantName: 'S.G. INSTRUMENT PLANT',
    customerAddress: 'TROMBAY UNIT\nMUMBAI.400 074',
    customerGST: '27AAACR2831H1ZK',
    vendorCode: '102237',
    orderNumber: 'GEMC-511687712601789',
    outlineAgreement: '4600002141',
    gemSellerId: 'RXON210002099996'
  }
];

export const useInvoiceStore = create<InvoiceState>()(
  persist(
    (set) => ({
      currentInvoice: null,
      history: [],
      companyDetails: DEFAULT_COMPANY,
      customerPresets: DEFAULT_PRESETS,
      theme: 'light',
      scanPaths: [],
      gemPaths: [],

      setScanPaths: (paths) => set({ scanPaths: paths }),
      addScanPath: (path) => set((state) => ({ 
        scanPaths: state.scanPaths.includes(path) ? state.scanPaths : [...state.scanPaths, path] 
      })),
      removeScanPath: (path) => set((state) => ({ 
        scanPaths: state.scanPaths.filter(p => p !== path) 
      })),

      setGemPaths: (paths) => set({ gemPaths: paths }),
      addGemPath: (path) => set((state) => ({ 
        gemPaths: state.gemPaths.includes(path) ? state.gemPaths : [...state.gemPaths, path] 
      })),
      removeGemPath: (path) => set((state) => ({ 
        gemPaths: state.gemPaths.filter(p => p !== path) 
      })),

      setCurrentInvoice: (invoice) => set({ currentInvoice: invoice }),
      
      updateCurrentInvoice: (updates) => set((state) => ({
        currentInvoice: state.currentInvoice ? { ...state.currentInvoice, ...updates } : null
      })),

      saveInvoice: (invoice) => set((state) => {
        const normalizedInvoice = normalizeInvoiceOrderNumber(invoice);
        const index = state.history.findIndex(h => h.billNumber === normalizedInvoice.billNumber);
        const newHistory = [...state.history];
        if (index > -1) {
          newHistory[index] = normalizedInvoice;
        } else {
          newHistory.unshift(normalizedInvoice);
        }
        return { history: newHistory };
      }),

      deleteInvoice: (billNumber) => set((state) => ({
        history: state.history.filter(h => h.billNumber !== billNumber)
      })),

      setCompanyDetails: (details) => {
        set({ companyDetails: details });
        // After setting company details, also force-clear currentInvoice to avoid stale info
        set({ currentInvoice: null });
      },
      
      savePreset: (preset) => set((state) => {
        const index = state.customerPresets.findIndex(p => p.id === preset.id);
        const newPresets = [...state.customerPresets];
        if (index > -1) {
          newPresets[index] = preset;
        } else {
          newPresets.push(preset);
        }
        return { customerPresets: newPresets };
      }),

      deletePreset: (id) => set((state) => ({
        customerPresets: state.customerPresets.filter(p => p.id !== id)
      })),

      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),

      calculateTotals: (items, taxMode) => {
        let totalTaxableValue = 0;
        let totalCGST = 0;
        let totalSGST = 0;
        let totalIGST = 0;

        (items || []).forEach(item => {
          const qtyArr = Array.isArray(item.quantity) ? item.quantity : [item.quantity];
          const rateArr = Array.isArray(item.rate) ? item.rate : [item.rate];
          
          // Use the longest array to ensure no data is missed, fallback to 0 for missing pairs
          const maxLen = Math.max(qtyArr.length, rateArr.length);
          let itemTaxable = 0;
          for (let i = 0; i < maxLen; i++) {
            const q = parseNumeric(qtyArr[i]);
            const r = parseNumeric(rateArr[i]);
            itemTaxable += q * r;
          }
          
          totalTaxableValue += itemTaxable;
          
          const cgstRate = Number(item.cgstRate) || 0;
          const sgstRate = Number(item.sgstRate) || 0;
          const igstRate = Number(item.igstRate) || 0;

          if (taxMode === 'GST') {
            totalCGST += (itemTaxable * cgstRate) / 100;
            totalSGST += (itemTaxable * sgstRate) / 100;
          } else {
            totalIGST += (itemTaxable * igstRate) / 100;
          }
        });

        const grandTotal = totalTaxableValue + totalCGST + totalSGST + totalIGST;
        
        return {
          totalTaxableValue,
          totalCGST,
          totalSGST,
          totalIGST,
          grandTotal,
        };
      }
    }),
    {
      name: 'peipl-invoice-storage',
      version: 1,
      storage: typeof window !== 'undefined' && window.localStorage ? {
        getItem: (key) => {
          const item = localStorage.getItem(key);
          return item ? JSON.parse(item) : null;
        },
        setItem: (key, value) => {
          localStorage.setItem(key, JSON.stringify(value));
        },
        removeItem: (key) => {
          localStorage.removeItem(key);
        },
      } : undefined,
      migrate: (persistedState, version) => persistedState as InvoiceState,
    }
  )
);
