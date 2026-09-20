import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  TrendingUp,
  FileText,
  IndianRupee,
  Plus,
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useNavigate } from "react-router-dom";
import { useInvoiceStore } from "../store/useInvoiceStore";
import { formatCurrency, formatDate } from "../utils/formatters";
import { migrateOldInvoice } from "../utils/migration";
import { extractGemBillNumber, gemPdfKey } from "../utils/gemMatching";
import { MitraLoadingOverlay } from "../components/MitraLoadingOverlay";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/*  (Swap these for your shared Invoice type if you already have one.)        */
/* -------------------------------------------------------------------------- */

interface InvoiceContent {
  billNumber: string;
  orderNumber?: string;
  date: string;
  grandTotal: number;
  plantName?: string;
  customerName?: string;
  totalCGST?: number;
  totalSGST?: number;
  totalIGST?: number;
  gemUploaded?: boolean;
  [key: string]: unknown;
}

interface InvoiceRecord {
  path: string;
  fy: string;
  content: InvoiceContent;
}

interface GemPdf {
  billNumber: string;
  fy: string;
}

/** An invoice plus its GeM status, computed once per scan instead of per render. */
interface EnrichedInvoice extends InvoiceRecord {
  billNo: string;
  /** Ticked by hand in this dashboard (persisted in the invoice JSON). */
  manualGem: boolean;
  /** A matching PDF was found in the GeM folders. */
  pdfGem: boolean;
  hasGem: boolean;
}

type SortKey =
  | "billNumber"
  | "plantName"
  | "orderNumber"
  | "date"
  | "grandTotal";
type SortDirection = "asc" | "desc";
interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

interface StatCardData {
  label: string;
  value: string;
  icon: LucideIcon;
  color: string;
  trend: string;
  breakdown?: { label: string; value: string | number; color: string }[];
}

/* -------------------------------------------------------------------------- */
/*  Constants & helpers                                                       */
/* -------------------------------------------------------------------------- */

const ROW_HEIGHT = 72;

// One column template shared by the header and every row, so they can't drift apart.
const GRID_COLS =
  "grid grid-cols-[56px_220px_minmax(220px,1fr)_190px_150px_150px_64px]";

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

// numeric: true makes "INV/9" sort before "INV/10" (plain string compare doesn't).
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const compareDates = (a: string, b: string) => {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isNaN(ta) || Number.isNaN(tb) ? a.localeCompare(b) : ta - tb;
};

const COMPARATORS: Record<
  SortKey,
  (a: EnrichedInvoice, b: EnrichedInvoice) => number
> = {
  billNumber: (a, b) =>
    collator.compare(a.content.billNumber ?? "", b.content.billNumber ?? ""),
  plantName: (a, b) =>
    collator.compare(a.content.plantName ?? "", b.content.plantName ?? ""),
  orderNumber: (a, b) =>
    collator.compare(a.content.orderNumber ?? "", b.content.orderNumber ?? ""),
  date: (a, b) => compareDates(a.content.date ?? "", b.content.date ?? ""),
  grandTotal: (a, b) => num(a.content.grandTotal) - num(b.content.grandTotal),
};

/* -------------------------------------------------------------------------- */
/*  Small presentational components                                           */
/* -------------------------------------------------------------------------- */

const StatCard = memo(
  ({ stat, index }: { stat: StatCardData; index: number }) => {
    const reduceMotion = useReducedMotion();
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0 : index * 0.1 }}
        className="glass-card p-6 rounded-3xl relative overflow-hidden group border border-primary-500/5 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-start mb-4">
            <div
              className={clsx(
                stat.color,
                "w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform",
              )}
            >
              <stat.icon size={24} />
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-primary-500 bg-primary-500/10 px-3 py-1.5 rounded-full">
              {stat.trend}
            </div>
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {stat.label}
          </p>
          <h3 className="text-2xl font-black mt-1 tracking-tight">
            {stat.value}
          </h3>

          {stat.breakdown && (
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4">
              {stat.breakdown.map((item) => (
                <div key={item.label} className="flex flex-col">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    {item.label}
                  </span>
                  <span className={clsx("text-xs font-black", item.color)}>
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-primary-500/5 rounded-full blur-2xl" />
      </motion.div>
    );
  },
);
StatCard.displayName = "StatCard";

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  sortConfig: SortConfig;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}

const SortHeader = memo(
  ({ label, sortKey, sortConfig, onSort, align = "left" }: SortHeaderProps) => {
    const active = sortConfig.key === sortKey;
    const Icon = !active
      ? ArrowUpDown
      : sortConfig.direction === "asc"
        ? ArrowUp
        : ArrowDown;
    return (
      <div
        role="columnheader"
        aria-sort={
          active
            ? sortConfig.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        className={clsx(
          "px-4 py-4 flex",
          align === "right" ? "justify-end" : "justify-start",
        )}
      >
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={clsx(
            "inline-flex items-center gap-1 rounded uppercase tracking-widest font-black transition-colors",
            "hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 ring-primary-500/40",
            active && "text-primary-600",
          )}
        >
          {label}
          <Icon size={12} className={clsx(!active && "opacity-30")} />
        </button>
      </div>
    );
  },
);
SortHeader.displayName = "SortHeader";

interface InvoiceRowProps {
  inv: EnrichedInvoice;
  index: number;
  top: number;
  saving: boolean;
  onToggle: (inv: EnrichedInvoice) => void;
  onOpen: (inv: EnrichedInvoice) => void;
}

const InvoiceRow = memo(
  ({ inv, index, top, saving, onToggle, onOpen }: InvoiceRowProps) => {
    const { content } = inv;
    const toggleLabel = inv.pdfGem
      ? "GeM PDF found, status is automatic"
      : inv.manualGem
        ? `Mark bill ${content.billNumber} as not uploaded to GeM`
        : `Mark bill ${content.billNumber} as uploaded to GeM`;

    return (
      <div
        role="row"
        aria-rowindex={index + 2} // +1 for 1-based, +1 for the header row
        className={clsx(
          GRID_COLS,
          "absolute top-0 left-0 w-full items-center border-b border-border hover:bg-accent/30 transition-colors",
        )}
        style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
      >
        <div role="cell" className="flex justify-center">
          <button
            type="button"
            aria-pressed={inv.hasGem}
            aria-label={toggleLabel}
            title={inv.pdfGem ? "Detected from a GeM PDF" : toggleLabel}
            disabled={saving || inv.pdfGem}
            onClick={() => onToggle(inv)}
            className={clsx(
              "rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 ring-primary-500/40",
              inv.hasGem
                ? "text-emerald-500"
                : "text-muted-foreground hover:text-primary-500",
              inv.pdfGem && "opacity-60 cursor-not-allowed",
            )}
          >
            {saving ? (
              <Loader2 size={20} className="animate-spin" />
            ) : inv.hasGem ? (
              <CheckCircle2 size={20} />
            ) : (
              <Circle size={20} />
            )}
          </button>
        </div>

        <div
          role="cell"
          className="px-4 font-mono font-bold text-sm whitespace-nowrap truncate"
        >
          {content.billNumber}
        </div>

        <div role="cell" className="px-4 overflow-hidden">
          <div className="flex flex-col">
            <span className="font-bold text-xs uppercase truncate">
              {content.plantName || "N/A"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatDate(content.date)}
            </span>
          </div>
        </div>

        <div
          role="cell"
          className="px-4 font-mono text-[10px] font-bold text-muted-foreground truncate"
        >
          {content.orderNumber || "—"}
        </div>

        <div
          role="cell"
          className="px-4 font-black text-primary-600 dark:text-primary-400 whitespace-nowrap text-right"
        >
          {formatCurrency(content.grandTotal)}
        </div>

        <div role="cell" className="px-4 text-center">
          {inv.hasGem ? (
            <span
              title={
                inv.pdfGem ? "Detected from a GeM PDF" : "Marked as uploaded"
              }
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-600 whitespace-nowrap"
            >
              <ShieldCheck size={12} /> GeM sent
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-600 whitespace-nowrap">
              <ShieldAlert size={12} /> Pending GeM
            </span>
          )}
        </div>

        <div role="cell" className="px-2 flex justify-end">
          <button
            type="button"
            aria-label={`Open bill ${content.billNumber} in the editor`}
            onClick={() => onOpen(inv)}
            className="text-primary-500 hover:bg-primary-500/10 p-2 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 ring-primary-500/40"
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
      </div>
    );
  },
);
InvoiceRow.displayName = "InvoiceRow";

/* -------------------------------------------------------------------------- */
/*  Dashboard                                                                 */
/* -------------------------------------------------------------------------- */

export const Dashboard: React.FC = () => {
  const { scanPaths, gemPaths, setCurrentInvoice } = useInvoiceStore();
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [gemPdfs, setGemPdfs] = useState<GemPdf[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedAt, setLastScannedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingPaths, setSavingPaths] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const [selectedFY, setSelectedFY] = useState("");
  const [showAllBills, setShowAllBills] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "date",
    direction: "desc",
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const scanIdRef = useRef(0);

  /* ------------------------------ Scanning -------------------------------- */

  const handleScan = useCallback(async () => {
    if (!window.electron) {
      setError("Scanning is only available in the desktop app.");
      return;
    }

    // Guards against an older, slower scan overwriting the result of a newer one
    // (e.g. when scan paths change while a scan is still running).
    const scanId = ++scanIdRef.current;
    setIsScanning(true);
    setError(null);

    try {
      const [invResults, gemResults] = await Promise.all([
        window.electron.scanInvoices(scanPaths),
        window.electron.scanGemPdfs(gemPaths),
      ]);
      if (scanId !== scanIdRef.current) return;

      setInvoices(
        (invResults as InvoiceRecord[]).map((item) => ({
          ...item,
          content: migrateOldInvoice(item.content) as unknown as InvoiceContent,
        })),
      );
      setGemPdfs(gemResults as GemPdf[]);
      setLastScannedAt(new Date());
    } catch (err) {
      if (scanId !== scanIdRef.current) return;
      console.error("Dashboard scan failed:", err);
      setError(
        "Could not scan your invoice folders. Check the folder paths in Settings and try again.",
      );
    } finally {
      if (scanId === scanIdRef.current) setIsScanning(false);
    }
  }, [scanPaths, gemPaths]);

  useEffect(() => {
    void handleScan();
  }, [handleScan]);

  // Ignore any scan that is still in flight when the page unmounts.
  useEffect(
    () => () => {
      scanIdRef.current += 1;
    },
    [],
  );

  /* ---------------------------- Derived data ------------------------------ */

  const financialYears = useMemo(
    () =>
      Array.from(new Set(invoices.map((inv) => inv.fy))).sort((a, b) =>
        b.localeCompare(a),
      ),
    [invoices],
  );

  // Pick the newest FY initially, and recover if the selected one disappears after a rescan.
  useEffect(() => {
    if (financialYears.length === 0) {
      if (selectedFY) setSelectedFY("");
    } else if (!financialYears.includes(selectedFY)) {
      setSelectedFY(financialYears[0]);
    }
  }, [financialYears, selectedFY]);

  // GeM status is worked out once per invoice here, then reused by the list and the stats.
  const enrichedInvoices = useMemo<EnrichedInvoice[]>(() => {
    const pdfKeys = new Set<string>();
    for (const pdf of gemPdfs) {
      const billNo = extractGemBillNumber(pdf.billNumber);
      if (billNo) pdfKeys.add(gemPdfKey(billNo, pdf.fy));
    }

    return invoices.map((inv) => {
      const billNo = extractGemBillNumber(inv.content.billNumber);
      const manualGem = !!inv.content.gemUploaded;
      const pdfGem =
        !!billNo &&
        (pdfKeys.has(gemPdfKey(billNo, inv.fy)) ||
          pdfKeys.has(gemPdfKey(billNo, "Unknown")));
      return { ...inv, billNo, manualGem, pdfGem, hasGem: manualGem || pdfGem };
    });
  }, [invoices, gemPdfs]);

  const fyInvoices = useMemo(
    () =>
      selectedFY ? enrichedInvoices.filter((inv) => inv.fy === selectedFY) : [],
    [enrichedInvoices, selectedFY],
  );

  const visibleInvoices = useMemo(() => {
    const rows = showAllBills
      ? fyInvoices
      : fyInvoices.filter((inv) => !inv.hasGem);
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    const compare = COMPARATORS[sortConfig.key];
    // Fall back to bill number so equal values keep a predictable order.
    return [...rows].sort(
      (a, b) => (compare(a, b) || COMPARATORS.billNumber(a, b)) * dir,
    );
  }, [fyInvoices, showAllBills, sortConfig]);

  const stats = useMemo(() => {
    let revenue = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let gem = 0;
    const clients = new Set<string>();

    for (const inv of fyInvoices) {
      revenue += num(inv.content.grandTotal);
      cgst += num(inv.content.totalCGST);
      sgst += num(inv.content.totalSGST);
      igst += num(inv.content.totalIGST);
      if (inv.hasGem) gem++;
      const client = inv.content.customerName?.trim().toLowerCase();
      if (client) clients.add(client);
    }

    const total = fyInvoices.length;
    return {
      revenue,
      cgst,
      sgst,
      igst,
      gst: cgst + sgst + igst,
      total,
      gem,
      pending: total - gem,
      clients: clients.size,
      average: total ? revenue / total : 0,
    };
  }, [fyInvoices]);

  const statCards = useMemo<StatCardData[]>(
    () => [
      {
        label: "Total Revenue",
        value: formatCurrency(stats.revenue),
        icon: IndianRupee,
        color: "bg-emerald-500",
        trend: selectedFY ? `FY ${selectedFY}` : "Select FY",
        breakdown: [
          { label: "Clients", value: stats.clients, color: "text-emerald-600" },
          {
            label: "Avg. bill",
            value: formatCurrency(stats.average),
            color: "text-emerald-600",
          },
        ],
      },
      {
        label: "Invoices Count",
        value: String(stats.total),
        icon: FileText,
        color: "bg-blue-500",
        trend: `${stats.gem} GeM uploads`,
        breakdown: [
          { label: "GeM bills", value: stats.gem, color: "text-emerald-600" },
          { label: "Pending", value: stats.pending, color: "text-amber-600" },
        ],
      },
      {
        label: "GST Collected",
        value: formatCurrency(stats.gst),
        icon: TrendingUp,
        color: "bg-purple-500",
        trend: "Total tax",
        breakdown: [
          {
            label: "CGST",
            value: formatCurrency(stats.cgst),
            color: "text-blue-600",
          },
          {
            label: "SGST",
            value: formatCurrency(stats.sgst),
            color: "text-purple-600",
          },
          {
            label: "IGST",
            value: formatCurrency(stats.igst),
            color: "text-orange-600",
          },
        ],
      },
    ],
    [stats, selectedFY],
  );

  /* ------------------------------ Virtualizer ----------------------------- */

  const rowVirtualizer = useVirtualizer({
    count: visibleInvoices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    // Key rows by file path so React reuses the right DOM nodes when the list is re-sorted.
    getItemKey: (index) => visibleInvoices[index]?.path ?? index,
  });

  // Start from the top when the list is swapped out for a different one.
  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [selectedFY, showAllBills]);

  /* ------------------------------- Actions -------------------------------- */

  const handleSort = useCallback((key: SortKey) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const handleManualGemToggle = useCallback(async (inv: EnrichedInvoice) => {
    if (!window.electron?.saveFile) {
      setError("Saving is only available in the desktop app.");
      return;
    }

    const { path } = inv;
    const updatedContent: InvoiceContent = {
      ...inv.content,
      gemUploaded: !inv.manualGem,
    };

    setSavingPaths((prev) => new Set(prev).add(path));
    try {
      const result = await window.electron.saveFile({
        content: updatedContent,
        filePath: path,
      });
      if (!result) throw new Error("Save returned no result");

      setInvoices((prev) =>
        prev.map((item) =>
          item.path === path ? { ...item, content: updatedContent } : item,
        ),
      );
    } catch (err) {
      console.error("Failed to toggle GeM status:", err);
      setError(
        `Could not save the GeM status for bill ${inv.content.billNumber}. Try again.`,
      );
    } finally {
      setSavingPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  const handleOpen = useCallback(
    (inv: EnrichedInvoice) => {
      setCurrentInvoice({ ...inv.content, filePath: inv.path } as Parameters<
        typeof setCurrentInvoice
      >[0]);
      navigate("/editor");
    },
    [setCurrentInvoice, navigate],
  );

  const handleNewBill = useCallback(() => {
    setCurrentInvoice(null);
    navigate("/editor");
  }, [setCurrentInvoice, navigate]);

  /* ------------------------------ Empty state ----------------------------- */

  const emptyMessage = useMemo(() => {
    if (isScanning && invoices.length === 0)
      return { icon: RefreshCw, spin: true, text: "Scanning invoices…" };
    if (invoices.length === 0) {
      return {
        icon: FileText,
        spin: false,
        text: "No invoices found in the selected folders.",
      };
    }
    if (!selectedFY)
      return { icon: FileText, spin: false, text: "Select a financial year." };
    if (!showAllBills && fyInvoices.length > 0) {
      return {
        icon: ShieldCheck,
        spin: false,
        text: `All bills for FY ${selectedFY} are on GeM.`,
      };
    }
    return {
      icon: FileText,
      spin: false,
      text: `No bills for FY ${selectedFY}.`,
    };
  }, [
    isScanning,
    invoices.length,
    selectedFY,
    showAllBills,
    fyInvoices.length,
  ]);

  /* -------------------------------- Render -------------------------------- */

  const segmentClass = (active: boolean) =>
    clsx(
      "px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all",
      "focus-visible:outline-none focus-visible:ring-2 ring-primary-500/40",
      active
        ? "bg-white dark:bg-zinc-800 shadow-sm text-primary-600"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-8 pb-10" aria-busy={isScanning}>
      <MitraLoadingOverlay
        visible={isScanning}
        message="Mitra is checking your billing folders..."
        detail="I am matching invoices and GeM records so your dashboard is up to date."
      />
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Dashboard Overview
          </h1>
          {lastScannedAt && (
            <p className="text-sm text-muted-foreground mt-1">
              Last scanned at{" "}
              {lastScannedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-accent/30 p-1 rounded-xl border border-border">
            <button
              type="button"
              aria-pressed={!showAllBills}
              onClick={() => setShowAllBills(false)}
              className={segmentClass(!showAllBills)}
            >
              Pending
            </button>
            <button
              type="button"
              aria-pressed={showAllBills}
              onClick={() => setShowAllBills(true)}
              className={segmentClass(showAllBills)}
            >
              All bills
            </button>
          </div>

          <label className="sr-only" htmlFor="fy-select">
            Financial year
          </label>
          <select
            id="fy-select"
            value={selectedFY}
            onChange={(e) => setSelectedFY(e.target.value)}
            disabled={financialYears.length === 0}
            className="bg-accent/50 border-none rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 ring-primary-500/20 transition-all outline-none disabled:opacity-50"
          >
            {!selectedFY && <option value="">Select FY</option>}
            {financialYears.map((fy) => (
              <option key={fy} value={fy}>{`FY ${fy}`}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleScan}
            disabled={isScanning}
            aria-label="Rescan invoice folders"
            title="Rescan invoice folders"
            className="p-2.5 bg-accent hover:bg-accent/80 rounded-xl transition-all disabled:opacity-50 shrink-0 focus-visible:outline-none focus-visible:ring-2 ring-primary-500/40"
          >
            <RefreshCw size={20} className={isScanning ? "animate-spin" : ""} />
          </button>

          <button
            type="button"
            onClick={handleNewBill}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-lg shadow-primary-500/20 active:scale-95 shrink-0 focus-visible:outline-none focus-visible:ring-2 ring-primary-500/40"
          >
            <Plus size={20} />
            New bill
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss message"
            className="rounded p-0.5 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 ring-amber-500/40"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statCards.map((stat, i) => (
          <StatCard key={stat.label} stat={stat} index={i} />
        ))}
      </div>

      {/* Invoice table */}
      <div className="glass-card rounded-3xl overflow-hidden border border-primary-500/5 flex flex-col h-[600px] max-h-[75vh]">
        <div className="p-6 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-xl font-bold">
            {showAllBills ? "Financial year records" : "Pending GeM uploads"}
          </h2>
          <div
            className={clsx(
              "text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full",
              showAllBills
                ? "bg-primary-500/10 text-primary-600"
                : "bg-amber-500/10 text-amber-600",
            )}
          >
            {visibleInvoices.length} {showAllBills ? "total" : "pending"} bills
          </div>
        </div>

        {/* Horizontal scroll on narrow windows; header and rows scroll together. */}
        <div className="flex-1 min-h-0 overflow-x-auto">
          <div
            role="table"
            aria-label={
              showAllBills ? "All invoices" : "Invoices pending GeM upload"
            }
            aria-rowcount={visibleInvoices.length + 1}
            className="flex h-full min-w-[1120px] flex-col"
          >
            {/* Header. scrollbar-gutter keeps its columns aligned with the body's scrollbar. */}
            <div
              role="row"
              aria-rowindex={1}
              className={clsx(
                GRID_COLS,
                "shrink-0 items-center bg-accent/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border",
              )}
              style={{ overflowY: "hidden", scrollbarGutter: "stable" }}
            >
              <div role="columnheader" className="px-2 py-4 text-center">
                Done
              </div>
              <SortHeader
                label="Bill no"
                sortKey="billNumber"
                sortConfig={sortConfig}
                onSort={handleSort}
              />
              <SortHeader
                label="Customer / plant"
                sortKey="plantName"
                sortConfig={sortConfig}
                onSort={handleSort}
              />
              <SortHeader
                label="Order no"
                sortKey="orderNumber"
                sortConfig={sortConfig}
                onSort={handleSort}
              />
              <SortHeader
                label="Amount"
                sortKey="grandTotal"
                sortConfig={sortConfig}
                onSort={handleSort}
                align="right"
              />
              <div role="columnheader" className="px-4 py-4 text-center">
                Status
              </div>
              <div role="columnheader" className="px-2 py-4 text-right">
                <span className="sr-only">Actions</span>
              </div>
            </div>

            {/* Body */}
            <div
              ref={parentRef}
              role="rowgroup"
              className="relative flex-1 min-h-0 overflow-y-auto custom-scrollbar"
              style={{ scrollbarGutter: "stable" }}
            >
              {visibleInvoices.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <emptyMessage.icon
                    size={40}
                    className={clsx(
                      "opacity-40",
                      emptyMessage.icon === ShieldCheck && "text-emerald-500",
                      emptyMessage.spin && "animate-spin",
                    )}
                  />
                  <p className="text-sm font-bold">{emptyMessage.text}</p>
                </div>
              ) : (
                <div
                  style={{
                    height: rowVirtualizer.getTotalSize(),
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const inv = visibleInvoices[virtualRow.index];
                    return (
                      <InvoiceRow
                        key={virtualRow.key}
                        inv={inv}
                        index={virtualRow.index}
                        top={virtualRow.start}
                        saving={savingPaths.has(inv.path)}
                        onToggle={handleManualGemToggle}
                        onOpen={handleOpen}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
