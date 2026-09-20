/**
 * GeM Automated Invoice Upload Page
 * Main workflow orchestrator
 *
 * Fixed:
 *  - handleBack no longer clears selectedInvoiceData (which blinded the login
 *    step render guard); instead it clears only the state owned by the step
 *    being *entered* (i.e. the state produced by the step we're going back from).
 *  - goToStep uses a ref for currentStepIndex so the callback is stable across
 *    renders and doesn't cause unnecessary child re-renders.
 *  - All step-callback handlers are wrapped in useCallback for referential
 *    stability.
 *  - onNext no-op props removed; child components receive the real callbacks
 *    via their primary props (onOrderMatched / onMappingComplete).
 *  - direction cast is explicit to satisfy strict TypeScript configs.
 *  - Dead/misleading comments removed.
 *  - handleBack state-clear order fixed: state is reset after goToStep so
 *    the render gate never sees an inconsistent (wrong step + cleared data).
 */

import React from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import type {
  GeM_ExtractedInvoiceData,
  GeM_OrderCard,
  GeM_FieldMapping,
} from "../utils/gemTypes";
import { GeM_InvoiceSelection } from "../components/GeM_InvoiceSelection";
import { GeM_LoginAssistant } from "../components/GeM_LoginAssistant";
import { GeM_OrderMatching } from "../components/GeM_OrderMatching";
import { GeM_FieldMappingForm } from "../components/GeM_FieldMapping";
import { GeM_ReviewScreen, GeM_Completion } from "../components/GeM_Review";
import { useGeM_Store } from "../store/useGeM_Store";
import { TitleBar } from "../components/TitleBar";
import { GeM_BrowserViewport } from "../components/GeM_BrowserViewport";
import { CompanionAssistant } from "../components/CompanionAssistant";

// ── Types ───────────────────────────────────────────────────────────────────

type WorkflowStep =
  | "invoice-selection"
  | "login"
  | "order-matching"
  | "field-mapping"
  | "review"
  | "completion";

const STEPS: Array<{ id: WorkflowStep; label: string }> = [
  { id: "invoice-selection", label: "Select Invoice" },
  { id: "login", label: "GeM Login" },
  { id: "order-matching", label: "Find Order" },
  { id: "field-mapping", label: "Map Fields" },
  { id: "review", label: "Review" },
  { id: "completion", label: "Done" },
];

// ── Animation ────────────────────────────────────────────────────────────────

const slideVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction > 0 ? 40 : -40 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction > 0 ? -40 : 40 }),
};

// ── Component ────────────────────────────────────────────────────────────────

export const GeM_UploadPage: React.FC = () => {
  const navigate = useNavigate();

  // ── Workflow state ────────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] =
    React.useState<WorkflowStep>("invoice-selection");
  const [direction, setDirection] = React.useState<1 | -1>(1);
  const [selectedInvoiceData, setSelectedInvoiceData] =
    React.useState<GeM_ExtractedInvoiceData | null>(null);
  const [matchedOrder, setMatchedOrder] = React.useState<GeM_OrderCard | null>(null);
  const [fieldMappings, setFieldMappings] = React.useState<GeM_FieldMapping[]>([]);
  const [completionStatus, setCompletionStatus] = React.useState<
    "success" | "failed" | null
  >(null);

  // ── Store ─────────────────────────────────────────────────────────────────
  const currentSession = useGeM_Store((state) => state.currentSession);
  const history = useGeM_Store((state) => state.history) ?? [];
  const loginStatus = useGeM_Store((state) => state.loginStatus);
  const browserState = useGeM_Store((state) => state.browserState);
  const setBrowserState = useGeM_Store((state) => state.setBrowserState);
  const initializeSession = useGeM_Store((state) => state.initializeSession);
  const resetSession = useGeM_Store((state) => state.resetCurrentSession);
  const addLog = useGeM_Store((state) => state.addSessionLog);

  // ── Stable index ref (avoids goToStep callback churn) ────────────────────
  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const stepIndexRef = React.useRef(currentStepIndex);
  React.useEffect(() => {
    stepIndexRef.current = currentStepIndex;
  }, [currentStepIndex]);

  // ── Navigation callbacks (must be defined before sync effect) ─────────────

  /**
   * Navigate to any step, deriving slide direction from the index delta.
   * Uses a ref for the current index so this callback is stable.
   */
  const goToStep = React.useCallback((step: WorkflowStep) => {
    const nextIndex = STEPS.findIndex((s) => s.id === step);
    setDirection((nextIndex >= stepIndexRef.current ? 1 : -1) as 1 | -1);
    setCurrentStep(step);
  }, []); // stable — reads index via ref

  const resetWorkflow = React.useCallback(() => {
    void window.electron?.gemCloseBrowser().catch(() => undefined);
    setBrowserState({ isOpen: false, currentUrl: "", pageTitle: "" });
    resetSession();
    setCurrentStep('invoice-selection');
    setDirection(1 as 1 | -1);
    setSelectedInvoiceData(null);
    setMatchedOrder(null);
    setFieldMappings([]);
    setCompletionStatus(null);
  }, [resetSession, setBrowserState]);

  // ── Back navigation ───────────────────────────────────────────────────────

  /**
   * Go back one step and clear state that was *produced* by the step we just
   * left (i.e. the step we're departing from, not the one we're arriving at).
   * State is cleared AFTER the step change so render guards stay consistent.
   */
  const handleBack = React.useCallback(() => {
    if (stepIndexRef.current <= 0) return;
    const leavingStep = STEPS[stepIndexRef.current]?.id;
    const prevStep = STEPS[stepIndexRef.current - 1];

    if (!leavingStep || !prevStep) return;

    goToStep(prevStep.id);
    addLog(`Navigated back to ${prevStep.label}`);

    // Clear state that the step we LEFT produced.
    if (leavingStep === "order-matching") {
      setMatchedOrder(null);
    }

    if (leavingStep === "field-mapping") {
      setFieldMappings([]);
    }

    if (leavingStep === "review") {
      setCompletionStatus(null);
    }
  }, [goToStep, addLog]);

  // ── Top-level navigation ──────────────────────────────────────────────────

  const handleReturnToDashboard = React.useCallback(() => {
    resetWorkflow();
    navigate("/");
  }, [resetWorkflow, navigate]);

  const handleNewInvoice = React.useCallback(() => {
    resetWorkflow();
    navigate("/editor");
  }, [resetWorkflow, navigate]);

  // ── Step callbacks ────────────────────────────────────────────────────────

  const handleInvoiceSelected = React.useCallback(
    (data: GeM_ExtractedInvoiceData) => {
      setSelectedInvoiceData(data);
      initializeSession(data.invoiceNumber);
      addLog(`Invoice ${data.invoiceNumber} selected — moving to login`);
      goToStep("login");
    },
    [initializeSession, addLog, goToStep],
  );

  const handleLoginSuccess = React.useCallback(() => {
    addLog("Login successful — proceeding to order matching");
    goToStep("order-matching");
  }, [addLog, goToStep]);

  const handleOrderMatched = React.useCallback(
    (order: GeM_OrderCard) => {
      setMatchedOrder(order);
      addLog(`Order ${order.contractNumber ?? "—"} matched — proceeding to field mapping`);
      goToStep("field-mapping");
    },
    [addLog, goToStep],
  );

  const handleFieldMappingComplete = React.useCallback(
    (mappings: GeM_FieldMapping[]) => {
      setFieldMappings(mappings);
      addLog("Field mapping complete — proceeding to review");
      goToStep("review");
    },
    [addLog, goToStep],
  );

  const handleConfirmUpload = React.useCallback(() => {
    setCompletionStatus("success");
    addLog("Upload workflow completed successfully");
    goToStep("completion");
  }, [addLog, goToStep]);

  const handleCancelUpload = React.useCallback(() => {
    // TODO: replace window.confirm with a modal component to avoid blocking.
    if (window.confirm("Are you sure you want to cancel this upload?")) {
      addLog("Upload cancelled by user");
      handleReturnToDashboard();
    }
  }, [addLog, handleReturnToDashboard]);

  const completionSucceeded =
    completionStatus === "success" ||
    (currentStep === "completion" && completionStatus === null);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <TitleBar />

      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-[200]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

          {/* Title row */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between mb-4 gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                GeM Automated Invoice Upload
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Automated workflow to upload invoices to Government e-Marketplace
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <CompanionAssistant compact />
              <button
                type="button"
                onClick={handleReturnToDashboard}
                className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Back to Dashboard
              </button>
              <button
                type="button"
                onClick={handleNewInvoice}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                New Invoice
              </button>
            </div>
          </div>

          {/* Progress stepper */}
          <nav aria-label="Upload progress" className="flex items-center gap-2">
            {STEPS.map((step, idx) => {
              const isActive = idx === currentStepIndex;
              const isComplete = idx < currentStepIndex;
              const isClickable = isComplete;

              return (
                <React.Fragment key={step.id}>
                  <motion.button
                    type="button"
                    aria-current={isActive ? "step" : undefined}
                    aria-label={`Step ${idx + 1}: ${step.label}${isComplete ? " (completed)" : ""}`}
                    onClick={() => isClickable && goToStep(step.id)}
                    disabled={!isClickable && !isActive}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : isComplete
                          ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 cursor-pointer"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-default"
                    }`}
                    whileHover={isClickable ? { scale: 1.05 } : {}}
                    whileTap={isClickable ? { scale: 0.97 } : {}}
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 ${
                        isComplete
                          ? "bg-green-600 text-white"
                          : isActive
                            ? "bg-blue-700 text-white"
                            : "bg-slate-300 dark:bg-slate-600 text-slate-500"
                      }`}
                    >
                      {isComplete ? "✓" : idx + 1}
                    </div>
                    <span className="hidden sm:inline text-sm font-medium whitespace-nowrap">
                      {step.label}
                    </span>
                  </motion.button>

                  {idx < STEPS.length - 1 && (
                    <div
                      className={`flex-1 h-1 rounded-full transition-colors duration-500 ${
                        isComplete ? "bg-green-500" : "bg-slate-200 dark:bg-slate-600"
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className={`mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 transition-all duration-300 ${browserState.isOpen || currentStep === 'order-matching' || currentStep === 'field-mapping' ? 'max-w-[1440px]' : 'max-w-5xl'}`}>
        <div className={`grid grid-cols-1 ${browserState.isOpen || currentStep === 'order-matching' || currentStep === 'field-mapping' ? 'lg:grid-cols-5' : ''} gap-8 items-start`}>
          <div className={`${browserState.isOpen || currentStep === 'order-matching' || currentStep === 'field-mapping' ? 'lg:col-span-3' : ''}`}>
            <AnimatePresence mode="wait" custom={direction}>

              {currentStep === "invoice-selection" && (
                <motion.div
                  key="invoice-selection"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                >
                  <GeM_InvoiceSelection
                    onInvoiceSelected={handleInvoiceSelected}
                    onNext={() => goToStep("login")}
                  />
                </motion.div>
              )}

              {currentStep === "login" && selectedInvoiceData && (
                <motion.div
                  key="login"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                >
                  <GeM_LoginAssistant
                    onLoginSuccess={handleLoginSuccess}
                    onError={(error) => {
                      addLog(`Login error: ${error}`);
                      console.error("Login error:", error);
                    }}
                  />
                </motion.div>
              )}

              {currentStep === "order-matching" &&
                selectedInvoiceData &&
                loginStatus.isLoggedIn && (
                  <motion.div
                    key="order-matching"
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                  >
                    <GeM_OrderMatching
                      extractedData={selectedInvoiceData}
                      onOrderMatched={handleOrderMatched}
                      onNext={() => goToStep("field-mapping")}
                    />
                  </motion.div>
                )}

              {currentStep === "field-mapping" &&
                selectedInvoiceData &&
                matchedOrder && (
                  <motion.div
                    key="field-mapping"
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                  >
                    <GeM_FieldMappingForm
                      extractedData={selectedInvoiceData}
                      onMappingComplete={handleFieldMappingComplete}
                    />
                  </motion.div>
                )}

              {currentStep === "review" &&
                selectedInvoiceData &&
                matchedOrder &&
                fieldMappings.length > 0 && (
                  <motion.div
                    key="review"
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                  >
                    <GeM_ReviewScreen
                      extractedData={selectedInvoiceData}
                      matchedOrder={matchedOrder}
                      fieldMappings={fieldMappings}
                      onConfirm={handleConfirmUpload}
                      onCancel={handleCancelUpload}
                    />
                  </motion.div>
                )}

              {currentStep === "completion" && selectedInvoiceData && (
                <motion.div
                  key="completion"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                >
                  <GeM_Completion
                    success={completionSucceeded}
                    invoiceNumber={selectedInvoiceData.invoiceNumber}
                    orderNumber={selectedInvoiceData.orderNumber}
                    message={
                      completionSucceeded
                        ? "Invoice uploaded successfully. You can now view and manage it in your GeM dashboard."
                        : "There was an issue completing the upload. Please try again."
                    }
                    onNewUpload={resetWorkflow}
                    history={history}
                  />
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {browserState.isOpen && (
            <div className="lg:col-span-2 space-y-6">
              <GeM_BrowserViewport />
            </div>
          )}
        </div>
      </main>

      {/* ── Floating back button ────────────────────────────────────────────── */}
      {currentStep !== "invoice-selection" && currentStep !== "completion" && (
        <div className="fixed bottom-6 right-6 z-30">
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleBack}
            className="flex items-center gap-2 px-4 py-3 rounded-lg bg-slate-600 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors shadow-lg"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </motion.button>
        </div>
      )}

      {/* ── Session info sidebar ────────────────────────────────────────────── */}
      {currentSession && (
        <motion.aside
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          aria-label="Session info"
          className="fixed bottom-6 left-6 max-w-xs bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-4 z-30"
        >
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
            Session
          </p>

          <dl className="space-y-1.5 text-xs">
            <div className="flex gap-2">
              <dt className="text-slate-500 dark:text-slate-400 shrink-0">Invoice</dt>
              <dd className="font-medium text-slate-900 dark:text-white truncate">
                {currentSession.selectedInvoiceNumber}
              </dd>
            </div>

            {currentSession.selectedOrderNumber && (
              <div className="flex gap-2">
                <dt className="text-slate-500 dark:text-slate-400 shrink-0">Order</dt>
                <dd className="font-medium text-slate-900 dark:text-white truncate">
                  {currentSession.selectedOrderNumber}
                </dd>
              </div>
            )}

            <div className="flex gap-2">
              <dt className="text-slate-500 dark:text-slate-400 shrink-0">Status</dt>
              <dd className="font-medium text-blue-600 dark:text-blue-400 truncate">
                {currentSession.status}
              </dd>
            </div>
          </dl>

          {currentSession.logs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                Recent Logs
              </p>
              <ul className="space-y-1 max-h-24 overflow-y-auto">
                {currentSession.logs.slice(-3).map((log, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-slate-500 dark:text-slate-400 font-mono leading-snug"
                  >
                    {log}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.aside>
      )}

    </div>
  );
};

export default GeM_UploadPage;