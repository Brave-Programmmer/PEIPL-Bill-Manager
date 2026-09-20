/**
 * GeM Upload Workflow Store (Zustand)
 * Manages the entire upload session state
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  GeM_UploadSession,
  GeM_UploadHistory,
  GeM_ExtractedInvoiceData,
  GeM_FieldMapping,
  GeM_OrderCard,
  GeM_SavedFieldValue,
  GeM_LoginStatus,
  GeM_BrowserAutomationState,
} from '../utils/gemTypes';

interface GeM_Store {
  // Session Management
  currentSession: GeM_UploadSession | null;
  history: GeM_UploadHistory[];
  savedFieldValues: GeM_SavedFieldValue[];
  loginStatus: GeM_LoginStatus;
  browserState: GeM_BrowserAutomationState;

  // Session Actions
  initializeSession: (invoiceNumber: string) => void;
  updateSessionStatus: (status: GeM_UploadSession['status']) => void;
  setSelectedOrder: (order: GeM_OrderCard) => void;
  setExtractedData: (data: GeM_ExtractedInvoiceData) => void;
  setFieldMappings: (mappings: GeM_FieldMapping[]) => void;
  updateUserDefinedValue: (fieldLabel: string, value: string) => void;
  addSessionLog: (message: string) => void;
  addSessionError: (error: string) => void;
  completeSession: (success: boolean) => void;

  // Login Management
  setLoginStatus: (status: GeM_LoginStatus) => void;
  clearLoginStatus: () => void;

  // Browser State
  setBrowserState: (state: Partial<GeM_BrowserAutomationState>) => void;

  // History Management
  addToHistory: (entry: GeM_UploadHistory) => void;
  clearHistory: () => void;

  // Field Value Memory
  saveFieldValue: (value: GeM_SavedFieldValue) => void;
  getSavedFieldValue: (fieldLabel: string) => GeM_SavedFieldValue | undefined;
  clearFieldValues: () => void;

  // Current Session Management
  resetCurrentSession: () => void;
}

const createDefaultSession = (invoiceNumber: string): GeM_UploadSession => ({
  sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  startTime: Date.now(),
  status: 'login',
  selectedInvoiceNumber: invoiceNumber,
  selectedOrderNumber: '',
  extractedData: null,
  matchedOrder: null,
  fieldMappings: [],
  userDefinedValues: {},
  errors: [],
  logs: ['Session initialized'],
});

const syncSessionToElectronStore = async (session: any, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (typeof window !== 'undefined' && window.electron && window.electron.setStoreValue) {
        await window.electron.setStoreValue('activeGeMSession', session);
        return;
      }
    } catch (err) {
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      } else {
        console.error('Failed to sync GeM session after retries:', err);
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('gem-sync-error', {
            detail: { message: 'Failed to save upload progress. Session recovery may not be possible.' }
          }));
        }
      }
    }
  }
};

export const useGeM_Store = create<GeM_Store>()(
  persist(
    (set, get) => ({
      currentSession: null,
      history: [],
      savedFieldValues: [],
      loginStatus: { isLoggedIn: false },
      browserState: {
        isOpen: false,
        isLoggedIn: false,
        currentUrl: '',
        pageTitle: '',
        connectionMethod: '',
        liveScreenshot: '',
        chromeDebuggingActive: false,
      },

      // Session Actions
      initializeSession: (invoiceNumber: string) => {
        const newSession = createDefaultSession(invoiceNumber);
        set({ currentSession: newSession });
        syncSessionToElectronStore(newSession).catch(err => console.error('Session init sync failed:', err));
      },

      updateSessionStatus: (status: GeM_UploadSession['status']) => {
        set((state) => {
          if (state.currentSession) {
            const updated = {
              ...state.currentSession,
              status,
            };
            syncSessionToElectronStore(updated).catch(err => console.error('Status sync failed:', err));
            return { currentSession: updated };
          }
          return state;
        });
      },

      setSelectedOrder: (order: GeM_OrderCard) => {
        set((state) => {
          if (state.currentSession) {
            const updated = {
              ...state.currentSession,
              selectedOrderNumber: order.contractNumber,
              matchedOrder: order,
            };
            syncSessionToElectronStore(updated).catch(err => console.error('Order sync failed:', err));
            return { currentSession: updated };
          }
          return state;
        });
      },

      setExtractedData: (data: GeM_ExtractedInvoiceData) => {
        set((state) => {
          if (state.currentSession) {
            const updated = {
              ...state.currentSession,
              extractedData: data,
              selectedOrderNumber: data.orderNumber,
            };
            syncSessionToElectronStore(updated).catch(err => console.error('Data sync failed:', err));
            return { currentSession: updated };
          }
          return state;
        });
      },

      setFieldMappings: (mappings: GeM_FieldMapping[]) => {
        set((state) => {
          if (state.currentSession) {
            const updated = {
              ...state.currentSession,
              fieldMappings: mappings,
            };
            syncSessionToElectronStore(updated);
            return { currentSession: updated };
          }
          return state;
        });
      },

      updateUserDefinedValue: (fieldLabel: string, value: string) => {
        set((state) => {
          if (state.currentSession) {
            const updated = {
              ...state.currentSession,
              userDefinedValues: {
                ...state.currentSession.userDefinedValues,
                [fieldLabel]: value,
              },
            };
            syncSessionToElectronStore(updated);
            return { currentSession: updated };
          }
          return state;
        });
      },

      addSessionLog: (message: string) => {
        set((state) => {
          if (state.currentSession) {
            const updated = {
              ...state.currentSession,
              logs: [...state.currentSession.logs, `[${new Date().toLocaleTimeString()}] ${message}`],
            };
            syncSessionToElectronStore(updated);
            return { currentSession: updated };
          }
          return state;
        });
      },

      addSessionError: (error: string) => {
        set((state) => {
          if (state.currentSession) {
            const updated = {
              ...state.currentSession,
              errors: [...state.currentSession.errors, `[${new Date().toLocaleTimeString()}] ${error}`],
            };
            syncSessionToElectronStore(updated);
            return { currentSession: updated };
          }
          return state;
        });
      },

      completeSession: (success: boolean) => {
        set((state) => {
          const session = state.currentSession;
          if (session) {
            const historyEntry: GeM_UploadHistory = {
              id: session.sessionId,
              invoiceNumber: session.selectedInvoiceNumber,
              orderNumber: session.selectedOrderNumber,
              uploadDate: Date.now(),
              status: success ? 'success' : 'failed',
              notes: session.errors.length > 0 ? session.errors[0] : undefined,
            };

            const updated = {
              ...session,
              status: (success ? 'completed' : 'failed') as any,
            };
            syncSessionToElectronStore(updated);

            return {
              history: [historyEntry, ...state.history],
              currentSession: updated,
            };
          }
          return state;
        });
      },

      setLoginStatus: (status: GeM_LoginStatus) => {
        set({ loginStatus: status });
      },

      clearLoginStatus: () => {
        set({ loginStatus: { isLoggedIn: false } });
      },

      setBrowserState: (state: Partial<GeM_BrowserAutomationState>) => {
        set((currentState) => ({
          browserState: { ...currentState.browserState, ...state },
        }));
      },

      addToHistory: (entry: GeM_UploadHistory) => {
        set((state) => ({
          history: [entry, ...state.history],
        }));
      },

      clearHistory: () => {
        set({ history: [] });
      },

      saveFieldValue: (value: GeM_SavedFieldValue) => {
        set((state) => {
          // Remove old value with same label
          const filtered = state.savedFieldValues.filter((v) => v.fieldLabel !== value.fieldLabel);
          return {
            savedFieldValues: [value, ...filtered],
          };
        });
      },

      getSavedFieldValue: (fieldLabel: string) => {
        return get().savedFieldValues.find((v) => v.fieldLabel === fieldLabel);
      },

      clearFieldValues: () => {
        set({ savedFieldValues: [] });
      },

      resetCurrentSession: () => {
        set({ currentSession: null, loginStatus: { isLoggedIn: false } });
        syncSessionToElectronStore(null);
      },
    }),
    {
      name: 'gem-upload-store',
      partialize: (state) => ({
        history: state.history,
        savedFieldValues: state.savedFieldValues,
        loginStatus: state.loginStatus,
      }),
    }
  )
);
