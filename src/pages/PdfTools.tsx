import React from "react";
import { PDFDocument } from "pdf-lib";
import {
  ArrowLeft,
  CheckCircle2,
  FileArchive,
  FileUp,
  Info,
  Sparkles,
  X,
  RotateCcw,
  Download,
  AlertTriangle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { MitraLoadingOverlay } from "../components/MitraLoadingOverlay";

type SelectedPdf = {
  path: string;
  fileName: string;
  file?: File;
  size?: number;
};

type CompressionResult = {
  originalBytes?: number;
  compressedBytes?: number;
  path?: string;
};

const MAX_BROWSER_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const formatBytes = (value?: number) => {
  if (!value || value <= 0) return "0 B";

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const getReductionPercentage = (
  original?: number,
  compressed?: number
) => {
  if (!original || !compressed || original <= 0) return 0;

  return Math.max(
    0,
    Math.round(((original - compressed) / original) * 100)
  );
};

const isPdfFile = (file: File) => {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
};

export const PdfTools: React.FC = () => {
  const [selectedPdf, setSelectedPdf] =
    React.useState<SelectedPdf | null>(null);

  const [isWorking, setIsWorking] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");

  const [result, setResult] =
    React.useState<CompressionResult | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const clearMessages = () => {
    setStatus("");
    setError("");
    setResult(null);
  };

  const choosePdf = async () => {
    clearMessages();

    try {
      if (window.electron?.selectPdf) {
        const file = await window.electron.selectPdf();

        if (file) {
          setSelectedPdf({
            ...file,
          });
        }

        return;
      }

      fileInputRef.current?.click();
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "Unable to select the PDF."
      );
    }
  };

  const handleBrowserFile = (file?: File) => {
    clearMessages();

    if (!file) return;

    if (!isPdfFile(file)) {
      setError("Please choose a valid PDF file.");
      return;
    }

    if (file.size > MAX_BROWSER_FILE_SIZE) {
      setError(
        `This browser version supports PDFs up to ${formatBytes(
          MAX_BROWSER_FILE_SIZE
        )}.`
      );
      return;
    }

    setSelectedPdf({
      path: file.name,
      fileName: file.name,
      file,
      size: file.size,
    });
  };

  const removeSelectedPdf = () => {
    if (isWorking) return;

    setSelectedPdf(null);
    clearMessages();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const downloadBrowserPdf = (
    compressed: Uint8Array,
    fileName: string
  ) => {
    const pdfBuffer = new ArrayBuffer(compressed.byteLength);
    new Uint8Array(pdfBuffer).set(compressed);
    const blob = new Blob([pdfBuffer], {
      type: "application/pdf",
    });

    const downloadUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    link.remove();

    // Give the browser time to start the download.
    window.setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
    }, 1000);

    return fileName;
  };

  const compressPdf = async () => {
    if (!selectedPdf) return;

    setIsWorking(true);
    setError("");
    setStatus("");
    setResult(null);

    try {
      /*
       * Desktop implementation.
       *
       * This is preferred because a native desktop compressor
       * can perform substantially better compression than
       * simply rewriting the PDF with pdf-lib.
       */
      if (window.electron?.compressPdf) {
        const response = await window.electron.compressPdf({
          filePath: selectedPdf.path,
        });

        if (!response?.success) {
          if (!response?.canceled) {
            setError(
              response?.error ||
                "Mitra could not compress this PDF."
            );
          }

          return;
        }

        setResult({
          originalBytes:
            response.originalBytes ?? selectedPdf.size,
          compressedBytes: response.compressedBytes,
          path: response.path,
        });

        setStatus(
          response.path
            ? `Compressed PDF saved to ${response.path}`
            : "PDF compression completed successfully."
        );

        return;
      }

      /*
       * Browser fallback.
       *
       * pdf-lib can optimize the PDF structure, but it cannot
       * perform image-heavy compression like Ghostscript.
       */
      if (!selectedPdf.file) {
        setError(
          "PDF Tools are unavailable in this browser session. Open the desktop app or choose a local PDF file."
        );

        return;
      }

      const source = await selectedPdf.file.arrayBuffer();

      const pdfDocument = await PDFDocument.load(source);

      const compressed = await pdfDocument.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 50,
      });

      const originalBytes = selectedPdf.file.size;
      const compressedBytes = compressed.length;

      const outputName = `${selectedPdf.fileName.replace(
        /\.pdf$/i,
        ""
      )}-compressed.pdf`;

      downloadBrowserPdf(compressed, outputName);

      setResult({
        originalBytes,
        compressedBytes,
      });

      if (compressedBytes < originalBytes) {
        const saved = getReductionPercentage(
          originalBytes,
          compressedBytes
        );

        setStatus(
          `Compressed PDF downloaded as ${outputName}. Saved ${saved}% of the original size.`
        );
      } else {
        setStatus(
          `A new optimized copy was downloaded as ${outputName}. The PDF was already highly optimized, so the file size did not decrease.`
        );
      }
    } catch (compressionError) {
      console.error("PDF compression failed:", compressionError);

      setError(
        compressionError instanceof Error
          ? compressionError.message
          : "PDF compression failed. Please try another PDF."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const originalSize = result?.originalBytes;
  const compressedSize = result?.compressedBytes;

  const savedPercentage = getReductionPercentage(
    originalSize,
    compressedSize
  );

  const actuallySmaller =
    !!originalSize &&
    !!compressedSize &&
    compressedSize < originalSize;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-16">
      <MitraLoadingOverlay
        visible={isWorking}
        message="Mitra is compressing your PDF..."
        detail="Optimizing the document and preparing your smaller copy."
      />

      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          to="/"
          aria-label="Back to Dashboard"
          className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft size={20} />
        </Link>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-600">
              Mitra's document desk
            </p>

            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              PDF
            </span>
          </div>

          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">
            PDF Tools
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Compress existing PDFs into smaller copies for sharing,
            uploading, or storing. Your original file is never modified.
          </p>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        {/* Compression card */}
        <section className="glass-card overflow-hidden rounded-[30px] border border-amber-500/15 shadow-xl shadow-slate-900/5">
          <div className="p-6 sm:p-7">
            {/* Card heading */}
            <div className="mb-7 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                <FileArchive size={23} />
              </div>

              <div>
                <h2 className="text-lg font-black">
                  Compress a PDF
                </h2>

                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Reduce the file size while keeping your original PDF
                  untouched.
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) =>
                handleBrowserFile(event.target.files?.[0])
              }
            />

            {/* Dropzone / picker */}
            {!selectedPdf ? (
              <button
                type="button"
                onClick={() => void choosePdf()}
                disabled={isWorking}
                className="group flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/50 px-5 py-10 text-center transition hover:border-amber-500 hover:bg-amber-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-amber-600 shadow-sm transition group-hover:scale-105 dark:bg-slate-900">
                  <FileUp size={24} />
                </div>

                <span className="text-sm font-black text-amber-950 dark:text-amber-100">
                  Choose a PDF
                </span>

                <span className="mt-1 text-xs text-amber-800/70 dark:text-amber-200/60">
                  Select a PDF from your computer
                </span>

                <span className="mt-4 rounded-full bg-white/80 px-3 py-1 text-[10px] font-bold text-muted-foreground dark:bg-slate-900/60">
                  PDF files only
                </span>
              </button>
            ) : (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                    <CheckCircle2 size={21} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-emerald-950 dark:text-emerald-100">
                      {selectedPdf.fileName}
                    </p>

                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {selectedPdf.size
                        ? formatBytes(selectedPdf.size)
                        : "PDF document"}
                      {selectedPdf.path &&
                        ` • ${selectedPdf.path}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={removeSelectedPdf}
                    disabled={isWorking}
                    aria-label="Remove selected PDF"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-white hover:text-red-600 dark:hover:bg-slate-900"
                  >
                    <X size={16} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void choosePdf()}
                  disabled={isWorking}
                  className="mt-4 flex items-center gap-2 text-xs font-black text-emerald-700 transition hover:text-emerald-900 dark:text-emerald-300"
                >
                  <RotateCcw size={13} />
                  Choose another PDF
                </button>
              </div>
            )}

            {/* Compress button */}
            <button
              type="button"
              onClick={() => void compressPdf()}
              disabled={!selectedPdf || isWorking}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-black text-amber-300 shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-amber-100 dark:text-slate-950 dark:hover:bg-amber-200"
            >
              <FileArchive size={17} />
              {isWorking
                ? "Compressing PDF..."
                : "Compress and save copy"}
            </button>

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
              >
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0"
                />
                <span>{error}</span>
              </div>
            )}

            {/* Status */}
            {status && !error && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold leading-relaxed text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
                {status}
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                    Compression result
                  </p>

                  {actuallySmaller && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      {savedPercentage}% smaller
                    </span>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-accent/50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                      Original
                    </p>

                    <p className="mt-1 text-lg font-black">
                      {formatBytes(originalSize)}
                    </p>
                  </div>

                  <div
                    className={`rounded-2xl p-4 ${
                      actuallySmaller
                        ? "bg-emerald-500/10"
                        : "bg-amber-500/10"
                    }`}
                  >
                    <p
                      className={`text-[10px] font-black uppercase tracking-wider ${
                        actuallySmaller
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }`}
                    >
                      New copy
                    </p>

                    <p
                      className={`mt-1 text-lg font-black ${
                        actuallySmaller
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }`}
                    >
                      {formatBytes(compressedSize)}
                    </p>
                  </div>
                </div>

                {!actuallySmaller &&
                  originalSize &&
                  compressedSize && (
                    <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                      <Info
                        size={15}
                        className="mt-0.5 shrink-0"
                      />
                      <span>
                        This PDF was already well optimized. The
                        browser optimizer could not reduce its size
                        further.
                      </span>
                    </div>
                  )}

                {result.path && (
                  <div className="mt-3 flex items-center gap-2 rounded-2xl bg-accent/50 p-3 text-xs">
                    <Download
                      size={15}
                      className="shrink-0 text-primary"
                    />
                    <span className="truncate font-semibold">
                      Saved to: {result.path}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Mitra panel */}
        <section className="rounded-[30px] border border-primary/15 bg-primary/5 p-6 sm:p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles
                className="text-primary"
                size={20}
              />
            </div>

            <div>
              <h2 className="font-black">Ask Mitra</h2>
              <p className="text-xs text-muted-foreground">
                Your document assistant
              </p>
            </div>
          </div>

          <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
              <p>
                Need a calculation? Try:
              </p>

              <p className="mt-2 font-black text-foreground">
                “Calculate 18% of 125000”
              </p>
            </div>

            <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
              <p>
                You can also ask Mitra about:
              </p>

              <ul className="mt-3 space-y-2 text-xs">
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  Bill totals and GST calculations
                </li>

                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  Pending GeM uploads
                </li>

                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  Invoice history
                </li>

                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  PDF preparation
                </li>
              </ul>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-primary/10 bg-white/60 p-4 text-xs dark:bg-slate-900/40">
              <Info
                size={16}
                className="mt-0.5 shrink-0 text-primary"
              />

              <p>
                PDF compression always creates a new copy. Your
                original document remains untouched.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Information section */}
      <section className="rounded-[28px] border bg-card/60 p-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <p className="text-xs font-black">
              Original stays safe
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Mitra never overwrites the PDF you selected.
            </p>
          </div>

          <div>
            <p className="text-xs font-black">
              Desktop compression
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The desktop app can use its native PDF compression
              pipeline.
            </p>
          </div>

          <div>
            <p className="text-xs font-black">
              Browser fallback
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Browser mode optimizes the PDF structure using
              pdf-lib.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PdfTools;

