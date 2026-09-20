import React from 'react';
import type { Invoice, CompanyDetails } from '../utils/types';
import { numberToWords, formatDate, parseNumeric } from '../utils/formatters';
import { DEFAULT_ITEMS_PER_PAGE, getPaginatedItems, normalizeItemsPerPage } from '../utils/pagination';
import logo from '../assets/logo.png';
import stamp from '../assets/stamp.png';

interface Props {
  invoice: Invoice;
  company: CompanyDetails;
}

const InvoicePage: React.FC<Props & { items: Invoice['items']; pageNumber: number; totalPages: number }> = ({
  invoice,
  company,
  items,
  pageNumber,
  totalPages,
}) => {
  return (
    <div className="invoice-page bg-white text-black p-[5mm] w-[210mm] max-w-full font-sans text-[11px] leading-tight flex flex-col items-stretch tabular-nums invoice-simple-font">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[8px] font-black uppercase tracking-[0.22em] text-slate-500">
          {invoice.billNumber}
        </div>
        <div className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-700 shadow-sm">
          Page {pageNumber} / {totalPages}
        </div>
      </div>

      <div className="border border-black p-2 mb-0 flex flex-col items-center text-center relative">
        <div className="absolute left-2 top-2">
          <img src={logo} alt="PEIPL Logo" className="w-16 h-auto object-contain" />
        </div>
        <h1 className="text-[20px] font-black tracking-tight mb-1">{company.name}</h1>
        <p className="text-[10px] font-bold mb-1">
          ONLINE LEAK SEALING ★ INSULATION HOT TIGHTING ★ METAL STITCHING<br />
          ★ SPARE PARTS SUPPLIERS & LABOUR SUPPLIERS
        </p>
        <p className="text-[10px] font-medium mb-1">Regd. Office: B-21, Flat No.101, Siddeshwar Co-op Hsg. Soc; Sector-9, Gharonda, Ghansoli, Navi, Mumbai -400 701.</p>
        <p className="text-[10px] font-medium mb-1">Mobile: 9820027556</p>
        <p className="text-[10px] font-medium">Email: <span className="text-blue-600 underline">spujari79@gmail.com</span></p>
      </div>

      <div className="border border-black border-t-0 grid grid-cols-12 mb-0">
        <div className="col-span-7 border-r border-black p-2">
          <div className="flex gap-1 mb-1">
            <span className="font-bold min-w-[30px]">To:</span>
            <div className="uppercase font-bold text-[10px]">
              {invoice.customerName}<br />
              {invoice.plantName}<br />
              {invoice.customerAddress.split('\n').map((line, i) => <React.Fragment key={i}>{line}<br /></React.Fragment>)}
              GSTIN: <span className="">{invoice.customerGST}</span>
            </div>
          </div>
        </div>
        <div className="col-span-5 p-2 text-[10px] space-y-0.5">
          <div className="flex justify-between">
            <span className="font-bold">TAX INVOICE NO.:</span>
            <span className=" font-bold">{invoice.billNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold">DATE:</span>
            <span className=" font-bold border-b border-black">{formatDate(invoice.date)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold">ORDER NO.:</span>
            <span className=" font-bold">{invoice.orderNumber || 'GEMC-511687712601789'}</span>
          </div>
          {(invoice.outlineAgreement || company.outlineAgreement) && (
            <div className="flex justify-between">
              <span className="font-bold uppercase text-[8px]">Outline Agreement:</span>
              <span className=" font-bold">{invoice.outlineAgreement || company.outlineAgreement}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="font-bold">JOBSHEET NO:</span>
            <span className=" font-bold uppercase">{invoice.jobsheetNo || 'ATTACHED'}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold">Vendor Code:</span>
            <span className=" font-bold">{invoice.vendorCode || company.vendorCode || '-'}</span>
          </div>
          {(invoice.gemSellerId || company.gemSellerId) && (
            <div className="flex justify-between">
              <span className="font-bold uppercase text-[8px]">GeM Seller ID:</span>
              <span className=" font-bold">{invoice.gemSellerId || company.gemSellerId}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="font-bold uppercase">GSTIN:</span>
            <span className=" font-bold">27AADCP2938G1ZD</span>
          </div>
        </div>
      </div>

      <table className="w-full border-collapse border border-black border-t-0 text-[10px]">
        <thead>
          <tr className="font-black text-center border-b border-black divide-x divide-black bg-gray-50 uppercase text-[10px]">
            <th className="p-1 w-[45px] align-top">Sr.<br />No.<br />&<br />Date</th>
            <th className="p-1 w-[40px] align-top">Ref<br />no.</th>
            <th className="p-1 align-top text-left pl-2">JOB DESCRIPTION</th>
            <th className="p-1 w-[55px] align-top">SAC/<br />HSN</th>
            <th className="p-1 w-[35px] align-top">Qty</th>
            <th className="p-1 w-[60px] align-top">Rate<br />(In Rs.)</th>
            <th className="p-1 w-[65px] align-top">Tax able<br />value.</th>
            <th className="p-1 w-[55px] align-top">{invoice.taxMode === 'GST' ? 'CGST' : 'IGST'}<br />Rate &<br />Amt.</th>
            <th className="p-1 w-[55px] align-top">{invoice.taxMode === 'GST' ? 'SGST' : 'Tax'}<br />Rate &<br />Amt.</th>
            <th className="p-1 w-[70px] align-top">Total with<br />GST (In<br />Rs.)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black">
          {items.map((item, idx) => (
            <tr key={`${pageNumber}-${idx}`} className="divide-x divide-black align-top min-h-[100px]">
              <td className="p-1 text-center leading-tight text-[10px]">
                {item.srNoDate.map((sd, i) => <div key={i}>{sd}</div>)}
              </td>
              <td className="p-1 text-center text-[10px]">
                {item.refNo.map((rn, i) => <div key={i}>{rn}</div>)}
              </td>
              <td className="p-1 pl-2">
                <div className="uppercase mb-1">{item.description}</div>
                {item.subDescriptions?.map((sd, i) => (
                  <div key={i} className="uppercase text-[10px] mb-0.5 last:mb-0 text-gray-700">
                    {sd}
                  </div>
                ))}
              </td>
              <td className="p-1 text-center text-[10px]">
                {item.sacHsn.map((sh, i) => <div key={i}>{sh}</div>)}
              </td>
              <td className="p-1 text-center font-bold">
                {item.quantity.map((q, i) => <div key={i}>{q.toString().padStart(2, '0')}</div>)}
              </td>
              <td className="p-1 text-right">
                {item.rate.map((r, i) => {
                  const val = parseNumeric(r);
                  const [rupees, paise] = val.toFixed(2).split('.');
                  return <div key={i}>{rupees}.{paise}</div>;
                })}
              </td>
              <td className="p-1 text-right font-bold text-[10px]">
                {item.amount.map((a, i) => {
                  const val = parseNumeric(a);
                  const [rupees, paise] = val.toFixed(2).split('.');
                  return <div key={i}>{rupees}.{paise}</div>;
                })}
              </td>
              <td className="p-1 text-right text-[10px]">
                {(invoice.taxMode === 'GST' ? item.cgstAmount : (item.igstAmount || [])).map((ca, i) => {
                  const val = parseNumeric(ca);
                  const [rupees, paise] = val.toFixed(2).split('.');
                  return <div key={i}>{rupees}.{paise}</div>;
                })}
                {invoice.taxMode === 'GST' && (
                  <div className="text-[7px] text-gray-500 border-t border-black/10 mt-1">
                    {item.cgstRate}%
                  </div>
                )}
              </td>
              <td className="p-1 text-right text-[10px]">
                {(invoice.taxMode === 'GST' ? item.sgstAmount : []).map((sa, i) => {
                  const val = parseNumeric(sa);
                  const [rupees, paise] = val.toFixed(2).split('.');
                  return <div key={i}>{rupees}.{paise}</div>;
                })}
                {invoice.taxMode === 'GST' && (
                  <div className="text-[7px] text-gray-500 border-t border-black/10 mt-1">
                    {item.sgstRate}%
                  </div>
                )}
                {invoice.taxMode === 'IGST' && (
                  <div className="text-[7px] text-gray-500 border-t border-black/10 mt-1">
                    {item.igstRate || 18}%
                  </div>
                )}
              </td>
              <td className="p-1 text-right font-bold">
                {item.totalWithGST.map((t, i) => {
                  const val = parseNumeric(t);
                  const [rupees, paise] = val.toFixed(2).split('.');
                  return <div key={i}>{rupees}.{paise}</div>;
                })}
              </td>
            </tr>
          ))}

          <tr className="divide-x divide-black font-black border-t border-black bg-gray-50 tabular-nums">
            <td colSpan={5} className="p-1 text-right"></td>
            <td className="p-1 text-center uppercase text-[8px] leading-tight">TOTAL<br />BASIC<br />RATE</td>
            <td className="p-1 text-right border-y border-black ">
              {(() => {
                const [rupees, paise] = invoice.totalTaxableValue.toFixed(2).split('.');
                return `${rupees}.${paise}`;
              })()}
            </td>
            <td className="p-1 text-right border-y border-black ">
              {(() => {
                const [rupees, paise] = (invoice.taxMode === 'GST' ? invoice.totalCGST : invoice.totalIGST).toFixed(2).split('.');
                return `${rupees}.${paise}`;
              })()}
            </td>
            <td className="p-1 text-right border-y border-black ">
              {(() => {
                const [rupees, paise] = (invoice.taxMode === 'GST' ? invoice.totalSGST : 0).toFixed(2).split('.');
                return `${rupees}.${paise}`;
              })()}
            </td>
            <td className="p-1 text-right border-y border-black underline text-[12px]">
              <div className="text-[7px] leading-none mb-1 uppercase text-muted-foreground">GRAND TOTAL</div>
              {(() => {
                const [rupees, paise] = invoice.grandTotal.toFixed(2).split('.');
                return `${rupees}.${paise}`;
              })()}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="border border-black border-t-0 p-2 font-bold uppercase text-[10px]">
        {invoice.amountInWords || `RUPEES ${numberToWords(invoice.grandTotal)} ONLY`}
      </div>

      <div className="mt-4 flex justify-between items-start text-[10px] font-bold">
        <div className="space-y-0.5 uppercase">
          <p>BILL IS PAYABLE WITHIN THIRTY DAY</p>
          <p>ALL PAYMENT TO BE MADE BY A/C PAYEE / DRAFT</p>
          <p>IN FAVOUR OF PUJARI ENGINEERS INDIA (P) LTD.</p>
          <p>I.T PAN NO. AADCP2938G</p>
          <p>GSTIN: 27AADCP2938G1ZD</p>
        </div>
        <div className="text-center space-y-1 relative min-w-[150px]">
          <p>For {company.name}</p>
          <div className="relative h-16 flex items-center justify-center">
            {invoice.showStamp && (
              <img 
                src={stamp} 
                alt="Company Stamp" 
                className="absolute w-24 h-auto opacity-90 mix-blend-multiply z-10"
                style={{ transform: 'rotate(-5deg)' }}
              />
            )}
          </div>
          <div className="space-y-0.5">
            <p className="uppercase tracking-widest font-black">SANDEEP. D.PUJARI</p>
            <p>(Director)</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export const IndustrialInvoice: React.FC<Props> = ({ invoice, company }) => {
  const itemsPerPage = normalizeItemsPerPage(invoice.itemsPerPage ?? DEFAULT_ITEMS_PER_PAGE);
  const pages = getPaginatedItems(invoice.items, itemsPerPage);
  const totalPages = Math.max(1, pages.length || 1);

  return (
    <div className="w-full">
      {pages.map((items, index) => (
        <InvoicePage
          key={`${invoice.billNumber}-${index}`}
          invoice={invoice}
          company={company}
          items={items}
          pageNumber={index + 1}
          totalPages={totalPages}
        />
      ))}
    </div>
  );
};
