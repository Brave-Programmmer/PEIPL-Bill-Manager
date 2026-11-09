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
  const [completionMessage, setCompletionMessage] = React.useState<string | undefined>();

  // ── Store ─────────────────────────────────────────────────────────────────
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
    setCompletionMessage(undefined);
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
      // Keep extractedData inside the new session so recovery / overlay stay coherent
      initializeSession(data.invoiceNumber, data);
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

  const handleConfirmUpload = React.useCallback(
    (result: { success: boolean; message?: string }) => {
      setCompletionStatus(result.success ? "success" : "failed");
      setCompletionMessage(result.message);
      addLog(
        result.success
          ? "Upload workflow completed successfully"
          : `Upload failed: ${result.message || "unknown error"}`,
      );
      goToStep("completion");
    },
    [addLog, goToStep],
  );

  const handleCancelUpload = React.useCallback(() => {
    if (window.confirm("Are you sure you want to cancel this upload?")) {
      addLog("Upload cancelled by user");
      handleReturnToDashboard();
    }
  }, [addLog, handleReturnToDashboard]);

  const completionSucceeded = completionStatus === "success";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <TitleBar />

      {/* ── Sticky header (compact) ────────────────────────────────────────── */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-[200]">
        <div className="max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
          {currentStep !== "invoice-selection" && currentStep !== "completion" && (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Back"
              title="Back"
              className="shrink-0 p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900 dark:text-white truncate">
              GeM Invoice Upload
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Step {Math.max(1, currentStepIndex + 1)} of {STEPS.length} ·{" "}
              {STEPS[currentStepIndex]?.label}
            </p>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2 shrink-0">
            <CompanionAssistant compact />
            <button
              type="button"
              onClick={handleReturnToDashboard}
              className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer"
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={handleNewInvoice}
              className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              New Invoice
            </button>
          </div>
        </div>

        {/* Slim segmented progress bar */}
        <nav aria-label="Upload progress" className="flex h-1">
          {STEPS.map((step, idx) => (
            <div
              key={step.id}
              aria-current={idx === currentStepIndex ? "step" : undefined}
              title={step.label}
              className={`flex-1 transition-colors duration-300 ${
                idx <= currentStepIndex ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-700"
              }`}
            />
          ))}
        </nav>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className={`mx-auto px-4 sm:px-6 lg:px-8 py-6 transition-all duration-300 ${browserState.isOpen || currentStep === 'order-matching' || currentStep === 'field-mapping' ? 'max-w-[1700px]' : 'max-w-5xl'}`}>
        <div className={`grid grid-cols-1 ${browserState.isOpen || currentStep === 'order-matching' || currentStep === 'field-mapping' ? 'lg:grid-cols-5' : ''} gap-8 items-start`}>
          <div className={`${browserState.isOpen || currentStep === 'order-matching' || currentStep === 'field-mapping' ? 'lg:col-span-2 min-w-0' : ''}`}>
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

              {currentStep === "order-matching" && selectedInvoiceData && (
                  <motion.div
                    key="order-matching"
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                  >
                    {!loginStatus.isLoggedIn && !browserState.isOpen ? (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-6 space-y-3">
                        <p className="text-sm text-amber-900 dark:text-amber-100">
                          Login session was lost. Go back to GeM Login, or continue if the browser is already open and authenticated.
                        </p>
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => goToStep("login")}
                            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 cursor-pointer"
                          >
                            Back to Login
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              useGeM_Store.getState().setLoginStatus({
                                isLoggedIn: true,
                                loginTime: Date.now(),
                              });
                            }}
                            className="px-4 py-2 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-sm cursor-pointer"
                          >
                            I&apos;m already logged in
                          </button>
                        </div>
                      </div>
                    ) : (
                      <GeM_OrderMatching
                        extractedData={selectedInvoiceData}
                        onOrderMatched={handleOrderMatched}
                      />
                    )}
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
                      completionMessage ||
                      (completionSucceeded
                        ? "Invoice uploaded successfully. You can now view and manage it in your GeM dashboard."
                        : "There was an issue completing the upload. Please try again.")
                    }
                    onNewUpload={resetWorkflow}
                    history={history}
                  />
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {browserState.isOpen && (
            <div className="lg:col-span-3 min-w-0 space-y-6">
              <GeM_BrowserViewport />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default GeM_UploadPage;