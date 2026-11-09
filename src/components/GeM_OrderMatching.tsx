/**
 * GeM Upload - Step 3 & 4: Order Matching Component
 *
 * Process flow: process order → verify page → generate invoice
 * (verify-before-process was wrong — browser is still on the orders list).
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle2, Search, RefreshCw } from 'lucide-react';
import type { GeM_OrderCard, GeM_ExtractedInvoiceData } from '../utils/gemTypes';
import { useGeM_Store } from '../store/useGeM_Store';
import { useDisplayName } from '../utils/userProfile';

interface GeM_OrderMatchingProps {
  extractedData: GeM_ExtractedInvoiceData;
  onOrderMatched: (order: GeM_OrderCard) => void;
  onNext?: () => void;
  disabled?: boolean;
}

export const GeM_OrderMatching: React.FC<GeM_OrderMatchingProps> = ({
  extractedData,
  onOrderMatched,
  disabled = false,
}) => {
  const displayName = useDisplayName();
  const [status, setStatus] = React.useState<'idle' | 'navigating' | 'loading' | 'matching' | 'matched' | 'processing' | 'error'>(
    'idle'
  );
  const [orders, setOrders] = React.useState<GeM_OrderCard[]>([]);
  const [matchedOrder, setMatchedOrder] = React.useState<GeM_OrderCard | null>(null);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const autoStartedRef = React.useRef(false);

  const filteredOrders = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return orders;
    return orders.filter(
      (order) =>
        order.contractNumber.toLowerCase().includes(query) ||
        order.buyerName.toLowerCase().includes(query),
    );
  }, [orders, searchQuery]);

  const addLog = useGeM_Store((state) => state.addSessionLog);
  const addError = useGeM_Store((state) => state.addSessionError);
  const setSelectedOrder = useGeM_Store((state) => state.setSelectedOrder);
  const updateStatus = useGeM_Store((state) => state.updateSessionStatus);

  const handleFindMatchingOrder = React.useCallback(async () => {
    addLog(`Searching for order: ${extractedData.orderNumber}`);
    setStatus('matching');

    try {
      const result = await window.electron.gemFindMatchingOrder(extractedData.orderNumber);

      if (result.success && result.order) {
        addLog(`✓ Matched order found: ${result.order.contractNumber}`);
        setMatchedOrder(result.order);
        setSelectedOrder(result.order);
        setStatus('matched');
        updateStatus('order-search');
      } else {
        const error = result.error || 'No matching order found';
        setErrorMessage(error);
        setStatus('error');
        addError(error);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      setStatus('error');
      addError(errorMsg);
    }
  }, [addError, addLog, extractedData.orderNumber, setSelectedOrder, updateStatus]);

  const handleExtractOrders = React.useCallback(async () => {
    setStatus('loading');
    addLog('Extracting orders from page...');

    try {
      const result = await window.electron.gemExtractAllOrders();

      if (result.success && result.orders) {
        if (result.orders.length === 0) {
          const error =
            'No order panels found on the GeM page. The page layout may have changed — try Refresh, or open Orders manually in the browser.';
          setErrorMessage(error);
          setStatus('error');
          addError(error);
          return;
        }

        addLog(`Found ${result.orders.length} orders`);
        setOrders(result.orders);
        setStatus('matching');
        await handleFindMatchingOrder();
      } else {
        const error = result.error || 'Failed to extract orders';
        setErrorMessage(error);
        setStatus('error');
        addError(error);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      setStatus('error');
      addError(errorMsg);
    }
  }, [addError, addLog, handleFindMatchingOrder]);

  const handleNavigateToOrders = React.useCallback(async () => {
    setStatus('navigating');
    setErrorMessage('');
    addLog('Navigating to GeM orders page...');

    try {
      const result = await window.electron.gemNavigateToOrders();

      if (result.success) {
        addLog('Successfully navigated to orders page');
        await handleExtractOrders();
      } else {
        const error = result.error || 'Failed to navigate to orders';
        setErrorMessage(error);
        setStatus('error');
        addError(error);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      setStatus('error');
      addError(errorMsg);
    }
  }, [addError, addLog, handleExtractOrders]);

  // Auto-start order search once when this step mounts
  React.useEffect(() => {
    if (autoStartedRef.current || disabled) return;
    autoStartedRef.current = true;
    void handleNavigateToOrders();
  }, [disabled, handleNavigateToOrders]);

  const handleManualOrderSelect = (order: GeM_OrderCard) => {
    addLog(`Manually selected order: ${order.contractNumber}`);
    setMatchedOrder(order);
    setSelectedOrder(order);
    setStatus('matched');
    updateStatus('order-search');
    setErrorMessage('');
  };

  const handleVerifyAndProcess = React.useCallback(async () => {
    if (!matchedOrder) return;

    setStatus('processing');
    setErrorMessage('');

    try {
      // 1) Process first (opens the order) — browser is still on the list before this
      addLog('Processing order...');
      const processResult = await window.electron.gemProcessOrder(matchedOrder);

      if (!processResult.success) {
        const error = processResult.error || 'Failed to process order';
        setErrorMessage(error);
        setStatus('error');
        addError(error);
        return;
      }
      addLog('✓ Order processed successfully');

      // 2) Verify we're on the right order detail page
      addLog('Verifying order page...');
      const verifyResult = await window.electron.gemVerifyOrderPage(matchedOrder.contractNumber);
      if (!verifyResult.success) {
        const error = verifyResult.error || 'Order verification failed';
        setErrorMessage(error);
        setStatus('error');
        addError(error);
        return;
      }
      addLog('Order verification successful');

      // 3) Open invoice form
      const invoiceResult = await window.electron.gemClickGenerateInvoice();
      if (!invoiceResult.success) {
        const error = invoiceResult.error || 'Failed to open invoice form';
        setErrorMessage(error);
        setStatus('error');
        addError(error);
        return;
      }
      addLog('✓ Invoice form opened');
      onOrderMatched(matchedOrder);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      setStatus('error');
      addError(errorMsg);
    }
  }, [matchedOrder, addLog, addError, onOrderMatched]);

  // Agentic run: once an order is matched, automatically process it, verify the
  // page, and open the invoice form — no manual "Process Order" click needed.
  const autoProcessedRef = React.useRef(false);
  React.useEffect(() => {
    if (status !== 'matched' || !matchedOrder || autoProcessedRef.current || disabled) return;
    autoProcessedRef.current = true;
    void handleVerifyAndProcess();
  }, [status, matchedOrder, disabled, handleVerifyAndProcess]);

  const handleRetry = () => {
    setStatus('idle');
    setErrorMessage('');
    setOrders([]);
    setMatchedOrder(null);
    autoProcessedRef.current = false;
    autoStartedRef.current = false;
    void handleNavigateToOrders();
    autoStartedRef.current = true;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-white">
          Step 3: Find & Match Order
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Searching for order {extractedData.orderNumber}, then opening the invoice form.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          {status === 'idle' && <Search className="w-5 h-5 text-slate-400" />}
          {(status === 'navigating' || status === 'loading' || status === 'matching' || status === 'processing') && (
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          )}
          {status === 'matched' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
          {status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}

          <span className="font-medium text-slate-900 dark:text-white">
            {status === 'idle' && 'Ready to find order'}
            {status === 'navigating' && `${displayName}, navigating to orders...`}
            {status === 'loading' && `${displayName}, loading orders...`}
            {status === 'matching' && `${displayName}, searching for a matching order...`}
            {status === 'matched' && 'Order found and ready!'}
            {status === 'processing' && `${displayName}, opening invoice form...`}
            {status === 'error' && 'Error finding order'}
          </span>
        </div>

        {matchedOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Contract Number</div>
                <div className="text-sm font-semibold text-green-900 dark:text-green-100">
                  {matchedOrder.contractNumber}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Status</div>
                <div className="text-sm font-semibold text-green-900 dark:text-green-100">
                  {matchedOrder.status}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Buyer</div>
                <div className="text-sm text-green-900 dark:text-green-100">{matchedOrder.buyerName}</div>
              </div>
            </div>
          </motion.div>
        )}

        {orders.length > 0 && !matchedOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4"
          >
            <div className="mb-3">
              <input
                type="text"
                placeholder="Search orders by contract number or buyer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {filteredOrders.map((order) => (
                <div
                  key={order.contractNumber}
                  onClick={() => handleManualOrderSelect(order)}
                  className="p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition-colors"
                >
                  <div className="font-medium text-slate-900 dark:text-white">{order.contractNumber}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{order.buyerName}</div>
                </div>
              ))}

              {filteredOrders.length === 0 && searchQuery && (
                <div className="text-center py-4 text-slate-500 dark:text-slate-400 text-sm">
                  No orders found matching your search
                </div>
              )}
            </div>
          </motion.div>
        )}

        {status === 'error' && errorMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded"
          >
            <div className="text-sm font-medium text-red-900 dark:text-red-100 mb-1">Error:</div>
            <div className="text-xs text-red-800 dark:text-red-200">{errorMessage}</div>
          </motion.div>
        )}
      </div>

      <div className="flex gap-3 justify-end">
        {status === 'idle' && (
          <button
            onClick={handleNavigateToOrders}
            disabled={disabled}
            className="px-6 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer"
          >
            Start Order Search
          </button>
        )}

        {status === 'matched' && (
          <button
            onClick={handleVerifyAndProcess}
            disabled={disabled}
            className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            Process Order & Open Invoice
          </button>
        )}

        {status === 'error' && (
          <button
            onClick={handleRetry}
            disabled={disabled}
            className="px-6 py-2 rounded-lg font-medium border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        )}
      </div>
    </motion.div>
  );
};
