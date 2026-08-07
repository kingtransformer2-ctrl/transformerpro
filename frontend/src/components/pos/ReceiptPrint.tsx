import { useEffect, useRef } from 'react';
import { CartItem } from "@/types/inventory";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { getPaperSettings, normalizePaperSize, normalizeReceiptStyle } from "@/utils/paperSettings";
import { printHtmlDocument } from "@/utils/printHtmlDocument";
import QRCode from 'qrcode';

interface ReceiptPrintProps {
  saleNumber: string;
  customerName?: string;
  customerPhone?: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  taxAmount?: number;
  taxName?: string;
  total: number;
  paymentMethod: string;
  splitPayments?: Array<{ method: string; amount: number }>;
  tinNumber?: string;
  receiptPhone?: string;
  saleDate: string;
  onPrintComplete?: () => void;
}

export const ReceiptPrint = ({
  saleNumber,
  customerName,
  customerPhone,
  items,
  subtotal,
  discount,
  taxAmount = 0,
  taxName = "Tax",
  total,
  paymentMethod,
  splitPayments,
  tinNumber,
  receiptPhone,
  saleDate,
  onPrintComplete
}: ReceiptPrintProps) => {
  const { receiptSettings, companyProfile, getCurrencySymbol, formatDate } = useSettingsContext();
  const hasPrintedRef = useRef(false);

  const currencySymbol = getCurrencySymbol();
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const formatMoney = (value: number) => `${currencySymbol}${Number(value || 0).toFixed(2)}`;
  const formatPaymentMethod = (value: string) =>
    value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  
  const printReceipt = async () => {
    try {
      // Generate QR code with receipt data
      const qrData = JSON.stringify({
        saleNumber,
        total,
        date: saleDate,
        customer: customerName || 'Walk-in Customer'
      });

      const qrCodeDataURL = await QRCode.toDataURL(qrData, {
        width: 120,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      const paperSettings = getPaperSettings(normalizePaperSize(receiptSettings?.paper_size));
      const receiptStyle = normalizeReceiptStyle(receiptSettings?.receipt_style);
      const isModernStyle = receiptStyle === 'modern';
      const showCompanyContact = receiptSettings?.show_company_contact !== false;
      const showCustomerDetails = receiptSettings?.show_customer_details !== false;
      const showPaymentDetails = receiptSettings?.show_payment_details !== false;
      const showQr = receiptSettings?.show_qr !== false;
      const rowGap = paperSettings.isCompact ? '6px' : '8px';
      const shellBorderWidth = isModernStyle ? '1px' : paperSettings.isCompact ? '1.5px' : '2px';
      const metaValueMaxWidth = paperSettings.isCompact ? '56%' : '62%';

      console.log('Generating receipt with settings:', paperSettings);

      const receiptContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt - ${saleNumber}</title>
          <style>
            @media print {
              @page { margin: 0; size: ${paperSettings.size}; }
              body { margin: 0; padding: 0; }
            }
            * { box-sizing: border-box; }
            html {
              background: #fff;
            }
            body { 
              font-family: 'Segoe UI', Arial, sans-serif;
              font-size: ${paperSettings.fontSize};
              margin: 0;
              padding: ${paperSettings.pagePadding};
              line-height: 1.35;
              color: #000;
              background: #fff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .print-page {
              width: min(100%, ${paperSettings.width});
              margin: 0 auto;
            }
            .center { text-align: center; }
            .line { border-bottom: 1px dashed #000; margin: ${rowGap} 0; }
            .double-line { border-bottom: 2px solid #000; margin: ${rowGap} 0; }
            .receipt-shell {
              width: 100%;
              border: ${shellBorderWidth} solid #000;
              padding: ${paperSettings.shellPadding};
              border-radius: ${isModernStyle ? (paperSettings.isCompact ? '12px' : '16px') : (paperSettings.isCompact ? '8px' : '12px')};
              overflow: hidden;
              background: ${isModernStyle ? '#fcfcfc' : '#fff'};
            }
            .brand-title {
              font-size: ${paperSettings.titleFontSize};
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              overflow-wrap: anywhere;
            }
            .muted {
              font-size: ${paperSettings.isCompact ? '9px' : '10px'};
              font-weight: 700;
              overflow-wrap: anywhere;
            }
            .receipt-label {
              display: inline-block;
              margin-top: 8px;
              padding: 4px 12px;
              border: 2px solid #000;
              font-size: ${paperSettings.sectionLabelSize};
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.12em;
              max-width: 100%;
              overflow-wrap: anywhere;
              background: ${isModernStyle ? '#000' : 'transparent'};
              color: ${isModernStyle ? '#fff' : '#000'};
              border-radius: ${isModernStyle ? '999px' : '0'};
            }
            .meta-box,
            .summary-box,
            .payment-box {
              margin-top: 10px;
              padding: 8px;
              border: ${isModernStyle ? '1px' : '1.5px'} solid #000;
              border-radius: ${isModernStyle ? '12px' : (paperSettings.isCompact ? '8px' : '10px')};
              background: ${isModernStyle ? '#f5f5f5' : '#fff'};
            }
            .section-title {
              margin-bottom: 6px;
              font-size: ${paperSettings.sectionLabelSize};
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.12em;
            }
            .meta-row,
            .item-row,
            .summary-row {
              display: flex; 
              justify-content: space-between; 
              align-items: flex-start;
              gap: 8px;
              margin: 4px 0;
            }
            .meta-row span,
            .summary-row span {
              min-width: 0;
              overflow-wrap: anywhere;
            }
            .meta-row span:first-child,
            .summary-row span:first-child {
              font-weight: 800;
              text-transform: uppercase;
              flex: 1 1 auto;
            }
            .meta-row span:last-child,
            .summary-row span:last-child {
              text-align: right;
              font-weight: 900;
              flex: 0 1 ${metaValueMaxWidth};
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 8px;
              table-layout: fixed;
            }
            .items-table th,
            .items-table td {
              padding: 5px 0;
              vertical-align: top;
              overflow-wrap: anywhere;
            }
            .items-table th {
              border-bottom: 1.5px solid #000;
              font-size: ${paperSettings.sectionLabelSize};
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            .items-table th:first-child,
            .items-table td:first-child {
              width: 68%;
              padding-right: 8px;
            }
            .items-table th:last-child,
            .items-table td:last-child {
              text-align: right;
            }
            .items-table tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .item-name {
              font-weight: 900;
              text-transform: uppercase;
              overflow-wrap: anywhere;
            }
            .item-meta {
              font-size: ${paperSettings.isCompact ? '9px' : '10px'};
              font-weight: 700;
              overflow-wrap: anywhere;
            }
            .grand-total {
              font-size: ${paperSettings.totalFontSize};
              font-weight: 900;
            }
            .footer {
              margin-top: 12px;
              font-size: ${paperSettings.isCompact ? '9px' : '10px'};
              font-weight: 800;
            }
            .logo {
              max-width: min(100%, ${paperSettings.isCompact ? '100px' : '130px'});
              max-height: ${paperSettings.isCompact ? '56px' : '70px'};
              margin: 0 auto 6px;
              display: block;
              object-fit: contain;
            }
            .qr {
              width: ${paperSettings.qrSize}px;
              height: ${paperSettings.qrSize}px;
              display: block;
              margin: 12px auto 6px;
            }
          </style>
        </head>
        <body>
          <div class="print-page">
          <div class="receipt-shell">
          <div class="center">
            ${receiptSettings.show_logo && companyProfile?.logo_url ? 
              `<img src="${companyProfile.logo_url}" class="logo" alt="Logo" />` : ''}
            <div class="brand-title">${escapeHtml(companyProfile?.company_name || 'Retail System')}</div>
            ${showCompanyContact ? `<div class="muted">${escapeHtml(companyProfile?.address || 'Your Business Address')}</div>` : ''}
            ${showCompanyContact && companyProfile?.phone ? `<div class="muted">Tel: ${escapeHtml(companyProfile.phone)}</div>` : ''}
            ${showCompanyContact && companyProfile?.email ? `<div class="muted">Email: ${escapeHtml(companyProfile.email)}</div>` : ''}
            ${showCompanyContact && companyProfile?.tin_number ? `<div class="muted">TIN: ${escapeHtml(companyProfile.tin_number)}</div>` : ''}
            ${receiptSettings.header_text ? `<div class="receipt-label">${escapeHtml(receiptSettings.header_text)}</div>` : `<div class="receipt-label">Sales Receipt</div>`}
          </div>
          <div class="line"></div>
          
          ${showCustomerDetails ? `<div class="meta-box">
            <div class="section-title">Transaction</div>
            <div class="meta-row">
              <span>Receipt No</span>
              <span>${escapeHtml(saleNumber)}</span>
            </div>
            <div class="meta-row">
              <span>Date</span>
              <span>${escapeHtml(formatDate(saleDate))}</span>
            </div>
            <div class="meta-row">
              <span>Time</span>
              <span>${escapeHtml(new Date(saleDate).toLocaleTimeString())}</span>
            </div>
            ${customerName ? `
            <div class="meta-row">
              <span>Customer</span>
              <span>${escapeHtml(customerName)}</span>
            </div>
          ` : ''}
            ${customerPhone ? `
            <div class="meta-row">
              <span>Phone</span>
              <span>${escapeHtml(customerPhone)}</span>
            </div>
          ` : ''}
            ${tinNumber ? `
            <div class="meta-row">
              <span>Customer TIN</span>
              <span>${escapeHtml(tinNumber)}</span>
            </div>
          ` : ''}
            ${receiptPhone ? `
            <div class="meta-row">
              <span>Receipt Phone</span>
              <span>${escapeHtml(receiptPhone)}</span>
            </div>
          ` : ''}
          </div>` : ''}

          <div class="section-title" style="margin-top:10px;">Items</div>
          <table class="items-table">
            <thead>
              <tr>
                <th style="text-align:left;">Description</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => `
                <tr>
                  <td>
                    <div class="item-name">${escapeHtml(item.product.name)}</div>
                    <div class="item-meta">${item.quantity} x ${formatMoney(item.unit_price)}</div>
                  </td>
                  <td><strong>${formatMoney(item.quantity * item.unit_price)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="summary-box">
            <div class="section-title">Summary</div>
            <div class="summary-row">
              <span>Subtotal</span>
              <span>${formatMoney(subtotal)}</span>
            </div>

            ${discount > 0 ? `
            <div class="summary-row">
              <span>Discount</span>
              <span>- ${formatMoney(discount)}</span>
            </div>
          ` : ''}

            ${taxAmount > 0 ? `
            <div class="summary-row">
              <span>${escapeHtml(taxName)}</span>
              <span>${formatMoney(taxAmount)}</span>
            </div>
          ` : ''}

            <div class="double-line"></div>

            <div class="summary-row grand-total">
              <span>Total</span>
              <span>${formatMoney(total)}</span>
            </div>
          </div>

          ${showPaymentDetails ? `<div class="payment-box">
            <div class="section-title">Payment</div>
          ${splitPayments && splitPayments.length > 0 ? `
            ${splitPayments.map(p => `
              <div class="summary-row">
                <span>${escapeHtml(formatPaymentMethod(p.method))}</span>
                <span>${formatMoney(p.amount)}</span>
              </div>
            `).join('')}
          ` : `
            <div class="summary-row">
              <span>Payment Method</span>
              <span>${escapeHtml(formatPaymentMethod(paymentMethod))}</span>
            </div>
          `}
          </div>` : ''}
          
          ${showQr ? `<div class="center">
            <img src="${qrCodeDataURL}" alt="QR Code" class="qr" />
          </div>` : ''}
          
          <div class="footer center">
            <div class="line"></div>
            <div style="font-weight: 900; text-transform: uppercase;">
              ${escapeHtml(receiptSettings.footer_text || 'Thank you for your business! Please come again!')}
            </div>
            <div style="margin-top: 6px; font-size: 9px;">
              Powered by Perfect Retail System
            </div>
            <div style="margin-top: 4px; font-size: 9px;">
              Printed: ${escapeHtml(new Date().toLocaleString())}
            </div>
          </div>
          </div>
          </div>
        </body>
      </html>
    `;

      await printHtmlDocument({
        html: receiptContent,
        title: `Receipt-${saleNumber}`,
      });
    } catch (error) {
      console.error('Receipt print failed:', error);
    } finally {
      onPrintComplete?.();
    }
  };

  useEffect(() => {
    if (hasPrintedRef.current) return;
    hasPrintedRef.current = true;
    void printReceipt();
  }, []);

  return null;
};
