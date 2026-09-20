import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  FilePlus2,
  History,
  MessageCircle,
  ArrowUpRight,
  Send,
  Settings2,
  Sparkles,
  Upload,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useInvoiceStore } from "../store/useInvoiceStore";

interface CompanionMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
}

type NetworkStatus = "checking" | "online" | "offline";

interface CompanionSettings {
  apiKey?: string;
  model?: string;
  displayName?: string;
  useOnline?: boolean;
  voiceEnabled?: boolean;
}

interface OnlineError {
  prompt: string;
  message: string;
}

export const COMPANION_SETTINGS_EVENT = "peipl-companion-settings-changed";

interface CompanionAssistantProps {
  compact?: boolean;
}

const STORAGE_KEY = "peipl-companion-settings";
const MESSAGE_KEY = "peipl-companion-messages";
const GREETING_KEY = "peipl-companion-last-greeting";
const DEFAULT_MODEL = "openrouter/free";
const DEFAULT_API_KEY = "";

const createMessage = (
  role: CompanionMessage["role"],
  content: string,
): CompanionMessage => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
});

const readStored = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const calculateExpression = (rawInput: string): string | null => {
  const input = rawInput
    .toLowerCase()
    .replace(/^(calculate|compute|what is|what's)\s+/, "")
    .replace(/\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/");
  const percentMatch = input.match(/^(\d+(?:\.\d+)?)%of(\d+(?:\.\d+)?)$/);
  if (percentMatch) {
    const result = (Number(percentMatch[1]) / 100) * Number(percentMatch[2]);
    return `${percentMatch[1]}% of ${percentMatch[2]} = ${result.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  if (!/^[\d()+\-*/%.^]+$/.test(input) || !/\d/.test(input)) return null;

  const tokens = input.match(/\d*\.?\d+|[()+\-*/%.^]/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];
  const parseExpression = (): number => {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const operator = consume();
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parsePower();
    while (["*", "/", "%"].includes(peek() ?? "")) {
      const operator = consume();
      const right = parsePower();
      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }
    return value;
  };
  const parsePower = (): number => {
    let value = parseFactor();
    if (peek() === "^") {
      consume();
      value = value ** parsePower();
    }
    return value;
  };
  const parseFactor = (): number => {
    if (peek() === "-") {
      consume();
      return -parseFactor();
    }
    if (peek() === "(") {
      consume();
      const value = parseExpression();
      if (consume() !== ")") throw new Error("Unclosed expression");
      return value;
    }
    const value = Number(consume());
    if (!Number.isFinite(value)) throw new Error("Invalid number");
    return value;
  };

  try {
    const result = parseExpression();
    if (position !== tokens.length || !Number.isFinite(result)) return null;
    return `${rawInput.trim()} = ${result.toLocaleString("en-IN", { maximumFractionDigits: 6 })}`;
  } catch {
    return null;
  }
};

const getLocalReply = (input: string, billCount: number, currentPath: string) => {
  const text = input.toLowerCase();
  const calculation = calculateExpression(input);
  if (calculation) return `Calculator result: ${calculation}`;
  const pendingHint = billCount === 0
    ? "I do not see saved invoices yet. Start with a new bill or scan your folders in Settings."
    : `You have ${billCount} saved invoice${billCount === 1 ? "" : "s"} in this workspace.`;

  if (text.includes("gem") || text.includes("upload")) {
    return "GeM time. Use GeM Upload from the sidebar, choose a pending bill, then I’ll stay nearby while you match the order and review the fields.";
  }
  if (text.includes("pending") || text.includes("bill") || text.includes("invoice")) {
    return `${pendingHint} On the Dashboard, switch between Pending and All bills to focus the list. You are currently on ${currentPath === "/" ? "the dashboard" : currentPath.replace("/", "")}.`;
  }
  if (text.includes("history") || text.includes("saved")) {
    return "Invoice History is the quickest place to reopen a saved bill. I can take you there whenever you are ready.";
  }
  if (text.includes("pdf") || text.includes("compress") || text.includes("convert") || text.includes("print")) {
    return "I can help with PDFs. Use PDF Tools to compress an existing PDF, or open an invoice and choose Preview & Print to create a PDF from it.";
  }
  if (text.includes("next") || text.includes("status") || text.includes("today")) {
    if (billCount === 0) return "Your next move is simple: create a new bill or configure the scan folders in Settings so I can help you work from real invoice data.";
    return `Your next move is to review the Dashboard pending list, then send the bills that are ready through GeM. I can see ${billCount} saved invoice${billCount === 1 ? "" : "s"} in this workspace.`;
  }
  if (text.includes("help") || text.includes("what can") || text.includes("hello") || text.includes("hi")) {
    return "I’m Mitra, your billing sidekick. Ask me about pending bills, GeM uploads, or invoice history, or use one of the quick actions below.";
  }
  return "I can help with bills, GeM uploads, invoice history, and quick navigation. Try asking: ‘What should I do next?’";
};

const formatContext = (history: ReturnType<typeof useInvoiceStore.getState>["history"]) =>
  history.slice(0, 8).map((invoice) => ({
    billNumber: invoice.billNumber,
    customer: invoice.customerName,
    plant: invoice.plantName,
    amount: invoice.grandTotal,
    status: invoice.status,
    gemUploaded: Boolean(invoice.gemUploaded),
  }));

const routeLabel = (pathname: string) => {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/editor") return "Invoice Editor";
  if (pathname === "/gem-upload") return "GeM Upload";
  if (pathname === "/history") return "Invoice History";
  if (pathname === "/settings") return "Settings";
  return "PEIPL BILL";
};

export const CompanionAssistant: React.FC<CompanionAssistantProps> = ({ compact = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const history = useInvoiceStore((state) => state.history);
  const companyDetails = useInvoiceStore((state) => state.companyDetails);
  const currentInvoice = useInvoiceStore((state) => state.currentInvoice);
  const scanPaths = useInvoiceStore((state) => state.scanPaths);
  const gemPaths = useInvoiceStore((state) => state.gemPaths);
  const setCurrentInvoice = useInvoiceStore((state) => state.setCurrentInvoice);
  const [isOpen, setIsOpen] = React.useState(false);
  const [hasNewGreeting, setHasNewGreeting] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"chat" | "briefing">("chat");
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [isThinking, setIsThinking] = React.useState(false);
  const [apiKey, setApiKey] = React.useState(() =>
    readStored<CompanionSettings>(STORAGE_KEY, {}).apiKey ?? DEFAULT_API_KEY,
  );
  const [model, setModel] = React.useState(() =>
    readStored<CompanionSettings>(STORAGE_KEY, {}).model ?? DEFAULT_MODEL,
  );
  const [displayName, setDisplayName] = React.useState(() =>
    readStored<CompanionSettings>(STORAGE_KEY, {}).displayName?.trim() || "Aarathi",
  );
  const [useOnline, setUseOnline] = React.useState(() =>
    readStored<CompanionSettings>(STORAGE_KEY, {}).useOnline ?? true,
  );
  const [voiceEnabled, setVoiceEnabled] = React.useState(() =>
    readStored<CompanionSettings>(STORAGE_KEY, {}).voiceEnabled ?? false,
  );
  const [networkStatus, setNetworkStatus] = React.useState<NetworkStatus>("checking");
  const [onlineError, setOnlineError] = React.useState<OnlineError | null>(null);
  const [messages, setMessages] = React.useState<CompanionMessage[]>(() =>
    readStored<CompanionMessage[]>(MESSAGE_KEY, [
      createMessage(
        "assistant",
        "Hi, I’m Mitra. I can keep an eye on your billing flow and help you decide what to do next.",
      ),
    ]),
  );
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    window.localStorage.setItem(MESSAGE_KEY, JSON.stringify(messages.slice(-20)));
  }, [messages]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isThinking]);

  React.useEffect(() => {
    const greetingTimer = window.setTimeout(() => {
      const today = new Date().toISOString().slice(0, 10);
      if (window.localStorage.getItem(GREETING_KEY) === today) return;
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
      setMessages((current) => [
        ...current,
        createMessage(
          "assistant",
          `${timeGreeting}, ${displayName || "there"}. Mitra is ready to help with today's billing work. Ask me for a briefing, a pending-bill check, or a GeM next step.`,
        ),
      ]);
      setHasNewGreeting(true);
      window.localStorage.setItem(GREETING_KEY, today);
    }, 0);
    return () => window.clearTimeout(greetingTimer);
  }, [displayName]);

  const checkConnectivity = React.useCallback(async () => {
    if (!navigator.onLine) {
      setNetworkStatus("offline");
      return false;
    }

    setNetworkStatus("checking");
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      const reachable = response.ok;
      setNetworkStatus(reachable ? "online" : "offline");
      return reachable;
    } catch {
      setNetworkStatus("offline");
      return false;
    }
  }, [apiKey]);

  React.useEffect(() => {
    const initialCheck = window.setTimeout(() => {
      void checkConnectivity();
    }, 0);
    const handleOnline = () => void checkConnectivity();
    const handleOffline = () => setNetworkStatus("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkConnectivity]);

  const persistSettings = (updates: Partial<CompanionSettings>) => {
    const nextSettings: CompanionSettings = {
      apiKey,
      model,
      displayName,
      useOnline,
      voiceEnabled,
      ...updates,
    };
    setApiKey(nextSettings.apiKey ?? "");
    setModel(nextSettings.model ?? DEFAULT_MODEL);
    setDisplayName(nextSettings.displayName ?? "");
    setUseOnline(nextSettings.useOnline ?? true);
    setVoiceEnabled(nextSettings.voiceEnabled ?? false);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...nextSettings, model: nextSettings.model || DEFAULT_MODEL }),
    );
    void window.electron?.setStoreValue("displayName", nextSettings.displayName?.trim() || "Aarathi");
    window.dispatchEvent(
      new CustomEvent(COMPANION_SETTINGS_EVENT, {
        detail: { displayName: nextSettings.displayName ?? "" },
      }),
    );
  };

  const speak = (content: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.rate = 1.02;
    utterance.pitch = 1.04;
    window.speechSynthesis.speak(utterance);
  };

  const openRoute = (path: string) => {
    if (path === "/editor") setCurrentInvoice(null);
    navigate(path);
    setIsOpen(false);
  };

  const askOnline = async (conversation: CompanionMessage[]) => {
    const invoiceContext = formatContext(history);
    const activeInvoiceContext = currentInvoice
      ? {
        billNumber: currentInvoice.billNumber,
        customer: currentInvoice.customerName,
        amount: currentInvoice.grandTotal,
        orderNumber: currentInvoice.orderNumber,
        gemUploaded: Boolean(currentInvoice.gemUploaded),
      }
      : null;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.origin,
        "X-Title": "PEIPL BILL Mitra",
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are Mitra, the personal billing companion inside PEIPL BILL. The company is ${companyDetails.name || "the current company"}. Address the operator as ${displayName || "the billing operator"}. Be energetic, warm, and practical, but never verbose. Answer in 2-5 short paragraphs or bullets. Start with the direct answer, then give the safest next action. You can explain invoices, GST totals, pending work, invoice history, and the GeM upload flow. Never claim to have performed an action, accessed a website, or verified a bill unless the app explicitly reports it. If information is missing, say exactly what is missing. Prefer specific bill numbers and customer names from the context. Current screen: ${routeLabel(location.pathname)}. Saved invoice count: ${history.length}. Invoice scan folders configured: ${scanPaths.length > 0}. GeM folders configured: ${gemPaths.length > 0}. Active invoice context: ${JSON.stringify(activeInvoiceContext)}. Recent invoice context: ${JSON.stringify(invoiceContext)}`,
          },
          ...conversation.slice(-8).map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content,
          })),
        ],
        temperature: 0.35,
        max_tokens: 450,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(errorPayload?.error?.message || `OpenRouter returned ${response.status}`);
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    setNetworkStatus("online");
    return payload.choices?.[0]?.message?.content?.trim() || "I didn’t get a useful answer back. Try the local helper or a quick action.";
  };

  const submit = async (prompt = input) => {
    const trimmed = prompt.trim();
    if (!trimmed || isThinking) return;
    const userMessage = createMessage("user", trimmed);
    const nextConversation = [...messages, userMessage];
    setMessages(nextConversation);
    setActiveTab("chat");
    setInput("");
    setIsThinking(true);
    setOnlineError(null);

    try {
      const isOnlineEnabled = useOnline && Boolean(apiKey);
      const isReachable = networkStatus === "online"
        || (networkStatus === "checking" && await checkConnectivity());
      const shouldUseOnline = isOnlineEnabled && isReachable;
      const response = shouldUseOnline
        ? await askOnline(nextConversation)
        : getLocalReply(trimmed, history.length, location.pathname);
      setMessages((current) => [...current, createMessage("assistant", response)]);
      if (voiceEnabled) speak(response);
    } catch (error) {
      setNetworkStatus("offline");
      setOnlineError({
        prompt: trimmed,
        message: error instanceof Error ? error.message : "OpenRouter could not answer",
      });
      setMessages((current) => [
        ...current,
        createMessage(
          "assistant",
          `${getLocalReply(trimmed, history.length, location.pathname)} I couldn’t reach the online model, so I stayed local.`,
        ),
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const quickActions = [
    { label: "New bill", icon: FilePlus2, path: "/editor" },
    { label: "GeM upload", icon: Upload, path: "/gem-upload" },
    { label: "History", icon: History, path: "/history" },
    { label: "PDF tools", icon: FileText, path: "/pdf-tools" },
  ];

  const quickPrompts = ["What should I do next?", "Calculate 18% of 125000", "How does GeM look?", "Help with PDF compression"];
  const pendingCount = history.filter((invoice) => !invoice.gemUploaded).length;
  const companyName = companyDetails.name?.trim() || "your company";
  const greeting = displayName
    ? `Ready when you are, ${displayName}.`
    : `Ready for the next move at ${companyName}.`;
  const networkLabel = networkStatus === "online"
    ? "Online AI ready"
    : networkStatus === "checking"
      ? "Checking connection"
      : "Offline helper ready";
  const networkColor = networkStatus === "online"
    ? "bg-emerald-500"
    : networkStatus === "checking"
      ? "bg-amber-500"
      : "bg-slate-400";
  const rootClass = compact ? "relative z-[300]" : "fixed bottom-5 right-5 z-[300]";
  const panelPosition = compact ? "top-[calc(100%+12px)]" : "bottom-16";
  const dayPart = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  const nextAction = pendingCount > 0
    ? `Review ${pendingCount === 1 ? "your pending bill" : "your pending bills"} on the Dashboard.`
    : history.length === 0
      ? "Create your first invoice or configure scan folders in Settings."
      : "Your workspace is clear. Create a new bill when you are ready.";

  return (
    <div className={rootClass}>
      <AnimatePresence mode="wait">
        {isOpen && (
          <motion.section
            key="companion-panel"
            initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={`absolute ${panelPosition} right-0 z-[400] flex h-[min(650px,calc(100vh-110px))] max-h-[calc(100vh-24px)] w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] border border-amber-200/80 bg-[#fffaf2] text-slate-900 shadow-2xl shadow-amber-950/20 dark:border-amber-900/50 dark:bg-[#1d1a17] dark:text-amber-50`}
            aria-label="Mitra personal companion"
          >
            <div className="relative overflow-hidden border-b border-amber-200/70 bg-[#f5b544] px-5 pb-5 pt-4 dark:border-amber-900/60 dark:bg-[#a86712]">
              <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full border-[18px] border-white/20" />
              <div className="relative flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-amber-300 shadow-lg">
                    <Sparkles size={21} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-950/60">Your companion</p>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black tracking-tight text-slate-950">Mitra</h2>
                      <span className={`h-2 w-2 rounded-full ${networkColor}`} title={networkLabel} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => { setMessages([createMessage("assistant", "Fresh start. I’m ready for the next billing move.")]); setIsSettingsOpen(false); }} aria-label="Clear companion chat" title="Clear chat" className="rounded-xl p-2 text-slate-950/70 transition hover:bg-white/20 hover:text-slate-950">
                    <Sparkles size={16} />
                  </button>
                  <button type="button" onClick={() => setIsOpen(false)} aria-label="Close companion" className="rounded-xl p-2 text-slate-950/70 transition hover:bg-white/20 hover:text-slate-950">
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div className="relative mt-4 flex items-center justify-between gap-3">
                <p className="max-w-[220px] text-sm font-medium leading-relaxed text-slate-950/75">{dayPart}, {displayName || "there"}. {greeting} {pendingCount > 0 ? `${pendingCount} bill${pendingCount === 1 ? "" : "s"} may need attention.` : "Your workspace is looking tidy."}</p>
                <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-950/60">{networkLabel}</span>
              </div>
            </div>

            <div className="border-b border-amber-200/70 px-4 pt-3 dark:border-amber-900/60">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-amber-100/70 p-1 dark:bg-amber-950/50">
                <button type="button" onClick={() => setActiveTab("chat")} className={`rounded-lg px-3 py-2 text-xs font-black transition ${activeTab === "chat" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-amber-100" : "text-amber-900/60 hover:text-amber-950 dark:text-amber-100/60 dark:hover:text-amber-100"}`}><MessageCircle size={13} className="mr-1.5 inline" />Chat</button>
                <button type="button" onClick={() => setActiveTab("briefing")} className={`rounded-lg px-3 py-2 text-xs font-black transition ${activeTab === "briefing" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-amber-100" : "text-amber-900/60 hover:text-amber-950 dark:text-amber-100/60 dark:hover:text-amber-100"}`}><ClipboardCheck size={13} className="mr-1.5 inline" />Briefing</button>
              </div>
            </div>

            {activeTab === "briefing" ? (
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 custom-scrollbar">
                <div className="rounded-2xl bg-slate-900 p-4 text-white dark:bg-amber-100 dark:text-slate-950">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] opacity-60">Your next move</span>
                    <Zap size={16} className="text-amber-300 dark:text-amber-700" />
                  </div>
                  <p className="text-lg font-black leading-snug">{nextAction}</p>
                  <button type="button" onClick={() => openRoute(pendingCount > 0 ? "/" : "/editor")} className="mt-4 inline-flex items-center gap-1.5 text-xs font-black text-amber-300 underline underline-offset-4 dark:text-amber-700">Open workspace <ArrowUpRight size={14} /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-amber-200 bg-white p-3 dark:border-amber-900/60 dark:bg-slate-900/70"><FileText size={16} className="mb-3 text-amber-600" /><p className="text-2xl font-black">{history.length}</p><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Saved bills</p></div>
                  <div className="rounded-2xl border border-amber-200 bg-white p-3 dark:border-amber-900/60 dark:bg-slate-900/70"><CheckCircle2 size={16} className="mb-3 text-emerald-500" /><p className="text-2xl font-black">{history.length - pendingCount}</p><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">GeM complete</p></div>
                </div>
                <div className="space-y-2 rounded-2xl border border-amber-200 bg-white p-4 dark:border-amber-900/60 dark:bg-slate-900/70">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Mitra's read</p>
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-amber-50/80">{scanPaths.length > 0 ? "Invoice folders are connected." : "Connect invoice folders in Settings for live bill awareness."} {gemPaths.length > 0 ? "GeM folders are connected too." : "Add GeM folders when you want automatic upload matching."}</p>
                </div>
              </div>
            ) : (
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 custom-scrollbar" aria-live="polite">
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={message.role === "user" ? "max-w-[86%] rounded-2xl rounded-br-md bg-slate-900 px-3.5 py-2.5 text-sm leading-relaxed text-white dark:bg-amber-100 dark:text-slate-950" : "group max-w-[90%] rounded-2xl rounded-bl-md border border-amber-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-700 dark:border-amber-900/60 dark:bg-slate-900/80 dark:text-amber-50/85"}>
                      {message.content}
                      {message.role === "assistant" && "speechSynthesis" in window && <button type="button" onClick={() => speak(message.content)} aria-label="Read response aloud" title="Read aloud" className="ml-2 inline-flex align-middle text-amber-500 opacity-0 transition group-hover:opacity-100 focus:opacity-100"><Volume2 size={13} /></button>}
                    </div>
                  </div>
                ))}
                {isThinking && <div className="flex items-center gap-2 px-2 text-xs font-bold text-amber-700 dark:text-amber-300"><Zap size={14} className="animate-pulse" /> {networkStatus === "online" && useOnline ? "Thinking with Mitra AI..." : "Thinking with the offline helper..."}</div>}
                {onlineError && !isThinking && <div className="rounded-2xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"><p className="truncate" title={onlineError.message}>Offline fallback used: {onlineError.message}</p><button type="button" onClick={() => { void checkConnectivity().then(() => void submit(onlineError.prompt)); }} className="mt-1 font-black underline underline-offset-2">Check connection and try again</button></div>}
              </div>
            )}

            <div className="border-t border-amber-200/70 px-4 pb-4 pt-3 dark:border-amber-900/60">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {quickPrompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => void submit(prompt)} className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-3 py-1.5 text-[11px] font-black text-amber-900 transition hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-100 dark:hover:bg-amber-900/70">
                    {prompt}
                  </button>
                ))}
              </div>
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {quickActions.map((action) => (
                  <button key={action.path} type="button" onClick={() => openRoute(action.path)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-700 transition hover:border-amber-500 hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-100 dark:hover:bg-amber-950/50">
                    <action.icon size={13} /> {action.label}
                  </button>
                ))}
              </div>

              {isSettingsOpen && (
                <div className="mb-3 space-y-2 rounded-2xl border border-amber-200 bg-white p-3 text-xs dark:border-amber-900/60 dark:bg-slate-900">
                  <label className="block font-bold text-slate-600 dark:text-amber-100/70" htmlFor="companion-name">Your name <span className="font-normal">(personalizes Mitra)</span></label>
                  <input id="companion-name" value={displayName} onChange={(event) => persistSettings({ displayName: event.target.value })} placeholder="e.g. Suresh" className="w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-400 dark:border-amber-900 dark:bg-slate-950" />
                  <label className="block font-bold text-slate-600 dark:text-amber-100/70" htmlFor="companion-key">OpenRouter key <span className="font-normal">(stored locally)</span></label>
                  <input id="companion-key" type="password" value={apiKey} onChange={(event) => persistSettings({ apiKey: event.target.value })} placeholder="sk-or-..." className="w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-400 dark:border-amber-900 dark:bg-slate-950" />
                  <label className="block font-bold text-slate-600 dark:text-amber-100/70" htmlFor="companion-model">Model</label>
                  <input id="companion-model" value={model} onChange={(event) => persistSettings({ model: event.target.value })} className="w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-400 dark:border-amber-900 dark:bg-slate-950" />
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 font-bold text-slate-600 dark:text-amber-100/70"><input type="checkbox" checked={useOnline} onChange={(event) => persistSettings({ useOnline: event.target.checked })} disabled={!apiKey} /> Use online model when available</label>
                    <button type="button" onClick={() => void checkConnectivity()} className="shrink-0 font-black text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100">Refresh</button>
                  </div>
                  <label className="flex items-center gap-2 font-bold text-slate-600 dark:text-amber-100/70"><input type="checkbox" checked={voiceEnabled} onChange={(event) => persistSettings({ voiceEnabled: event.target.checked })} /> Read Mitra replies aloud</label>
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-amber-100/50">Mitra keeps local replies available when the internet is unavailable. Online prompts may include recent invoice context.</p>
                </div>
              )}

              <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-white p-1.5 shadow-sm dark:border-amber-900 dark:bg-slate-900">
                <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask Mitra..." aria-label="Ask Mitra" className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-amber-100/40" />
                <button type="submit" disabled={!input.trim() || isThinking} aria-label="Send message" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-amber-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-amber-100 dark:text-slate-950">
                  <Send size={16} />
                </button>
                <button type="button" onClick={() => setIsSettingsOpen((open) => !open)} aria-label="Companion settings" title="Companion settings" className="rounded-xl p-2 text-slate-400 transition hover:bg-amber-50 hover:text-slate-700 dark:hover:bg-amber-950/50 dark:hover:text-amber-100">
                  <Settings2 size={16} />
                </button>
              </form>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setIsOpen((open) => {
          if (!open) setHasNewGreeting(false);
          return !open;
        })}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close Mitra companion" : "Open Mitra companion"}
        className="group relative flex items-center gap-2 rounded-full border border-amber-300 bg-[#f5b544] px-3 py-3 text-slate-950 shadow-xl shadow-amber-950/15 transition hover:-translate-y-0.5 hover:bg-[#ffc65b] dark:border-amber-800 dark:bg-[#b9781e] dark:text-amber-50 dark:hover:bg-[#cd8b27]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-amber-300 transition group-hover:rotate-6"><Bot size={17} /></span>
        <span className="hidden pr-1 text-xs font-black uppercase tracking-[0.16em] sm:inline">Mitra</span>
        {isOpen ? <ChevronDown size={15} /> : <MessageCircle size={15} />}
        {hasNewGreeting && !isOpen && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[#fffaf2] bg-emerald-500 px-1 text-[8px] font-black text-white">1</span>}
      </button>
    </div>
  );
};

export default CompanionAssistant;
