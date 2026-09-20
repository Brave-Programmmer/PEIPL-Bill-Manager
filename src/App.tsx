import { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { InvoiceEditor } from './pages/InvoiceEditor';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { PrintExport } from './pages/PrintExport';
import GeM_UploadPage from './pages/GeM_Upload';
import { useInvoiceStore } from './store/useInvoiceStore';
import { PdfTools } from './pages/PdfTools';
import type { Invoice } from './utils/types';

interface OpenFileEvent {
  content: Invoice;
}

function AppContent() {
  const navigate = useNavigate();
  const setCurrentInvoice = useInvoiceStore((state) => state.setCurrentInvoice);

  useEffect(() => {
    if (window.electron) {
      const unsubscribe = window.electron.onFileOpen((data: OpenFileEvent) => {
        if (data && data.content) {
          setCurrentInvoice(data.content);
          navigate('/editor');
        }
      });
      return () => unsubscribe();
    }
  }, [navigate, setCurrentInvoice]);

  return (
    <Routes>
      <Route path="/print-export" element={<PrintExport />} />
      <Route path="/gem-upload" element={<GeM_UploadPage />} />
      <Route path="*" element={
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/editor" element={<InvoiceEditor />} />
            <Route path="/editor/:id" element={<InvoiceEditor />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/pdf-tools" element={<PdfTools />} />
          </Routes>
        </Layout>
      } />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
