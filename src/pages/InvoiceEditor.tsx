import React, { useState, useEffect, useMemo, useRef } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import {
  Plus,
  Trash2,
  Save,
  Printer,
  FileDown,
  Settings as SettingsIcon,
  RotateCcw,
  ArrowLeft,
  X,
  FileText as FileTextIcon,
  Layout as LayoutIcon,
  ChevronDown,
  Bookmark,
  Search,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useInvoiceStore } from "../store/useInvoiceStore";
import type { Invoice } from "../utils/types";
import { migrateOldInvoice } from "../utils/migration";
import {
  formatCurrency,
  numberToWords,
  parseNumeric,
  formatDateForInput,
} from "../utils/formatters";
import { Link, useNavigate, useParams } from "react-router-dom";
import { clsx } from "clsx";

import { PrintPreview } from "../components/PrintPreview";

// Helper component for inputs that should only trigger calculations on blur or enter
const DelayedInput: React.FC<{
  value: any;
  onSave: (val: string) => void;
  className?: string;
  placeholder?: string;
}> = ({ value, onSave, className, placeholder }) => {
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const persistValue = () => {
    onSave(localValue);
  };

  return (
    <input
      ref={inputRef}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => persistValue()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          persistValue();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
      placeholder={placeholder}
    />
  );
};

export const InvoiceEditor: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    saveInvoice,
    calculateTotals,
    companyDetails,
    history,
    currentInvoice,
    setCurrentInvoice,
    customerPresets,
    savePreset,
    deletePreset,
  } = useInvoiceStore();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isHeaderOpen, setIsHeaderOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [showTaxColumns, setShowTaxColumns] = useState(false);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [presetSearch, setPresetSearch] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { isDirty },
  } = useForm<Invoice>({
    defaultValues: {
      billNumber: `PEIPL/${new Date().getFullYear()}/${Math.floor(Math.random() * 1000)}`,
      date: new Date().toISOString().split("T")[0],
      orderNumber: "GEMC-511687712601789",
      orderDate: "",
      outlineAgreement: "4600002141",
      gemSellerId: "RXON210002099996",
      jobsheetNo: "ATTACHED",
      vendorCode: "102237",
      customerName: "RASHTRIYA CHEMICALS & FERTILIZERS LTD",
      plantName: "S.G. INSTRUMENT PLANT",
      customerAddress: "TROMBAY UNIT\nMUMBAI.400 074",
      customerGST: "27AAACR2831H1ZK",
      taxMode: "GST",
      itemsPerPage: 12,
      items: [
        {
          id: 1,
          description: "",
          sacHsn: [""],
          quantity: [0],
          unit: "PCS",
          rate: [0],
          amount: [0],
          cgstRate: 9,
          cgstAmount: [0],
          sgstRate: 9,
          sgstAmount: [0],
          totalWithGST: [0],
          dates: [""],
          srNoDate: [""],
          refNo: [""],
        },
      ],
      totalTaxableValue: 0,
      totalCGST: 0,
      totalSGST: 0,
      totalIGST: 0,
      grandTotal: 0,
      amountInWords: "",
      status: "draft",
      showStamp: true,
    },
  });



  // Load existing invoice if ID is present OR if currentInvoice is set in store
  useEffect(() => {
    if (id) {
      const invoice = history.find((h) => h.billNumber === id);
      if (invoice) {
        reset(migrateOldInvoice(invoice));
      }
    } else if (currentInvoice) {
      console.log("Loading invoice into editor:", currentInvoice.billNumber);
      reset(migrateOldInvoice(currentInvoice));
    }
  }, [id, history, reset, currentInvoice]);

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const watchedItems =
    useWatch({
      control,
      name: "items",
      defaultValue: [],
    }) || [];

  const taxMode =
    useWatch({
      control,
      name: "taxMode",
      defaultValue: "GST",
    }) || "GST";

  // Real-time calculations derived from watched state
  const calculations = useMemo(() => {
    if (!watchedItems || watchedItems.length === 0) return null;

    const itemsCalculations = watchedItems.map((item) => {
      if (!item)
        return {
          amount: [0],
          cgstAmount: [0],
          sgstAmount: [0],
          igstAmount: [0],
          totalWithGST: [0],
        };
      const qtyArr = Array.isArray(item.quantity)
        ? item.quantity
        : [item.quantity];
      const rateArr = Array.isArray(item.rate) ? item.rate : [item.rate];
      const maxLen = Math.max(qtyArr.length, rateArr.length);

      const amounts: number[] = [];
      for (let i = 0; i < maxLen; i++) {
        const q = parseNumeric(qtyArr[i]);
        const r = parseNumeric(rateArr[i]);
        amounts.push(q * r);
      }

      const cgstRate = Number(item.cgstRate) || 0;
      const sgstRate = Number(item.sgstRate) || 0;
      const igstRate = Number(item.igstRate) || 0;

      const cgstAmounts = amounts.map((a) => (a * cgstRate) / 100);
      const sgstAmounts = amounts.map((a) => (a * sgstRate) / 100);
      const igstAmounts = amounts.map((a) => (a * igstRate) / 100);
      const totalsGST = amounts.map(
        (a, i) => a + (cgstAmounts[i] || 0) + (sgstAmounts[i] || 0) + (igstAmounts[i] || 0),
      );

      return {
        amount: amounts,
        cgstAmount: cgstAmounts,
        sgstAmount: sgstAmounts,
        igstAmount: igstAmounts,
        totalWithGST: totalsGST,
      };
    });

    const totals = calculateTotals(watchedItems, taxMode);
    const words = numberToWords(totals.grandTotal);

    return {
      items: itemsCalculations,
      totals,
      amountInWords: `RUPEES ${words} ONLY`,
    };
  }, [watchedItems, taxMode, calculateTotals]);

  const getCalculatedInvoiceData = () => {
    const formData = watch();
    if (!calculations) return formData;

    return {
      ...formData,
      totalTaxableValue: calculations.totals.totalTaxableValue,
      totalCGST: calculations.totals.totalCGST,
      totalSGST: calculations.totals.totalSGST,
      totalIGST: calculations.totals.totalIGST,
      grandTotal: calculations.totals.grandTotal,
      amountInWords: calculations.amountInWords,
    } as Invoice;
  };

  const handleSaveAs = async () => {
    const data = getCalculatedInvoiceData();
    const result = await window.electron.saveFile({ 
      content: data,
      filePath: data.filePath // Pass existing path if available
    });
    if (result) {
      setValue("filePath", result); // Update form state with the saved path
      saveInvoice({ ...data, filePath: result }); // Update store history
      alert(`Invoice saved successfully!`);
    }
  };

  const onSubmit = (data: Invoice) => {
    const finalData = {
      ...data,
      ...(calculations
        ? {
            totalTaxableValue: calculations.totals.totalTaxableValue,
            totalCGST: calculations.totals.totalCGST,
            totalSGST: calculations.totals.totalSGST,
            totalIGST: calculations.totals.totalIGST,
            grandTotal: calculations.totals.grandTotal,
            amountInWords: calculations.amountInWords,
          }
        : {}),
    };

    saveInvoice(finalData);
    alert("Invoice saved to local history!");
    navigate("/");
  };

  const handleImport = async () => {
    const result = await window.electron.selectFile();
    if (result) {
      const migratedData = migrateOldInvoice({
        ...result.content,
        filePath: result.path // Inject path from electron result
      });
      reset(migratedData);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Toolbar */}
        <div className="flex items-center justify-between sticky top-[88px] z-10 bg-background/80 backdrop-blur-md p-4 rounded-2xl border border-border shadow-lg">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="p-2 hover:bg-accent rounded-full transition-colors"
            >
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-xl font-bold">
              {id ? "Edit Invoice" : "New Invoice"}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleImport}
              className="flex items-center gap-2 px-4 py-2 hover:bg-accent rounded-xl transition-all text-sm font-medium"
            >
              <FileDown size={18} />
              Import JSON
            </button>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="flex items-center gap-2 px-4 py-2 hover:bg-accent rounded-xl transition-all text-sm font-medium text-blue-600 dark:text-blue-400"
            >
              <Printer size={18} />
              Preview & Print
            </button>
            <button
              type="button"
              onClick={handleSaveAs}
              className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2 rounded-xl font-bold transition-all shadow-lg shadow-primary-500/20 active:scale-95"
            >
              <Save size={18} />
              Save Invoice
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-3 space-y-8">
            {/* Items Table - Industrial Format */}
            <div className="glass-card overflow-hidden rounded-[28px] border border-primary-500/10 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between gap-4 border-b border-border bg-gradient-to-r from-primary-500/8 via-accent/30 to-transparent p-4 md:p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500 text-white shadow-lg shadow-primary-500/20">
                    <FileTextIcon size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-primary-500/80">
                      Ledger
                    </p>
                    <h2 className="text-sm font-black uppercase tracking-[0.18em]">
                      Job Entries
                    </h2>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    aria-pressed={showTaxColumns}
                    onClick={() => setShowTaxColumns((prev) => !prev)}
                    className={clsx(
                      "rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] transition-all",
                      showTaxColumns
                        ? "border-primary-500/30 bg-primary-500/10 text-primary-600"
                        : "border-border bg-background/80 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {showTaxColumns ? "Hide tax totals" : "Show tax totals"}
                  </button>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-background/80 px-2.5 py-1.5 shadow-sm">
                    <span className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                      Tax
                    </span>
                    <select
                      {...register("taxMode")}
                      className="bg-transparent text-xs font-bold outline-none focus:ring-0"
                    >
                      <option value="GST">CGST + SGST (9%+9%)</option>
                      <option value="IGST">IGST (18%)</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      append({
                        id: Date.now(),
                        description: "",
                        unit: "PCS",
                        sacHsn: [""],
                        quantity: [0],
                        rate: [0],
                        amount: [0],
                        cgstRate: 9,
                        cgstAmount: [0],
                        sgstRate: 9,
                        sgstAmount: [0],
                        igstRate: 0,
                        igstAmount: [0],
                        totalWithGST: [0],
                        dates: [""],
                        srNoDate: [""],
                        refNo: [""],
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-primary-500/20 transition-all hover:bg-primary-700 active:scale-[0.98]"
                  >
                    <Plus size={14} />
                    Add Job Category
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-[11px]">
                  <thead>
                    <tr className="bg-accent/30 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                      <th className="border-b border-border p-2.5 text-left w-[110px]">Sr No & Date</th>
                      <th className="border-b border-border p-2.5 text-left w-[60px]">Ref No</th>
                      <th className="border-b border-border p-2.5 text-left">Job Description</th>
                      <th className="border-b border-border p-2.5 text-left w-[80px]">SAC/HSN</th>
                      <th className="border-b border-border p-2.5 text-left w-[50px]">Qty</th>
                      <th className="border-b border-border p-2.5 text-left w-[80px]">Rate</th>
                      {showTaxColumns && (
                        <>
                          <th className="border-b border-border p-2.5 text-right w-[90px]">Taxable</th>
                          {taxMode === "GST" ? (
                            <>
                              <th className="border-b border-border p-2.5 text-right w-[80px]">CGST</th>
                              <th className="border-b border-border p-2.5 text-right w-[80px]">SGST</th>
                            </>
                          ) : (
                            <th className="border-b border-border p-2.5 text-right w-[160px]" colSpan={2}>
                              IGST (18%)
                            </th>
                          )}
                          <th className="border-b border-border p-2.5 text-right w-[100px]">Total+GST</th>
                        </>
                      )}
                      <th className="border-b border-border p-2.5 text-right w-[50px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <AnimatePresence>
                      {fields.map((field, index) => (
                        <React.Fragment key={field.id}>
                          {/* Main Row - Contains Description and First Data Entry */}
                          <tr className="group border-t-2 border-primary-500/20 bg-gradient-to-r from-background/80 to-primary-500/[0.02]">
                            <td className="w-[120px] p-2 align-top">
                              <div className="flex flex-col gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-500 text-[9px] font-black text-white shadow-sm shadow-primary-500/30">
                                  {index + 1}
                                </div>
                                <input
                                  {...register(`items.${index}.srNoDate.0`)}
                                  className="w-full rounded-lg border border-transparent bg-transparent p-1.5 text-[11px] font-medium transition-all hover:border-primary-500/10 hover:bg-primary-500/[0.02] focus:border-primary-500/30 focus:bg-background focus:ring-2 focus:ring-primary-500/10"
                                  placeholder="01) 03/01/26"
                                />
                              </div>
                            </td>
                            <td className="w-[80px] p-2 align-top">
                              <input
                                {...register(`items.${index}.refNo.0`)}
                                className="w-full rounded-lg border border-transparent bg-transparent p-1.5 text-center text-[11px] transition-all hover:border-primary-500/10 hover:bg-primary-500/[0.02] focus:border-primary-500/30 focus:bg-background focus:ring-2 focus:ring-primary-500/10"
                                placeholder="Ref"
                              />
                            </td>
                            <td className="p-2 align-top">
                              <textarea
                                {...register(`items.${index}.description`)}
                                rows={3}
                                className="w-full resize-none rounded-xl border border-transparent bg-transparent p-1.5 text-sm uppercase leading-tight placeholder:text-muted-foreground/30 transition-all hover:border-primary-500/10 hover:bg-primary-500/[0.02] focus:border-primary-500/30 focus:bg-background focus:ring-2 focus:ring-primary-500/10"
                                placeholder="ENTER JOB DESCRIPTION HERE..."
                              />
                              <div className="mt-2 flex items-center justify-between gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const currentItem = watchedItems[index];
                                    setValue(
                                      `items.${index}`,
                                      {
                                        ...currentItem,
                                        srNoDate: [...currentItem.srNoDate, ""],
                                        refNo: [...currentItem.refNo, ""],
                                        sacHsn: [...currentItem.sacHsn, ""],
                                        quantity: [...currentItem.quantity, 0],
                                        rate: [...currentItem.rate, 0],
                                        subDescriptions: [
                                          ...(currentItem.subDescriptions ||
                                            []),
                                          "",
                                        ],
                                      } as any,
                                      { shouldDirty: true },
                                    );
                                  }}
                                  className="inline-flex items-center gap-1 rounded-full border border-primary-500/10 bg-primary-500/5 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-primary-600 transition-all hover:border-primary-500/20 hover:bg-primary-500/10"
                                >
                                  <Plus size={10} />
                                  Add Sub-Entry
                                </button>
                                <div className="flex items-center gap-2 rounded-lg bg-accent/30 px-2 py-1">
                                  <label className="text-[9px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                                    Unit:
                                  </label>
                                  <input
                                    {...register(`items.${index}.unit`)}
                                    className="w-12 rounded-md border border-transparent bg-background/80 px-1 py-0.5 text-center text-[10px] font-bold outline-none transition-all hover:border-primary-500/10 focus:border-primary-500/30 focus:ring-2 focus:ring-primary-500/10"
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="w-[100px] p-2 align-top">
                              <input
                                {...register(`items.${index}.sacHsn.0`)}
                                className="w-full rounded-lg border border-transparent bg-transparent p-1.5 text-center font-mono text-[11px] font-bold uppercase transition-all hover:border-primary-500/10 hover:bg-primary-500/[0.02] focus:border-primary-500/30 focus:bg-background focus:ring-2 focus:ring-primary-500/10"
                                placeholder="HSN"
                              />
                            </td>
                            <td className="w-[60px] p-2 align-top">
                              <DelayedInput
                                value={watchedItems[index]?.quantity?.[0] || 0}
                                onSave={(val) =>
                                  setValue(
                                    `items.${index}.quantity.0`,
                                    parseNumeric(val),
                                    { shouldDirty: true },
                                  )
                                }
                                className="w-full rounded-lg border border-transparent bg-transparent p-1.5 text-center font-mono text-[11px] font-bold transition-all hover:border-primary-500/10 hover:bg-primary-500/[0.02] focus:border-primary-500/30 focus:bg-background focus:ring-2 focus:ring-primary-500/10"
                                placeholder="Qty"
                              />
                            </td>
                            <td className="w-[100px] p-2 align-top">
                              <DelayedInput
                                value={watchedItems[index]?.rate?.[0] || 0}
                                onSave={(val) =>
                                  setValue(
                                    `items.${index}.rate.0`,
                                    parseNumeric(val),
                                    { shouldDirty: true },
                                  )
                                }
                                className="w-full rounded-lg border border-transparent bg-transparent p-1.5 text-center font-mono text-[11px] font-bold transition-all hover:border-primary-500/10 hover:bg-primary-500/[0.02] focus:border-primary-500/30 focus:bg-background focus:ring-2 focus:ring-primary-500/10"
                                placeholder="Rate"
                              />
                            </td>
                            {showTaxColumns && (
                              <>
                                <td className="p-2 align-top pr-2 text-right font-mono text-[11px] font-black">
                                  {calculations?.items[index]?.amount
                                    .reduce((a, b) => a + b, 0)
                                    .toFixed(2) || "0.00"}
                                </td>
                                {taxMode === "GST" ? (
                                  <>
                                    <td className="p-2 align-top text-right font-mono font-bold text-muted-foreground text-[10px]">
                                      {calculations?.items[index]?.cgstAmount
                                        .reduce((a, b) => a + b, 0)
                                        .toFixed(2) || "0.00"}
                                    </td>
                                    <td className="p-2 align-top text-right font-mono font-bold text-muted-foreground text-[10px]">
                                      {calculations?.items[index]?.sgstAmount
                                        .reduce((a, b) => a + b, 0)
                                        .toFixed(2) || "0.00"}
                                    </td>
                                  </>
                                ) : (
                                  <td
                                    className="p-2 align-top text-right font-mono font-bold text-muted-foreground text-[10px]"
                                    colSpan={2}
                                  >
                                    {calculations?.items[index]?.igstAmount
                                      .reduce((a, b) => a + b, 0)
                                      .toFixed(2) || "0.00"}
                                  </td>
                                )}
                                <td className="p-2 align-top text-right font-mono font-black pr-2 text-[11px] text-primary-600">
                                  {calculations?.items[index]?.totalWithGST
                                    .reduce((a, b) => a + b, 0)
                                    .toFixed(2) || "0.00"}
                                </td>
                              </>
                            )}
                            <td className="p-2 align-top text-center w-[60px]">
                              <button
                                type="button"
                                onClick={() => remove(index)}
                                className="p-2 text-red-400 hover:text-red-600 transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>

                          {/* Additional Sub-Rows (Only if more than one entry) */}
                          {watchedItems[index]?.quantity
                            .slice(1)
                            .map((_, sIdx) => {
                              const subIndex = sIdx + 1;
                              return (
                                <motion.tr
                                  key={`${field.id}-${subIndex}`}
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="border-t border-dashed border-border/40 bg-accent/[0.12] transition-colors hover:bg-accent/20"
                                >
                                  <td className="p-2">
                                    <input
                                      {...register(
                                        `items.${index}.srNoDate.${subIndex}`,
                                      )}
                                      className="w-full rounded-md border border-transparent bg-background/60 p-1.5 text-center text-[11px] transition-all hover:border-primary-500/10 focus:border-primary-500/30 focus:ring-2 focus:ring-primary-500/10"
                                      placeholder="Date"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      {...register(
                                        `items.${index}.refNo.${subIndex}`,
                                      )}
                                      className="w-full rounded-md border border-transparent bg-background/60 p-1.5 text-center text-[11px] transition-all hover:border-primary-500/10 focus:border-primary-500/30 focus:ring-2 focus:ring-primary-500/10"
                                      placeholder="Ref"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <textarea
                                      {...register(
                                        `items.${index}.subDescriptions.${sIdx}`,
                                      )}
                                      rows={1}
                                      className="w-full resize-none rounded-md border border-transparent bg-background/60 p-1.5 text-[11px] uppercase leading-tight placeholder:text-muted-foreground/30 transition-all hover:border-primary-500/10 focus:border-primary-500/30 focus:ring-2 focus:ring-primary-500/10"
                                      placeholder="Sub-entry description..."
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      {...register(
                                        `items.${index}.sacHsn.${subIndex}`,
                                      )}
                                      className="w-full rounded-md border border-transparent bg-background/60 p-1.5 text-center font-mono text-[11px] font-bold uppercase transition-all hover:border-primary-500/10 focus:border-primary-500/30 focus:ring-2 focus:ring-primary-500/10"
                                      placeholder="HSN"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <DelayedInput
                                      value={
                                        watchedItems[index]?.quantity?.[
                                          subIndex
                                        ] || 0
                                      }
                                      onSave={(val) =>
                                        setValue(
                                          `items.${index}.quantity.${subIndex}`,
                                          parseNumeric(val),
                                          { shouldDirty: true },
                                        )
                                      }
                                      className="w-full rounded-md border border-transparent bg-background/60 p-1.5 text-center font-mono text-[11px] font-bold transition-all hover:border-primary-500/10 focus:border-primary-500/30 focus:ring-2 focus:ring-primary-500/10"
                                      placeholder="Qty"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <DelayedInput
                                      value={
                                        watchedItems[index]?.rate?.[subIndex] ||
                                        0
                                      }
                                      onSave={(val) =>
                                        setValue(
                                          `items.${index}.rate.${subIndex}`,
                                          parseNumeric(val),
                                          { shouldDirty: true },
                                        )
                                      }
                                      className="w-full rounded-md border border-transparent bg-background/60 p-1.5 text-center font-mono text-[11px] font-bold transition-all hover:border-primary-500/10 focus:border-primary-500/30 focus:ring-2 focus:ring-primary-500/10"
                                      placeholder="Rate"
                                    />
                                  </td>
                                  {showTaxColumns && (
                                    <>
                                      <td className="p-2 pr-2 text-right font-mono text-[11px] font-black">
                                        {(
                                          calculations?.items[index]?.amount[
                                            subIndex
                                          ] || 0
                                        ).toFixed(2)}
                                      </td>
                                      {taxMode === "GST" ? (
                                        <>
                                          <td className="p-2 text-right font-mono font-bold text-muted-foreground text-[10px]">
                                            {(
                                              calculations?.items[index]
                                                ?.cgstAmount[subIndex] || 0
                                            ).toFixed(2)}
                                          </td>
                                          <td className="p-2 text-right font-mono font-bold text-muted-foreground text-[10px]">
                                            {(
                                              calculations?.items[index]
                                                ?.sgstAmount[subIndex] || 0
                                            ).toFixed(2)}
                                          </td>
                                        </>
                                      ) : (
                                        <td
                                          className="p-2 text-right font-mono font-bold text-muted-foreground text-[10px]"
                                          colSpan={2}
                                        >
                                          {(
                                            calculations?.items[index]?.igstAmount[
                                              subIndex
                                            ] || 0
                                          ).toFixed(2)}
                                        </td>
                                      )}
                                      <td className="p-2 text-right font-mono font-black pr-2 text-[11px] text-primary-600">
                                        {(
                                          calculations?.items[index]?.totalWithGST[
                                            subIndex
                                          ] || 0
                                        ).toFixed(2)}
                                      </td>
                                    </>
                                  )}
                                  <td className="p-2 text-center">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const currentItem = watchedItems[index];
                                        setValue(
                                          `items.${index}`,
                                          {
                                            ...currentItem,
                                            srNoDate:
                                              currentItem.srNoDate.filter(
                                                (_, i) => i !== subIndex,
                                              ),
                                            refNo: currentItem.refNo.filter(
                                              (_, i) => i !== subIndex,
                                            ),
                                            sacHsn: currentItem.sacHsn.filter(
                                              (_, i) => i !== subIndex,
                                            ),
                                            quantity:
                                              currentItem.quantity.filter(
                                                (_, i) => i !== subIndex,
                                              ),
                                            rate: currentItem.rate.filter(
                                              (_, i) => i !== subIndex,
                                            ),
                                            subDescriptions:
                                              currentItem.subDescriptions?.filter(
                                                (_, i) => i !== subIndex - 1,
                                              ),
                                          } as any,
                                          { shouldDirty: true },
                                        );
                                      }}
                                      className="p-1 text-red-400 hover:text-red-600 transition-colors"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </td>
                                </motion.tr>
                              );
                            })}
                        </React.Fragment>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* Floating Action Button & Panels */}
      <div className="fixed bottom-8 right-8 flex flex-col items-end gap-4 z-[60] print:hidden">
        {/* Header Details Panel */}
        <AnimatePresence>
          {isHeaderOpen && (
            <motion.div
              initial={{
                opacity: 0,
                scale: 0.9,
                y: 20,
                transformOrigin: "bottom right",
              }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="glass-card w-[600px] p-8 rounded-3xl shadow-2xl border border-primary-500/20 mb-2 overflow-y-auto max-h-[85vh] custom-scrollbar"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-primary-500/10 rounded-2xl">
                    <LayoutIcon size={24} className="text-primary-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">
                      Header Details
                    </h2>
                    <p className="text-xs text-muted-foreground font-medium">
                      Manage invoice metadata and customer info
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setValue("orderNumber", "");
                      setValue("orderDate", "");
                      setValue("jobsheetNo", "ATTACHED");
                      setValue("vendorCode", "");
                      setValue("customerName", "");
                      setValue("plantName", "");
                      setValue("customerGST", "");
                      setValue("customerAddress", "");
                    }}
                    className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                    title="Clear All Fields"
                  >
                    <RotateCcw size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsHeaderOpen(false)}
                    className="p-2 hover:bg-accent rounded-full transition-all hover:rotate-90"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="space-y-8">
                {/* Preset Selector Section */}
                <div className="p-6 bg-primary-500/5 rounded-3xl border border-primary-500/10 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-black text-primary-500 uppercase tracking-[0.2em]">
                      Quick Presets
                    </label>
                    {isSavingPreset ? (
                      <button
                        type="button"
                        onClick={() => setIsSavingPreset(false)}
                        className="text-[10px] font-bold text-muted-foreground hover:text-red-500 transition-colors uppercase tracking-wider"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsSavingPreset(true)}
                        className="text-[10px] font-bold text-primary-500 hover:text-primary-600 transition-colors uppercase tracking-wider flex items-center gap-1"
                      >
                        <Plus size={12} /> Save Current
                      </button>
                    )}
                  </div>

                  <AnimatePresence mode="wait">
                    {isSavingPreset ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex gap-2"
                      >
                        <input
                          autoFocus
                          placeholder="Enter preset name (e.g. RCF TROMBAY)"
                          value={newPresetName}
                          onChange={(e) =>
                            setNewPresetName(e.target.value.toUpperCase())
                          }
                          className="flex-1 bg-background border-2 border-primary-500/20 rounded-xl px-4 py-2 text-sm font-bold focus:border-primary-500 outline-none transition-all"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              if (newPresetName) {
                                savePreset({
                                  id: Date.now().toString(),
                                  name: newPresetName,
                                  customerName: watch("customerName"),
                                  plantName: watch("plantName"),
                                  customerAddress: watch("customerAddress"),
                                  customerGST: watch("customerGST"),
                                  vendorCode: watch("vendorCode"),
                                  orderNumber: watch("orderNumber"),
                                  outlineAgreement: watch("outlineAgreement"),
                                  gemSellerId: watch("gemSellerId"),
                                });
                                setNewPresetName("");
                                setIsSavingPreset(false);
                              }
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={!newPresetName}
                          onClick={() => {
                            savePreset({
                              id: Date.now().toString(),
                              name: newPresetName,
                              customerName: watch("customerName"),
                              plantName: watch("plantName"),
                              customerAddress: watch("customerAddress"),
                              customerGST: watch("customerGST"),
                              vendorCode: watch("vendorCode"),
                              orderNumber: watch("orderNumber"),
                              outlineAgreement: watch("outlineAgreement"),
                              gemSellerId: watch("gemSellerId"),
                            });
                            setNewPresetName("");
                            setIsSavingPreset(false);
                          }}
                          className="bg-primary-500 text-white px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-primary-600 transition-all shadow-lg shadow-primary-500/20"
                        >
                          Save
                        </button>
                      </motion.div>
                    ) : (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowPresetMenu(!showPresetMenu)}
                          className="w-full flex items-center justify-between bg-background hover:bg-accent border border-border rounded-2xl px-5 py-3.5 text-sm font-bold transition-all shadow-sm"
                        >
                          <div className="flex items-center gap-3">
                            <Bookmark size={18} className="text-primary-500" />
                            <span>
                              {showPresetMenu
                                ? "Choose a customer..."
                                : "Select a Preset..."}
                            </span>
                          </div>
                          <ChevronDown
                            size={18}
                            className={clsx(
                              "transition-transform duration-300",
                              showPresetMenu && "rotate-180",
                            )}
                          />
                        </button>

                        <AnimatePresence>
                          {showPresetMenu && (
                            <motion.div
                              initial={{ opacity: 0, y: 10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 10, scale: 0.95 }}
                              className="absolute bottom-full left-0 right-0 mb-3 bg-card border border-border rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] overflow-hidden z-[70] p-3 border-primary-500/10"
                            >
                              <div className="relative mb-3">
                                <Search
                                  size={14}
                                  className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                                />
                                <input
                                  autoFocus
                                  placeholder="Search presets..."
                                  value={presetSearch}
                                  onChange={(e) =>
                                    setPresetSearch(e.target.value)
                                  }
                                  className="w-full bg-accent/50 border-none rounded-2xl pl-10 pr-4 py-2.5 text-xs font-bold focus:ring-2 ring-primary-500/20 outline-none transition-all"
                                />
                              </div>

                              <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-1 pr-1">
                                {customerPresets
                                  .filter(
                                    (p) =>
                                      p.name
                                        .toLowerCase()
                                        .includes(presetSearch.toLowerCase()) ||
                                      p.customerName
                                        .toLowerCase()
                                        .includes(presetSearch.toLowerCase()),
                                  )
                                  .map((preset) => (
                                    <div
                                      key={preset.id}
                                      className="group flex items-center gap-2"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const updateData = {
                                            customerName: preset.customerName,
                                            plantName: preset.plantName,
                                            customerAddress: preset.customerAddress,
                                            customerGST: preset.customerGST,
                                            vendorCode: preset.vendorCode || "",
                                            orderNumber:
                                              preset.orderNumber ||
                                              "GEMC-511687712601789",
                                            outlineAgreement:
                                              preset.outlineAgreement ||
                                              "4600002141",
                                            gemSellerId:
                                              preset.gemSellerId ||
                                              "RXON210002099996",
                                          };

                                          Object.entries(updateData).forEach(
                                            ([key, value]) => {
                                              setValue(key as any, value, {
                                                shouldDirty: true,
                                                shouldValidate: true,
                                              });
                                            },
                                          );

                                          setShowPresetMenu(false);
                                          setPresetSearch("");
                                        }}
                                        className="flex-1 text-left px-4 py-3 hover:bg-primary-500/10 rounded-2xl transition-all"
                                      >
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-xs font-black uppercase tracking-wider text-primary-600 dark:text-primary-400">
                                            {preset.name}
                                          </span>
                                          <span className="text-[10px] font-bold text-muted-foreground truncate opacity-70">
                                            {preset.customerName}
                                          </span>
                                          {preset.customerGST && (
                                            <span className="text-[9px] font-mono text-muted-foreground/60">
                                              {preset.customerGST}
                                            </span>
                                          )}
                                        </div>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deletePreset(preset.id)}
                                        className="p-3 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all mr-1"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  ))}
                                {customerPresets.filter(
                                  (p) =>
                                    p.name
                                      .toLowerCase()
                                      .includes(presetSearch.toLowerCase()) ||
                                    p.customerName
                                      .toLowerCase()
                                      .includes(presetSearch.toLowerCase()),
                                ).length === 0 && (
                                  <div className="py-8 text-center">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                      No matching presets
                                    </p>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Form Sections */}
                <div className="space-y-10 px-2">
                  {/* Section 1: Invoice Basics */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-px flex-1 bg-border/50"></div>
                      <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em]">
                        Invoice Info
                      </span>
                      <div className="h-px flex-1 bg-border/50"></div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          Invoice Number
                        </label>
                        <input
                          {...register("billNumber")}
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-mono font-bold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          Invoice Date
                        </label>
                        <input
                          type="date"
                          value={formatDateForInput(watch("date"))}
                          onChange={(e) => setValue("date", e.target.value)}
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-bold"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Order Details */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-px flex-1 bg-border/50"></div>
                      <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em]">
                        Order Details
                      </span>
                      <div className="h-px flex-1 bg-border/50"></div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          Order Number
                        </label>
                        <input
                          {...register("orderNumber")}
                          placeholder="e.g. PO/123/2024"
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-mono"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          Order Date
                        </label>
                        <input
                          type="date"
                          value={formatDateForInput(watch("orderDate"))}
                          onChange={(e) =>
                            setValue("orderDate", e.target.value)
                          }
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          Outline Agreement
                        </label>
                        <input
                          {...register("outlineAgreement")}
                          placeholder="e.g. 460000..."
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-mono"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          GeM Seller ID
                        </label>
                        <input
                          {...register("gemSellerId")}
                          placeholder="RXON..."
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          Jobsheet No
                        </label>
                        <input
                          {...register("jobsheetNo")}
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-mono"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          Vendor Code
                        </label>
                        <input
                          {...register("vendorCode")}
                          placeholder="If applicable"
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Customer Information */}
                  <div className="space-y-4 pb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-px flex-1 bg-border/50"></div>
                      <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em]">
                        Customer Details
                      </span>
                      <div className="h-px flex-1 bg-border/50"></div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                        Customer Name
                      </label>
                      <input
                        {...register("customerName")}
                        placeholder="e.g. RASHTRIYA CHEMICALS & FERTILIZERS LTD"
                        className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all text-base font-bold uppercase"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          Plant / Unit
                        </label>
                        <input
                          {...register("plantName")}
                          placeholder="e.g. S.G. INSTRUMENT PLANT"
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-bold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                          GSTIN
                        </label>
                        <input
                          {...register("customerGST")}
                          placeholder="27AAACR..."
                          className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all font-mono font-bold uppercase"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-wider ml-1">
                        Billing Address
                      </label>
                      <textarea
                        {...register("customerAddress")}
                        rows={3}
                        placeholder="Full postal address..."
                        className="w-full bg-accent/20 border border-border/50 rounded-2xl px-4 py-3 focus:ring-4 ring-primary-500/10 focus:border-primary-500/50 transition-all resize-none font-medium leading-relaxed"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summary Panel */}
        <AnimatePresence>
          {isSummaryOpen && (
            <motion.div
              initial={{
                opacity: 0,
                scale: 0.9,
                y: 20,
                transformOrigin: "bottom right",
              }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="glass-card w-[350px] p-6 rounded-3xl shadow-2xl border border-primary-500/20 mb-2"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <FileTextIcon size={20} className="text-primary-500" />
                  Summary
                </h2>
                <button
                  type="button"
                  onClick={() => setIsSummaryOpen(false)}
                  className="p-2 hover:bg-accent rounded-full transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground font-medium">
                    Taxable Value
                  </span>
                  <span className="font-bold">
                    {formatCurrency(
                      calculations?.totals.totalTaxableValue || 0,
                    )}
                  </span>
                </div>

                {taxMode === "GST" ? (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground font-medium">
                        CGST Total
                      </span>
                      <span className="font-bold">
                        {formatCurrency(calculations?.totals.totalCGST || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground font-medium">
                        SGST Total
                      </span>
                      <span className="font-bold">
                        {formatCurrency(calculations?.totals.totalSGST || 0)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground font-medium">
                      IGST Total
                    </span>
                    <span className="font-bold">
                      {formatCurrency(calculations?.totals.totalIGST || 0)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground font-medium">
                    Grand Total
                  </span>
                  <span className="text-xl font-black text-primary-600 dark:text-primary-400">
                    {formatCurrency(calculations?.totals.grandTotal || 0)}
                  </span>
                </div>

                <div className="pt-4 border-t border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold">
                        Apply Digital Stamp
                      </span>
                      <span className="text-[10px] text-muted-foreground italic">
                        Place stamp in footer
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        {...register("showStamp")}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-accent peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                    </label>
                  </div>
                </div>

                <div className="pt-4 border-t border-border flex justify-between items-center">
                  <span className="text-lg font-bold">Grand Total</span>
                  <span className="text-2xl font-black text-primary-600 dark:text-primary-400">
                    {formatCurrency(calculations?.totals.grandTotal || 0)}
                  </span>
                </div>

                <div className="mt-6 p-4 bg-accent/30 rounded-2xl space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Amount in Words
                  </p>
                  <p className="text-xs font-bold leading-relaxed">
                    {calculations?.amountInWords || "RUPEES ZERO ONLY"}
                  </p>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                <button
                  type="button"
                  className="w-full p-3 rounded-2xl border-2 border-dashed border-border hover:border-primary-500/50 hover:bg-primary-500/5 transition-all text-sm font-bold flex items-center justify-center gap-2 group"
                >
                  <SettingsIcon
                    size={18}
                    className="group-hover:rotate-90 transition-transform"
                  />
                  Extra Charges & Notes
                </button>
                <button
                  type="button"
                  onClick={() => reset()}
                  className="w-full p-3 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-all text-sm font-bold flex items-center justify-center gap-2"
                >
                  <RotateCcw size={18} />
                  Reset Form
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3">
          {/* Header Action Button */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setIsHeaderOpen(!isHeaderOpen);
              if (isSummaryOpen) setIsSummaryOpen(false);
            }}
            className={clsx(
              "w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-300",
              isHeaderOpen
                ? "bg-primary-600 text-white"
                : "bg-white dark:bg-card text-foreground hover:bg-accent border border-border",
            )}
            title="Header Details"
          >
            <LayoutIcon size={20} />
          </motion.button>

          {/* Main FAB */}
          <button
            type="button"
            onClick={() => {
              setIsSummaryOpen(!isSummaryOpen);
              if (isHeaderOpen) setIsHeaderOpen(false);
            }}
            className={clsx(
              "w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-95 group",
              isSummaryOpen
                ? "bg-foreground text-background rotate-180"
                : "bg-primary-600 text-white hover:bg-primary-700",
            )}
          >
            {isSummaryOpen ? (
              <X size={28} />
            ) : (
              <div className="relative">
                <FileTextIcon size={28} />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white dark:border-black rounded-full" />
              </div>
            )}
          </button>
        </div>
      </div>

      <PrintPreview
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        invoice={getCalculatedInvoiceData()}
        company={companyDetails}
        onUpdateInvoice={(updates) => {
          Object.entries(updates).forEach(([key, value]) => {
            setValue(key as any, value, { shouldDirty: true });
          });
        }}
      />
    </div>
  );
};
