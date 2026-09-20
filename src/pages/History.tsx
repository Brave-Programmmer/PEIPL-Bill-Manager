import React, { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  Eye,
  FileText,
  Calendar,
  User,
  FolderOpen,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useInvoiceStore } from "../store/useInvoiceStore";
import { formatCurrency, formatDate } from "../utils/formatters";
import { useNavigate } from "react-router-dom";
import type { Invoice } from "../utils/types";
import { migrateOldInvoice } from "../utils/migration";

interface ScannedInvoice {
  path: string;
  folder: string;
  fileName: string;
  content: Invoice;
  mtime: Date;
}

export const History: React.FC = () => {
  const { scanPaths, setCurrentInvoice } = useInvoiceStore();
  const [scannedInvoices, setScannedInvoices] = useState<ScannedInvoice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const handleScan = async () => {
    if (window.electron && scanPaths.length > 0) {
      setIsScanning(true);
      try {
        const results = await window.electron.scanInvoices(scanPaths);
        // Apply migration to each scanned invoice to ensure correct totals
        const migratedResults = results.map((item: any) => ({
          ...item,
          content: migrateOldInvoice(item.content),
        }));
        setScannedInvoices(migratedResults);
      } catch (err) {
        console.error("Scan failed:", err);
      } finally {
        setIsScanning(false);
      }
    }
  };

  useEffect(() => {
    handleScan();
  }, [scanPaths]);

  const toggleFolder = (folder: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folder]: !prev[folder],
    }));
  };

  // Group invoices by folder
  const groupedInvoices = useMemo(() => {
    const groups: Record<string, ScannedInvoice[]> = {};

    // Filter by search query first
    const filtered = scannedInvoices.filter((item) => {
      const q = searchQuery.toLowerCase();
      return (
        item.content.billNumber.toLowerCase().includes(q) ||
        item.content.customerName.toLowerCase().includes(q) ||
        (item.content.customerGST &&
          item.content.customerGST.toLowerCase().includes(q))
      );
    });

    filtered.forEach((item) => {
      if (!groups[item.folder]) {
        groups[item.folder] = [];
      }
      groups[item.folder].push(item);
    });

    // Sort invoices inside each folder by bill number (natural sort)
    Object.keys(groups).forEach((folder) => {
      groups[folder].sort((a, b) => {
        return a.content.billNumber.localeCompare(
          b.content.billNumber,
          undefined,
          {
            numeric: true,
            sensitivity: "base",
          },
        );
      });
    });

    return groups;
  }, [scannedInvoices, searchQuery]);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoice History</h1>
          <p className="text-muted-foreground mt-1">
            Manage and track all your generated invoices.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2 bg-primary-500/10 text-primary-600 rounded-xl text-sm font-bold hover:bg-primary-500/20 transition-all disabled:opacity-50"
          >
            <RefreshCw size={18} className={isScanning ? "animate-spin" : ""} />
            {isScanning ? "Scanning..." : "Refresh Scan"}
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-accent rounded-xl text-sm font-bold hover:bg-accent/80 transition-all">
            <Filter size={18} />
            Filter
          </button>
        </div>
      </div>

      <div className="glass-card rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="relative">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={20}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Invoice No, Customer Name or GSTIN..."
              className="w-full bg-accent/30 border-none rounded-2xl pl-12 pr-4 py-4 text-sm focus:ring-2 ring-primary-500/20 transition-all"
            />
          </div>
        </div>

        <div className="p-6 space-y-4">
          {Object.entries(groupedInvoices).length === 0 ? (
            <div className="py-20 text-center">
              <div className="flex flex-col items-center gap-4 text-muted-foreground">
                <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center">
                  <FileText size={32} />
                </div>
                <p className="text-lg font-medium">
                  No invoices found in scan paths
                </p>
                <button
                  onClick={() => navigate("/settings")}
                  className="bg-primary-500 text-white px-6 py-2 rounded-xl font-bold"
                >
                  Configure Scan Paths
                </button>
              </div>
            </div>
          ) : (
            Object.entries(groupedInvoices).map(([folder, invoices]) => (
              <div key={folder} className="space-y-2">
                <button
                  onClick={() => toggleFolder(folder)}
                  className="w-full flex items-center gap-3 p-3 bg-accent/20 hover:bg-accent/40 rounded-2xl transition-all border border-border/50 group"
                >
                  <ChevronRight
                    size={18}
                    className={clsx(
                      "text-muted-foreground transition-transform duration-300",
                      expandedFolders[folder] && "rotate-90",
                    )}
                  />
                  <FolderOpen size={20} className="text-primary-500" />
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-bold truncate max-w-md">
                      {folder.split(/[\\/]/).pop()}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-lg">
                      {folder}
                    </span>
                  </div>
                  <span className="ml-auto bg-primary-500/10 text-primary-600 text-[10px] font-black px-2 py-0.5 rounded-full">
                    {invoices.length}
                  </span>
                </button>

                <AnimatePresence>
                  {expandedFolders[folder] && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-2">
                        {invoices.map((item, i) => (
                          <motion.div
                            key={item.path}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.02 }}
                            className="glass-card p-5 rounded-2xl border border-border/50 hover:border-primary-500/30 transition-all group relative overflow-hidden"
                          >
                            <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => {
                                  setCurrentInvoice({
                                    ...item.content,
                                    filePath: item.path // Ensure path is passed to editor
                                  });
                                  navigate("/editor");
                                }}
                                className="p-2 bg-primary-500 text-white rounded-xl shadow-lg shadow-primary-500/20 hover:scale-110 transition-transform"
                              >
                                <Eye size={16} />
                              </button>
                            </div>

                            <div className="flex items-start gap-3 mb-4">
                              <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-600 flex items-center justify-center shrink-0">
                                <FileText size={20} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-sm truncate">
                                  {item.content.billNumber}
                                </p>
                                <div className="flex flex-col mt-1 gap-1">
                                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium">
                                    <Calendar size={12} />
                                    {formatDate(item.content.date)}
                                  </p>
                                  <p className="text-[10px] text-primary-600 font-black uppercase tracking-widest bg-primary-500/5 px-2 py-0.5 rounded-md inline-block self-start">
                                    {item.content.plantName || "N/A"}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <User
                                  size={14}
                                  className="text-muted-foreground shrink-0"
                                />
                                <span className="text-xs font-bold truncate text-foreground/80">
                                  {item.content.customerName}
                                </span>
                              </div>

                              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                                <div className="flex flex-col">
                                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                                    Grand Total
                                  </span>
                                  <span className="text-base font-black text-primary-600 dark:text-primary-400">
                                    {formatCurrency(item.content.grandTotal)}
                                  </span>
                                </div>
                                <span
                                  className={clsx(
                                    "inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest",
                                    item.content.status === "paid"
                                      ? "bg-emerald-500/10 text-emerald-600"
                                      : "bg-amber-500/10 text-amber-600",
                                  )}
                                >
                                  {item.content.status}
                                </span>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const clsx = (...classes: any[]) => classes.filter(Boolean).join(" ");
