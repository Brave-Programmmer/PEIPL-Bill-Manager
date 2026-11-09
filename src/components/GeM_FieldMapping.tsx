/**
 * GeM Upload — Field Mapping & Auto-Fill Assistant (live multi-page watcher)
 *
 * GeM's invoice flow spans several pages/tabs, each with its own inputs. The
 * old implementation detected fields once and stopped, so anything on the 2nd
 * or 3rd page was never touched.
 *
 * This version runs a continuous watcher:
 *  - Polls the embedded GeM page every couple of seconds.
 *  - Detects newly appearing inputs (new page/step) and fills them immediately.
 *  - Keeps a running, de-duplicated list of every field it has seen.
 *  - Reflects GeM's own state so a field the user fills manually is recognised.
 *  - Never fights the user: each selector is auto-filled at most once.
 *
 * Because GeM pages appear progressively, the user advances through GeM's own
 * pages; the watcher fills each one. "Continue to Review" unlocks once nothing
 * on the currently visible page still needs a value.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle2, Star, Zap, Radar } from 'lucide-react';
import type {
  GeM_FieldMapping,
  GeM_ExtractedInvoiceData,
  GeM_SavedFieldValue,
} from '../utils/gemTypes';
import { useGeM_Store } from '../store/useGeM_Store';

// ── Types ────────────────────────────────────────────────────────────────────

type MappingStatus = 'watching' | 'ready' | 'error';

interface DetectedField {
  label: string;
  name: string;
  selector: string;
  type: string;
  value?: string;
  isRequired?: boolean;
  options?: { value: string; label: string }[];
}

interface GeM_FieldMappingFormProps {
  extractedData: GeM_ExtractedInvoiceData;
  onMappingComplete: (mappings: GeM_FieldMapping[]) => void;
  disabled?: boolean;
}

// How often to re-scan the live GeM page for new inputs.
const POLL_MS = 2000;

// ── Value resolution (pure) ───────────────────────────────────────────────────

interface ResolvedValue {
  value: string;
  mappedFrom?: keyof GeM_ExtractedInvoiceData;
  category: GeM_FieldMapping['category'];
}

/**
 * Decide which invoice value (if any) belongs in a GeM field, based on its
 * label/name/selector. Falls back to a remembered per-field default.
 */
function computeFieldValue(
  field: DetectedField,
  savedValues: GeM_SavedFieldValue[],
  extractedData: GeM_ExtractedInvoiceData,
): ResolvedValue {
  const fieldLabel = field.label || field.name;
  const labelLower = fieldLabel.toLowerCase();
  const nameLower = field.name.toLowerCase();
  const selectorLower = field.selector.toLowerCase();

  if (field.type === 'file') {
    return { value: '', category: 'required' };
  }

  if (
    nameLower.includes('supply_type') ||
    labelLower.includes('supply type') ||
    selectorLower.includes('supply_type')
  ) {
    // Supply Type is always intra-state for these bills.
    return { value: 'Intra State', category: 'auto-filled' };
  }
  if (
    nameLower.includes('place_of_supply_state_ut') ||
    labelLower.includes('place of supply(state') ||
    labelLower.includes('state/ ut code') ||
    labelLower.includes('place of supply state') ||
    selectorLower.includes('place_of_supply_state_ut')
  ) {
    return {
      value: extractedData.placeOfSupplyStateUt || 'Maharashtra / 27',
      mappedFrom: 'placeOfSupplyStateUt',
      category: 'auto-filled',
    };
  }
  if (nameLower.includes('place_of_supply') || labelLower.includes('place of supply')) {
    return {
      value: extractedData.placeOfSupply || 'Buyer Location',
      mappedFrom: 'placeOfSupply',
      category: 'auto-filled',
    };
  }
  if (
    labelLower.includes('invoice') &&
    (labelLower.includes('num') ||
      labelLower.includes('no') ||
      labelLower.includes('id') ||
      labelLower.includes('ref'))
  ) {
    return {
      value: extractedData.invoiceNumber,
      mappedFrom: 'invoiceNumber',
      category: 'auto-filled',
    };
  }
  if (labelLower.includes('invoice') && labelLower.includes('date')) {
    return { value: extractedData.invoiceDate, mappedFrom: 'invoiceDate', category: 'auto-filled' };
  }
  if (labelLower.includes('gst') || labelLower.includes('gstin')) {
    return { value: extractedData.gstNumber, mappedFrom: 'gstNumber', category: 'auto-filled' };
  }
  if (
    labelLower.includes('amount') ||
    labelLower.includes('total') ||
    labelLower.includes('value') ||
    labelLower.includes('price')
  ) {
    return { value: String(extractedData.amount), mappedFrom: 'amount', category: 'auto-filled' };
  }
  if (labelLower.includes('buyer') || labelLower.includes('consignee')) {
    return { value: extractedData.buyerName, mappedFrom: 'buyerName', category: 'auto-filled' };
  }
  if (
    (labelLower.includes('order') ||
      labelLower.includes('contract') ||
      labelLower.includes('po')) &&
    (labelLower.includes('num') ||
      labelLower.includes('no') ||
      labelLower.includes('id') ||
      labelLower.includes('ref'))
  ) {
    return { value: extractedData.orderNumber, mappedFrom: 'orderNumber', category: 'auto-filled' };
  }
  if (
    labelLower.includes('plant') ||
    labelLower.includes('department') ||
    labelLower.includes('ministry') ||
    labelLower.includes('location')
  ) {
    return { value: extractedData.plantName, mappedFrom: 'plantName', category: 'auto-filled' };
  }

  // Fall back to a remembered default answer (if one was saved).
  const saved = savedValues.find((v) => v.fieldLabel === fieldLabel);
  if (saved) {
    return { value: saved.value, category: 'user-defined' };
  }

  return { value: '', category: 'required' };
}

// ── Component ────────────────────────────────────────────────────────────────

export const GeM_FieldMappingForm: React.FC<GeM_FieldMappingFormProps> = ({
  extractedData,
  onMappingComplete,
  disabled = false,
}) => {
  const [status, setStatus] = React.useState<MappingStatus>('watching');
  const [mappings, setMappings] = React.useState<GeM_FieldMapping[]>([]);
  const [visibleSelectors, setVisibleSelectors] = React.useState<string[]>([]);
  const [pageNumber, setPageNumber] = React.useState(1);
  const [scanCount, setScanCount] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [saveError, setSaveError] = React.useState('');
  const [savedFieldValues, setSavedFieldValues] = React.useState<GeM_SavedFieldValue[]>([]);

  const addLog = useGeM_Store((state) => state.addSessionLog);
  const addError = useGeM_Store((state) => state.addSessionError);
  const updateUserValue = useGeM_Store((state) => state.updateUserDefinedValue);
  const setStoreMappings = useGeM_Store((state) => state.setFieldMappings);
  const updateSessionStatus = useGeM_Store((state) => state.updateSessionStatus);

  // ── Refs (read inside the polling loop so it never sees stale state) ───────
  const mappingsRef = React.useRef<GeM_FieldMapping[]>([]);
  const handledRef = React.useRef<Set<string>>(new Set());
  const savedValuesRef = React.useRef<GeM_SavedFieldValue[]>([]);
  const pageSigRef = React.useRef('');
  const pageRef = React.useRef(1);
  const runningRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  const syncMappings = React.useCallback(() => {
    const snapshot = [...mappingsRef.current];
    setMappings(snapshot);
    setStoreMappings(snapshot);
  }, [setStoreMappings]);

  // Load remembered per-field defaults from disk.
  const loadSavedValues = React.useCallback(async (): Promise<GeM_SavedFieldValue[]> => {
    try {
      const result = await window.electron.gemGetSavedFieldValues?.();
      if (result?.success && result?.values) {
        setSavedFieldValues(result.values);
        savedValuesRef.current = result.values;
        return result.values;
      }
    } catch (err) {
      console.error('Failed to load saved field values:', err);
    }
    return [];
  }, []);

  // ── One scan cycle: detect → fill new fields → merge ──────────────────────
  const runScan = React.useCallback(async () => {
    if (runningRef.current || disabled) return;
    runningRef.current = true;

    try {
      const result = await window.electron.gemDetectInvoiceFields();
      if (!mountedRef.current) return;

      if (!result?.success) {
        // Transient failure (page navigating) — keep watching, don't hard-fail.
        return;
      }

      const fields: DetectedField[] = Array.isArray(result.fields) ? result.fields : [];
      const selectors = fields.map((f) => f.selector);
      const signature = selectors.slice().sort().join('|');

      // A change in the visible field set means GeM moved to another page/step.
      if (signature && signature !== pageSigRef.current) {
        if (pageSigRef.current) {
          pageRef.current += 1;
          setPageNumber(pageRef.current);
          addLog(`GeM page ${pageRef.current} detected — ${fields.length} input(s) on screen`);
        }
        pageSigRef.current = signature;
      }

      const bySelector = new Map(
        mappingsRef.current
          .filter((m) => m.gemFieldSelector)
          .map((m) => [m.gemFieldSelector as string, m]),
      );

      let changed = false;

      // 1) Refresh state of fields we already know about.
      for (const field of fields) {
        const existing = bySelector.get(field.selector);
        if (!existing) continue;
        const gemHasValue = (field.value ?? '').trim().length > 0;
        const shouldBeFilled = existing.isFilled || gemHasValue;
        if (existing.isFilled !== shouldBeFilled) {
          existing.isFilled = shouldBeFilled;
          changed = true;
        }
      }

      // 2) Fill fields we have not seen before (i.e. newly appeared ones).
      for (const field of fields) {
        if (bySelector.has(field.selector)) continue;

        const fieldLabel = field.label || field.name;
        const isDropdown = (field.options?.length ?? 0) > 0;
        const gemHasValue = (field.value ?? '').trim().length > 0;
        const { value: mappedValue, mappedFrom, category } = computeFieldValue(
          field,
          savedValuesRef.current,
          extractedData,
        );

        let filled = gemHasValue;

        if (field.type === 'file') {
          // File inputs are attached on the Review step.
          filled = true;
        } else if (mappedValue && !gemHasValue && !handledRef.current.has(field.selector)) {
          handledRef.current.add(field.selector);
          try {
            const fillResult = await window.electron.gemFillField(field.selector, mappedValue);
            if (fillResult?.success) {
              filled = true;
              addLog(`✓ Auto-filled: ${fieldLabel}`);
            } else {
              addLog(`⚠ Could not fill "${fieldLabel}": ${fillResult?.error || 'unknown'}`);
            }
          } catch (fillErr) {
            console.error(`Failed to fill field ${fieldLabel}:`, fillErr);
            addLog(`⚠ Could not fill "${fieldLabel}" on page`);
          }
        }

        const mapping: GeM_FieldMapping = {
          gemFieldLabel: fieldLabel,
          gemFieldSelector: field.selector,
          mappedFrom,
          value: mappedValue || field.value || '',
          category: mappedValue ? category : 'required',
          // A blank dropdown we couldn't map must be chosen by the user.
          isRequired: field.isRequired === true || (isDropdown && !filled),
          isFilled: filled,
          options: isDropdown ? field.options : undefined,
          page: pageRef.current,
        };

        bySelector.set(field.selector, mapping);
        mappingsRef.current = [...mappingsRef.current, mapping];
        changed = true;
      }

      if (changed) syncMappings();
      setVisibleSelectors(selectors);
      setStatus('ready');
      updateSessionStatus('field-mapping');
      setScanCount((c) => c + 1);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Mapping failed';
      setErrorMessage(msg);
      setStatus('error');
      addError(msg);
    } finally {
      runningRef.current = false;
    }
  }, [addLog, addError, disabled, extractedData, syncMappings, updateSessionStatus]);

  // ── Start / stop the continuous watcher ───────────────────────────────────
  React.useEffect(() => {
    mountedRef.current = true;

    void (async () => {
      await loadSavedValues();
      if (mountedRef.current) addLog('Watching GeM for form fields across all pages…');
      void runScan();
    })();

    const interval = window.setInterval(() => {
      void runScan();
    }, POLL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [addLog, loadSavedValues, runScan]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const visibleSet = React.useMemo(() => new Set(visibleSelectors), [visibleSelectors]);

  const visibleMappings = React.useMemo(
    () => mappings.filter((m) => m.gemFieldSelector && visibleSet.has(m.gemFieldSelector)),
    [mappings, visibleSet],
  );

  // Required fields that are still blank on the page currently on screen.
  const unfilledVisible = React.useMemo(
    () => visibleMappings.filter((m) => m.isRequired && !m.isFilled),
    [visibleMappings],
  );

  const filledCount = React.useMemo(() => mappings.filter((m) => m.isFilled).length, [mappings]);

  // Show fields needing attention first, then the rest.
  const orderedMappings = React.useMemo(
    () =>
      [...mappings].sort((a, b) => {
        if (a.isFilled === b.isFilled) return 0;
        return a.isFilled ? 1 : -1;
      }),
    [mappings],
  );

  // ── User edits ────────────────────────────────────────────────────────────

  const pushFieldToGeM = React.useCallback(
    async (mapping: GeM_FieldMapping, value: string) => {
      if (!mapping.gemFieldSelector || !value) return false;
      try {
        const result = await window.electron.gemFillField(mapping.gemFieldSelector, value);
        if (result?.success) {
          addLog(`✓ Pushed to GeM: ${mapping.gemFieldLabel}`);
          return true;
        }
        addLog(`⚠ Failed to push "${mapping.gemFieldLabel}": ${result?.error || 'unknown'}`);
        return false;
      } catch (err) {
        addLog(`⚠ Failed to push "${mapping.gemFieldLabel}" to GeM`);
        console.error(err);
        return false;
      }
    },
    [addLog],
  );

  const setMappingById = React.useCallback(
    (selector: string | undefined, patch: Partial<GeM_FieldMapping>) => {
      if (!selector) return;
      mappingsRef.current = mappingsRef.current.map((m) =>
        m.gemFieldSelector === selector ? { ...m, ...patch } : m,
      );
      syncMappings();
    },
    [syncMappings],
  );

  const handleUpdateFieldValue = (mapping: GeM_FieldMapping, value: string) => {
    setMappingById(mapping.gemFieldSelector, {
      value,
      isFilled: false,
      category: 'user-defined',
    });
    updateUserValue(mapping.gemFieldLabel, value);
  };

  const handlePushField = async (mapping: GeM_FieldMapping) => {
    if (!mapping.value) return;
    const ok = await pushFieldToGeM(mapping, mapping.value);
    setMappingById(mapping.gemFieldSelector, { isFilled: ok, category: 'user-defined' });
  };

  // When the user picks an option, push it straight to GeM.
  const handleSelectOption = async (mapping: GeM_FieldMapping, value: string) => {
    handleUpdateFieldValue(mapping, value);
    if (!value) return;
    const ok = await pushFieldToGeM(mapping, value);
    setMappingById(mapping.gemFieldSelector, {
      value,
      isFilled: ok,
      category: 'user-defined',
    });
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
        savedValuesRef.current = [
          savedValue,
          ...savedValuesRef.current.filter((v) => v.fieldLabel !== fieldLabel),
        ];
        setSavedFieldValues((prev) => [
          savedValue,
          ...prev.filter((v) => v.fieldLabel !== fieldLabel),
        ]);
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
    if (unfilledVisible.length > 0) return;
    onMappingComplete([...mappingsRef.current]);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const watching = status === 'watching' || status === 'ready';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header / live status */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Step 4 · Auto-Fill GeM Fields
          </h3>
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Radar className="w-3.5 h-3.5 animate-pulse" aria-hidden />
            Live
          </span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Move through GeM&apos;s pages as you normally would — new inputs are found and filled
          automatically (page <span className="font-medium">{pageNumber}</span>, scan {scanCount}).
        </p>

        {/* Summary chips */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
            {filledCount} filled
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
              unfilledVisible.length > 0
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" aria-hidden />
            {unfilledVisible.length} need input
          </span>
          {watching && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-slate-500 dark:text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              Scanning…
            </span>
          )}
        </div>
      </div>

      {/* Field list */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-5">
        {mappings.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400 py-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            Waiting for the GeM form to appear…
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {orderedMappings.map((mapping) => {
              const isDropdown = (mapping.options?.length ?? 0) > 0;
              const hasDefault = savedFieldValues.some(
                (v) => v.fieldLabel === mapping.gemFieldLabel,
              );
              return (
                <div
                  key={mapping.gemFieldSelector || mapping.gemFieldLabel}
                  className={`p-3 rounded-lg border ${
                    mapping.isFilled
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                      : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white text-sm truncate">
                          {mapping.gemFieldLabel}
                        </span>
                        {mapping.page && mapping.page > 1 && (
                          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300">
                            p{mapping.page}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {mapping.category === 'auto-filled' && (
                          <span className="text-xs text-green-700 dark:text-green-300">
                            Auto: {mapping.mappedFrom}
                          </span>
                        )}
                        {hasDefault && (
                          <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                            <Star className="w-3 h-3 fill-current" aria-hidden />
                            Default
                          </span>
                        )}
                      </div>
                    </div>
                    {mapping.isFilled && (
                      <CheckCircle2
                        className="w-4 h-4 text-green-600 shrink-0 mt-0.5"
                        aria-label="Filled"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isDropdown ? (
                      <select
                        value={mapping.value ?? ''}
                        onChange={(e) => handleSelectOption(mapping, e.target.value)}
                        disabled={disabled}
                        aria-label={mapping.gemFieldLabel}
                        className="flex-1 min-w-0 px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        <option value="">— Select —</option>
                        {mapping.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={mapping.value ?? ''}
                        onChange={(e) => handleUpdateFieldValue(mapping, e.target.value)}
                        disabled={disabled}
                        placeholder={mapping.mappedFrom ? `From: ${mapping.mappedFrom}` : 'Enter value…'}
                        aria-label={mapping.gemFieldLabel}
                        className="flex-1 min-w-0 px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-1.5">
                    {mapping.value && mapping.gemFieldSelector && !mapping.isFilled && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handlePushField(mapping)}
                        className="text-xs text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                      >
                        <Zap className="w-3 h-3" aria-hidden />
                        Push to GeM
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={disabled || !mapping.value}
                      onClick={() =>
                        mapping.value &&
                        handleSaveFieldMapping(mapping.gemFieldLabel, mapping.value)
                      }
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                    >
                      <Star className="w-3 h-3" aria-hidden />
                      {hasDefault ? 'Update default' : 'Set as default'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {saveError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{saveError}</p>}

        {status === 'error' && errorMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded mt-4"
          >
            <div className="text-sm font-medium text-red-900 dark:text-red-100 mb-1">Error</div>
            <div className="text-xs text-red-800 dark:text-red-200">{errorMessage}</div>
          </motion.div>
        )}
      </div>

      {/* Action */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {unfilledVisible.length > 0
            ? `${unfilledVisible.length} field${
                unfilledVisible.length !== 1 ? 's' : ''
              } on this page still need a value.`
            : 'Everything on this page is filled — continue when you reach the last GeM page.'}
        </p>
        <button
          type="button"
          onClick={handleCompleteMapping}
          disabled={disabled || mappings.length === 0 || unfilledVisible.length > 0}
          className="shrink-0 px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Continue to Review
        </button>
      </div>
    </motion.div>
  );
};
