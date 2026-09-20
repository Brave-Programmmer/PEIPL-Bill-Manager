/**
 * GeM Upload - Step 3 & 4: Order Matching Component
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import type { GeM_OrderCard, GeM_ExtractedInvoiceData } from '../utils/gemTypes';
import { useGeM_Store } from '../store/useGeM_Store';
import { useDisplayName } from '../utils/userProfile';

interface GeM_OrderMatchingProps {
  extractedData: GeM_ExtractedInvoiceData;
  onOrderMatched: (order: GeM_OrderCard) => void;
  onNext: () => void;
  disabled?: boolean;
}

export const GeM_OrderMatching: React.FC<GeM_OrderMatchingProps> = ({
  extractedData,
  onOrderMatched,
  onNext,
  disabled = false,
}) => {
  const displayName = useDisplayName();
  const [status, setStatus] = React.useState<'idle' | 'navigating' | 'loading' | 'matching' | 'matched' | 'error'>(
    'idle'
  );
  const [orders, setOrders] = React.useState<GeM_OrderCard[]>([]);
  const [matchedOrder, setMatchedOrder] = React.useState<GeM_OrderCard | null>(null);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
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

  const handleNavigateToOrders = async () => {
    setStatus('navigating');
    setErrorMessage('');
    addLog('Navigating to GeM orders page...');

    try {
      const result = await window.electron.gemNavigateToOrders();

      if (result.success) {
        addLog('Successfully navigated to orders page');
        setStatus('loading');
        handleExtractOrders();
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
  };

  const handleExtractOrders = async () => {
    setStatus('loading');
    addLog('Extracting orders from page...');

    try {
      const result = await window.electron.gemExtractAllOrders();

      if (result.success && result.orders) {
        addLog(`Found ${result.orders.length} orders`);
        setOrders(result.orders);
        setStatus('matching');
        handleFindMatchingOrder();
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
  };

  const handleFindMatchingOrder = async () => {
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
  };

  const handleManualOrderSelect = (order: GeM_OrderCard) => {
    addLog(`Manually selected order: ${order.contractNumber}`);
    setMatchedOrder(order);
    setSelectedOrder(order);
    setStatus('matched');
    updateStatus('order-search');
    setErrorMessage('');
  };

  const handleVerifyAndProcess = async () => {
    if (!matchedOrder) return;

    addLog(`Verifying order page...`);
    setStatus('loading');

    try {
      // Verify order page
      const verifyResult = await window.electron.gemVerifyOrderPage(matchedOrder.contractNumber);

      if (!verifyResult.success) {
        const error = verifyResult.error || 'Order verification failed';
        setErrorMessage(error);
        setStatus('error');
        addError(error);
        return;
      }

      addLog('Order verification successful');

      // Process order
      addLog('Processing order...');
      const processResult = await window.electron.gemProcessOrder(matchedOrder);

      if (processResult.success) {
        addLog('✓ Order processed successfully');
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
        onNext();
      } else {
        const error = processResult.error || 'Failed to process order';
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
  };

  const handleRetry = () => {
    setStatus('idle');
    setErrorMessage('');
    setOrders([]);
    setMatchedOrder(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Step Title */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-white">
          Step 3: Find & Match Order
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          We'll search for the matching order ({extractedData.orderNumber}) and open it for invoice upload.
        </p>
      </div>

      {/* Status Indicator */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          {status === 'idle' && <Search className="w-5 h-5 text-slate-400" />}
          {(status === 'navigating' || status === 'loading' || status === 'matching') && (
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
            {status === 'error' && 'Error finding order'}
          </span>
        </div>

        {/* Current Order Info */}
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

        {/* Orders List */}
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

        {/* Error Message */}
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

      {/* Action Buttons */}
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
            className="px-6 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 transition-colors cursor-pointer"
          >
            Process Order
          </button>
        )}

        {status === 'error' && (
          <>
            <button
              onClick={handleRetry}
              className="px-6 py-2 rounded-lg font-medium border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
};
