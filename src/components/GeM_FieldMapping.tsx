/**
 * GeM Upload — Field Mapping & Auto-Fill Assistant Component
 *
 * Fixed:
 *  - handleAutoFillFields is now properly awaited so status never gets stuck
 *    on 'mapping' and errors are caught and surfaced correctly.
 *  - Error recovery added around handleAutoFillFields; if it throws, status
 *    transitions to 'error' instead of hanging.
 *  - handleCompleteMapping no longer calls onNext() — navigation is the
 *    parent's responsibility via onMappingComplete. onNext prop removed.
 *  - Input values seed from mapping.value instead of userValues so auto-filled
 *    fields display their values immediately on render.
 *  - Dead `fields` state removed; detected fields are passed directly.
 *  - `unfilled` wrapped in useMemo to avoid recomputation on every render.
 *  - `disabled` prop applied to ALL action buttons, not just the first one.
 *  - Save-field error is surfaced as a small inline notice.
 *  - getSavedFieldValue is called once per field, not via a store selector
 *    inside a loop, avoiding stale closure issues.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle2, Save, Zap } from 'lucide-react';
import type {
  GeM_FieldMapping,
  GeM_ExtractedInvoiceData,
  GeM_SavedFieldValue,
} from '../utils/gemTypes';
import { useGeM_Store } from '../store/useGeM_Store';

// ── Types ────────────────────────────────────────────────────────────────────

type MappingStatus = 'idle' | 'detecting' | 'mapping' | 'ready' | 'error';

interface DetectedField {
  label: string;
  name: string;
  selector: string;
  type: string;
  value?: string;
}

interface GeM_FieldMappingFormProps {
  extractedData: GeM_ExtractedInvoiceData;
  onMappingComplete: (mappings: GeM_FieldMapping[]) => void;
  disabled?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export const GeM_FieldMappingForm: React.FC<GeM_FieldMappingFormProps> = ({
  extractedData,
  onMappingComplete,
  disabled = false,
}) => {
  const [status, setStatus] = React.useState<MappingStatus>('idle');
  const [mappings, setMappings] = React.useState<GeM_FieldMapping[]>([]);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [saveError, setSaveError] = React.useState('');
  const [savedFieldValues, setSavedFieldValues] = React.useState<GeM_SavedFieldValue[]>([]);

  const addLog = useGeM_Store((state) => state.addSessionLog);
  const addError = useGeM_Store((state) => state.addSessionError);
  const updateUserValue = useGeM_Store((state) => state.updateUserDefinedValue);
  const setStoreMappings = useGeM_Store((state) => state.setFieldMappings);
  const updateStatus = useGeM_Store((state) => state.updateSessionStatus);

  // Load saved field values once on mount (simple, no caching)
  React.useEffect(() => {
    const loadSavedValues = async () => {
      try {
        const result = await window.electron.gemGetSavedFieldValues?.();
        if (result?.success && result?.values) {
          setSavedFieldValues(result.values);
        }
      } catch (err) {
        console.error('Failed to load saved field values:', err);
      }
    };
    loadSavedValues();
  }, []);

  // Memoised so the two conditional renders below don't recompute every tick
  const unfilled = React.useMemo(
    () => mappings.filter((m) => !m.isFilled),
    [mappings],
  );

  // ── Field detection ───────────────────────────────────────────────────────

  const handleDetectFields = async () => {
    setStatus('detecting');
    setErrorMessage('');
    addLog('Detecting invoice form fields...');

    try {
      const result = await window.electron.gemDetectInvoiceFields();

      if (!result.success || !result.fields) {
        const error = result.error || 'Failed to detect fields';
        setErrorMessage(error);
        setStatus('error');
        addError(error);
        return;
      }

      addLog(`Found ${result.fields.length} form fields`);
      setStatus('mapping');

      // Await the fill pass so status transitions happen in order
      await handleAutoFillFields(result.fields);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMessage(msg);
      setStatus('error');
      addError(msg);
    }
  };

  // ── Auto-fill pass ────────────────────────────────────────────────────────

  const handleAutoFillFields = async (detectedFields: DetectedField[]) => {
    const newMappings: GeM_FieldMapping[] = [];

    try {
      for (const field of detectedFields) {
        const fieldLabel = field.label || field.name;
        const labelLower = fieldLabel.toLowerCase();
        const nameLower = field.name.toLowerCase();
        const selectorLower = field.selector.toLowerCase();

        let mappedValue = '';
        let mappedFrom: keyof GeM_ExtractedInvoiceData | undefined;
        let category: GeM_FieldMapping['category'] = 'required';

        // Smart mapping — ordered from most-specific to least-specific
        if (
          nameLower.includes('place_of_supply_state_ut') ||
          labelLower.includes('place of supply(state') ||
          labelLower.includes('state/ ut code') ||
          labelLower.includes('place of supply state') ||
          selectorLower.includes('place_of_supply_state_ut')
        ) {
          mappedValue = 'Maharashtra / 27';
          mappedFrom = 'placeOfSupplyStateUt';
          category = 'auto-filled';
        } else if (
          nameLower.includes('place_of_supply') ||
          labelLower.includes('place of supply')
        ) {
          mappedValue = 'Buyer Location';
          mappedFrom = 'placeOfSupply';
          category = 'auto-filled';
        } else if (
          labelLower.includes('invoice') && 
          (labelLower.includes('num') || labelLower.includes('no') || labelLower.includes('id') || labelLower.includes('ref'))
        ) {
          mappedValue = extractedData.invoiceNumber;
          mappedFrom = 'invoiceNumber';
          category = 'auto-filled';
        } else if (labelLower.includes('invoice') && labelLower.includes('date')) {
          mappedValue = extractedData.invoiceDate;
          mappedFrom = 'invoiceDate';
          category = 'auto-filled';
        } else if (labelLower.includes('gst') || labelLower.includes('gstin')) {
          mappedValue = extractedData.gstNumber;
          mappedFrom = 'gstNumber';
          category = 'auto-filled';
        } else if (
          labelLower.includes('amount') || 
          labelLower.includes('total') || 
          labelLower.includes('value') || 
          labelLower.includes('price')
        ) {
          mappedValue = String(extractedData.amount);
          mappedFrom = 'amount';
          category = 'auto-filled';
        } else if (labelLower.includes('buyer') || labelLower.includes('consignee')) {
          mappedValue = extractedData.buyerName;
          mappedFrom = 'buyerName';
          category = 'auto-filled';
        } else if (
          (labelLower.includes('order') || labelLower.includes('contract') || labelLower.includes('po')) && 
          (labelLower.includes('num') || labelLower.includes('no') || labelLower.includes('id') || labelLower.includes('ref'))
        ) {
          mappedValue = extractedData.orderNumber;
          mappedFrom = 'orderNumber';
          category = 'auto-filled';
        } else if (
          labelLower.includes('plant') || 
          labelLower.includes('department') || 
          labelLower.includes('ministry') || 
          labelLower.includes('location')
        ) {
          mappedValue = extractedData.plantName;
          mappedFrom = 'plantName';
          category = 'auto-filled';
        } else {
          // Fall back to saved values
          const saved = savedFieldValues.find((v) => v.fieldLabel === fieldLabel);
          if (saved) {
            mappedValue = saved.value;
            category = 'user-defined';
          }
        }

        // Try to fill the field in the browser — log but don't abort on failure
        if (mappedValue) {
          try {
            await window.electron.gemFillField(field.selector, mappedValue);
            addLog(`✓ Auto-filled: ${fieldLabel}`);
          } catch (fillErr) {
            addLog(`⚠ Could not fill field "${fieldLabel}" on page`);
            console.error(`Failed to fill field ${fieldLabel}:`, fillErr);
          }
        }

        newMappings.push({
          gemFieldLabel: fieldLabel,
          gemFieldSelector: field.selector,
          mappedFrom,
          value: mappedValue,
          category,
          isRequired: true,
          isFilled: !!mappedValue,
        });
      }

      setMappings(newMappings);
      setStoreMappings(newMappings);
      setStatus('ready');
      updateStatus('field-mapping');
      addLog(
        `Mapped ${newMappings.filter((m) => m.isFilled).length}/${newMappings.length} fields`,
      );
    } catch (err) {
      // Catch anything that slipped through the per-field try/catch above
      const msg = err instanceof Error ? err.message : 'Mapping failed';
      setErrorMessage(msg);
      setStatus('error');
      addError(msg);
    }
  };

  // ── User edits ────────────────────────────────────────────────────────────

  const handleUpdateFieldValue = (fieldLabel: string, value: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.gemFieldLabel === fieldLabel
          ? { ...m, value, isFilled: !!value, category: 'user-defined' }
          : m,
      ),
    );
    updateUserValue(fieldLabel, value);
  };

  const handleSaveFieldMapping = async (fieldLabel: string, value: string) => {
    setSaveError('');
    const savedValue: GeM_SavedFieldValue = {
      fieldLabel,
      value,
      category: 'custom',
      timestamp: Date.now(),
    };

    try {
      const result = await window.electron.gemSaveFieldValue?.(savedValue);
      if (result?.success) {
        setSavedFieldValues((prev) =>
          [savedValue, ...prev.filter((v) => v.fieldLabel !== fieldLabel)]
        );
        addLog(`Saved field mapping: ${fieldLabel}`);
      } else {
        setSaveError(`Could not save "${fieldLabel}"`);
      }
    } catch (err) {
      setSaveError(`Could not save "${fieldLabel}"`);
      console.error('Failed to save field value:', err);
    }
  };

  // ── Completion ────────────────────────────────────────────────────────────

  const handleCompleteMapping = () => {
    if (unfilled.length > 0) return;
    // Navigation is the parent's responsibility — only call onMappingComplete.
    onMappingComplete(mappings);
  };

  const handleRetry = () => {
    setStatus('idle');
    setErrorMessage('');
    setMappings([]);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Step header */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-white">
          Step 4: Smart Field Mapping
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          We'll automatically detect form fields and fill them with invoice data.
          Complete any remaining fields manually before continuing.
        </p>
      </div>

      {/* Status + field list */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">

        {/* Status row */}
        <div className="flex items-center gap-3 mb-4">
          {status === 'idle' && <Zap className="w-5 h-5 text-slate-400" aria-hidden />}
          {(status === 'detecting' || status === 'mapping') && (
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" aria-hidden />
          )}
          {status === 'ready' && (
            <CheckCircle2 className="w-5 h-5 text-green-500" aria-hidden />
          )}
          {status === 'error' && (
            <AlertCircle className="w-5 h-5 text-red-500" aria-hidden />
          )}

          <span className="font-medium text-slate-900 dark:text-white">
            {status === 'idle' && 'Ready to detect fields'}
            {status === 'detecting' && 'Detecting form fields…'}
            {status === 'mapping' && 'Mapping fields…'}
            {status === 'ready' &&
              `${mappings.filter((m) => m.isFilled).length}/${mappings.length} fields filled`}
            {status === 'error' && 'Error mapping fields'}
          </span>
        </div>

        {/* Field list */}
        {mappings.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3 max-h-96 overflow-y-auto"
          >
            {mappings.map((mapping) => (
              <div
                key={mapping.gemFieldLabel}
                className={`p-4 rounded-lg border ${
                  mapping.isFilled
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <div className="font-medium text-slate-900 dark:text-white text-sm">
                      {mapping.gemFieldLabel}
                    </div>
                    {mapping.category === 'auto-filled' && (
                      <div className="text-xs text-green-700 dark:text-green-300 mt-1">
                        Auto-filled from: {mapping.mappedFrom}
                      </div>
                    )}
                  </div>
                  {mapping.isFilled && (
                    <CheckCircle2
                      className="w-5 h-5 text-green-600 shrink-0"
                      aria-label="Filled"
                    />
                  )}
                </div>

                <input
                  type="text"
                  // Seed from mapping.value so auto-filled values appear immediately
                  value={mapping.value}
                  onChange={(e) =>
                    handleUpdateFieldValue(mapping.gemFieldLabel, e.target.value)
                  }
                  disabled={disabled}
                  placeholder={
                    mapping.mappedFrom ? `From: ${mapping.mappedFrom}` : 'Enter value…'
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />

                {mapping.isFilled && mapping.category !== 'auto-filled' && (
                  <button
                    type="button"
                    disabled={disabled || !mapping.value}
                    onClick={() =>
                      mapping.value && handleSaveFieldMapping(mapping.gemFieldLabel, mapping.value)
                    }
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 disabled:opacity-50"
                  >
                    <Save className="w-3 h-3" aria-hidden />
                    Save for next time
                  </button>
                )}
              </div>
            ))}
          </motion.div>
        )}

        {/* Save error */}
        {saveError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{saveError}</p>
        )}

        {/* Detection / fill error */}
        {status === 'error' && errorMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded mt-4"
          >
            <div className="text-sm font-medium text-red-900 dark:text-red-100 mb-1">
              Error
            </div>
            <div className="text-xs text-red-800 dark:text-red-200">{errorMessage}</div>
          </motion.div>
        )}

        {/* Unfilled warning */}
        {status === 'ready' && unfilled.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded"
          >
            <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
              {unfilled.length} field{unfilled.length !== 1 ? 's' : ''} still need values
            </div>
          </motion.div>
        )}

        {/* All good */}
        {status === 'ready' && unfilled.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded"
          >
            <div className="text-sm font-medium text-green-900 dark:text-green-100">
              ✓ All fields are ready!
            </div>
          </motion.div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 justify-end">
        {status === 'idle' && (
          <button
            type="button"
            onClick={handleDetectFields}
            disabled={disabled}
            className="px-6 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Zap className="w-4 h-4" aria-hidden />
            Detect &amp; Map Fields
          </button>
        )}

        {status === 'ready' && (
          <>
            <button
              type="button"
              onClick={handleRetry}
              disabled={disabled}
              className="px-6 py-2 rounded-lg font-medium border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Re-detect
            </button>
            <button
              type="button"
              onClick={handleCompleteMapping}
              disabled={disabled || unfilled.length > 0}
              className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Continue to Review
            </button>
          </>
        )}

        {status === 'error' && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={disabled}
            className="px-6 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            Try Again
          </button>
        )}
      </div>
    </motion.div>
  );
};