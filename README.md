# PEIPL BILL

A professional desktop invoice management application built with Electron, React, and TypeScript. Designed for Pujari Engineers India (P) Ltd., this application streamlines invoice creation, tracking, and management with Government e-Marketplace (GeM) integration.

## Features

### Core Functionality
- **Invoice Management**: Create, edit, save, and manage professional invoices
- **Dashboard**: Real-time statistics with financial year tracking
- **GeM Integration**: Track Government e-Marketplace PDF upload status
- **Print & PDF Export**: Generate professional invoices with print/PDF capabilities
- **Customer Presets**: Save and reuse customer details for faster invoicing
- **Financial Year Tracking**: Automatic FY extraction from file paths and bill numbers
- **File Association**: Open `.json`, `.peibill`, `.peiinvoice`, `.peiplbill` files directly from OS
- **Dark/Light Theme**: Toggle between themes for comfortable usage

### Advanced Features
- **Multi-Row Item Entries**: Support for complex job descriptions with sub-entries
- **Tax Calculations**: Automatic CGST, SGST, and IGST calculations (configurable rates)
- **Virtual Scrolling**: Efficient handling of large invoice lists
- **Real-time Calculations**: Instant updates as you type
- **Amount in Words**: Automatic conversion of totals to words
- **Stamp Toggle**: Apply/remove stamp on invoices
- **History Tracking**: Maintain local invoice history
- **Settings Management**: Configure company details, scan paths, and customer presets

## Tech Stack

### Frontend
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **React Router DOM** - Client-side routing
- **Framer Motion** - Animations
- **Lucide React** - Icon library
- **React Hook Form** - Form management
- **Zustand** - State management with persistence
- **date-fns** - Date formatting
- **@tanstack/react-virtual** - Virtual scrolling

### Desktop
- **Electron** - Desktop framework
- **electron-builder** - Application packaging
- **electron-store** - Persistent storage

### Development
- **ESLint** - Code linting
- **PostCSS** - CSS processing
- **concurrently** - Run multiple commands
- **wait-on** - Wait for resources

## Project Structure

```
PEIPL_BILL/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── Layout.tsx       # Main app layout with sidebar
│   │   ├── PrintPreview.tsx # Print/PDF preview modal
│   │   └── TitleBar.tsx     # Custom window title bar
│   ├── electron/            # Electron main process
│   │   ├── main.js          # Main process entry point
│   │   ├── preload.cjs      # IPC bridge
│   │   └── splash.html      # Splash screen
│   ├── pages/               # Page components
│   │   ├── Dashboard.tsx    # Dashboard with statistics
│   │   ├── InvoiceEditor.tsx # Invoice creation/editing
│   │   ├── History.tsx      # Invoice history
│   │   ├── Settings.tsx     # Application settings
│   │   └── PrintExport.tsx  # Print export route
│   ├── store/               # State management
│   │   └── useInvoiceStore.ts # Zustand store
│   ├── templates/           # Invoice templates
│   ├── utils/               # Utility functions
│   ├── App.tsx              # Main app component
│   └── index.css            # Global styles
├── public/                  # Static assets
├── dist-electron/           # Built application
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Installation

```bash
# Install dependencies
npm install
```

### Development

```bash
# Start development server (runs both Vite and Electron)
npm run dev

# Start only Vite dev server
npm run dev:vite

# Start only Electron (requires Vite running)
npm run dev:electron
```

The application will open with:
- Vite dev server on `http://localhost:5173`
- Electron window with hot-reload enabled

### Building

```bash
# Build for production
npm run build
```

This will:
1. Build the React application with Vite
2. Package the Electron app with electron-builder
3. Create an installer in `dist-electron/` directory

### Linting

```bash
# Run ESLint
npm run lint
```

## Usage

### Creating an Invoice

1. Click **New Invoice** from the sidebar or dashboard
2. Fill in customer details or select from presets
3. Add job entries with descriptions, quantities, and rates
4. Tax calculations are automatic
5. Click **Preview & Print** to review
6. Save as JSON file or to local history

### Managing Invoices

- **Dashboard**: View all invoices filtered by financial year
- **History**: Access saved invoices
- **Settings**: Configure company details and scan paths

### GeM Integration

1. Configure GeM PDF scan paths in Settings
2. Dashboard automatically matches invoices with GeM PDFs
3. Toggle GeM upload status manually if needed
4. Track pending uploads in the dashboard

### GeM Automated Invoice Upload

Use **GeM Upload** in the app sidebar for a guided browser workflow:

1. Select an invoice (fields are extracted automatically)
2. Open Chrome / attach to a debuggable session and complete GeM SSO (or skip if already logged in)
3. Order search auto-starts, matches the GEMC number, processes the order, and opens the invoice form
4. Detect & map fields, push values to GeM, then review
5. Optionally attach the invoice PDF and **Confirm & Upload** to submit on the live GeM page

Successful uploads mark the invoice as GeM-uploaded in local history.

### Print & PDF Export

- Click **Preview & Print** in the invoice editor
- Toggle stamp visibility
- Print directly to printer
- Save as PDF file

## Configuration

### Company Details

Configure your company information in Settings:
- Company name and address
- GSTIN and PAN
- Bank details
- GeM seller ID and vendor code

### Scan Paths

Set up directories for:
- Invoice JSON files (for dashboard scanning)
- GeM PDF files (for upload tracking)

### Customer Presets

Save frequently used customer details for quick invoice creation.

## File Formats

### Invoice JSON Structure

```json
{
  "billNumber": "PEIPL/2025/123",
  "date": "2025-01-15",
  "orderNumber": "GEMC-511687712601789",
  "customerName": "Customer Name",
  "plantName": "Plant Name",
  "customerAddress": "Address",
  "customerGST": "27AAACR2831H1ZK",
  "items": [...],
  "taxMode": "GST",
  "totalTaxableValue": 0,
  "totalCGST": 0,
  "totalSGST": 0,
  "totalIGST": 0,
  "grandTotal": 0,
  "amountInWords": "RUPEES ZERO ONLY",
  "status": "draft",
  "gemUploaded": false
}
```

## Architecture

### Electron IPC Communication

The application uses a secure IPC bridge via `contextBridge`:

**Main Process** (`src/electron/main.js`):
- File system operations
- Window management
- Print/PDF generation
- Directory scanning

**Renderer Process**:
- React application
- State management
- UI rendering

**Preload Script** (`src/electron/preload.cjs`):
- Secure IPC bridge
- Exposes safe APIs to renderer

### State Management

Zustand store with localStorage persistence:
- Current invoice
- Invoice history
- Company details
- Customer presets
- Theme preference
- Scan paths

### Print/PDF Implementation

The current print implementation uses a workaround approach. For details on the architecture and recommended improvements, see [PRINT_AND_PDF_APPROACH.md](./PRINT_AND_PDF_APPROACH.md).

## Financial Year Extraction

The application automatically extracts financial years from:
- File paths (e.g., `APRIL 2025` → FY 2425)
- Bill numbers (e.g., `PEIPLCH2526/22` → FY 2526)
- Folder names with month-year patterns

## Build Configuration

### Electron Builder

Configured in `package.json`:
- **App ID**: `com.peipl.bill`
- **Product Name**: `PEIPL BILL`
- **Output**: `dist-electron/`
- **Windows Target**: NSIS installer
- **File Associations**: `.json`, `.peibill`, `.peiinvoice`, `.peiplbill`

### Vite Configuration

Standard React + Vite setup with:
- React plugin
- Hash router for Electron compatibility
- CSS processing with PostCSS

## Development Notes

### Adding New Features

1. Update types in `src/utils/types.ts`
2. Add state to `src/store/useInvoiceStore.ts`
3. Create UI components in `src/components/`
4. Add pages in `src/pages/`
5. Update routing in `src/App.tsx`

### Styling

- Uses Tailwind CSS with custom theme
- CSS variables for theming
- Glass morphism effects
- Responsive design

### Performance

- Virtual scrolling for large lists
- Memoized calculations
- Lazy loading where appropriate
- Efficient re-renders with React 19

## Troubleshooting

### Common Issues

**Electron window doesn't open:**
- Ensure Vite dev server is running on port 5173
- Check console for errors

**Print/PDF not working:**
- Verify printer is connected
- Check Electron permissions
- See PRINT_AND_PDF_APPROACH.md for architecture details

**File association not working:**
- Reinstall the application
- Check file extension associations in OS settings

## License

Private application for Pujari Engineers India (P) Ltd.

## Support

For issues or questions, contact the development team.
