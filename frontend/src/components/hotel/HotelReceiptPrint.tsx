import { useEffect, useRef } from 'react';
import { HotelInfo, HotelBooking } from "@/types/hotel";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { getPaperSettings, normalizePaperSize, normalizeReceiptStyle } from '@/utils/paperSettings';
import { printHtmlDocument } from '@/utils/printHtmlDocument';
import QRCode from 'qrcode';

interface SplitPayment {
  method: string;
  amount: number;
}

interface ReceiptCustomerInfo {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tin_number?: string | null;
}

export interface HotelReceiptPrintItem {
  service: {
    name: string;
  };
  quantity: number;
  unit_price: number;
}

interface HotelReceiptPrintProps {
  taxInclusive?: boolean;
  invoiceNumber: string;
  items: HotelReceiptPrintItem[];
  subtotal: number;
  discount: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  depositCreditAmount?: number;
  paymentMethod: string;
  splitPayments?: SplitPayment[];
  paidAmount?: number;
  changeAmount?: number;
  hotelInfo: HotelInfo | null;
  booking?: HotelBooking | null;
  customer?: ReceiptCustomerInfo | null;
  isRoomCharge?: boolean;
  chargeLabel?: string;
  showChargeLabel?: boolean;
  saleDate: Date;
  onPrintComplete?: () => void;
}

export const HotelReceiptPrint = ({
  invoiceNumber,
  items,
  taxInclusive = false,
  subtotal,
  discount,
  discountAmount,
  taxRate,
  taxAmount,
  total,
  depositCreditAmount = 0,
  paymentMethod,
  splitPayments,
  paidAmount,
  changeAmount,
  hotelInfo,
  booking,
  customer,
  isRoomCharge = false,
  chargeLabel,
  showChargeLabel = true,
  saleDate,
  onPrintComplete
}: HotelReceiptPrintProps) => {
  const { receiptSettings, getCurrencySymbol } = useSettingsContext();
  const hasPrintedRef = useRef(false);

  const currencySymbol = getCurrencySymbol();

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const formatMoney = (value: number) =>
    `${currencySymbol}${Number(value || 0).toFixed(2)}`;

  const formatPaymentMethod = (value: string) =>
    value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const printReceipt = async () => {
    try {
      const qrData = JSON.stringify({
        invoiceNumber,
        total,
        date: saleDate.toISOString(),
        guest: booking?.guest
          ? `${booking.guest.first_name} ${booking.guest.last_name}`
          : (customer?.name || 'Walk-in Guest')
      });

      const qrCodeDataURL = await QRCode.toDataURL(qrData, {
        width: 100,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      const paperSettings = getPaperSettings(normalizePaperSize(receiptSettings?.paper_size));
      const receiptStyle = normalizeReceiptStyle(receiptSettings?.receipt_style);
      const isModernStyle = receiptStyle === 'modern';
      const showCompanyContact = receiptSettings?.show_company_contact !== false;
      const showCustomerDetails = receiptSettings?.show_customer_details !== false;
      const showPaymentDetails = receiptSettings?.show_payment_details !== false;
      const showQr = receiptSettings?.show_qr !== false;
      const isCompactPaper = paperSettings.isCompact;
      const qrSize = paperSettings.qrSize;

      const hasPaymentSummary =
        (!!splitPayments && splitPayments.length > 1) ||
        (!!paidAmount && paidAmount > 0) ||
        (!!changeAmount && changeAmount > 0);

      const metaValueMaxWidth = isCompactPaper ? '56%' : paperSettings.id === 'A4' ? '60%' : '64%';

      const receiptContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice - ${invoiceNumber}</title>
        <style>
          @media print {
            @page { margin: 0; size: ${paperSettings.size}; }
            body { margin: 0; padding: 0; }
          }
          * { box-sizing: border-box; }
          html { background: #fff; }
          body {
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: ${paperSettings.fontSize};
            width: 100%;
            margin: 0;
            padding: ${paperSettings.pagePadding};
            line-height: 1.3;
            color: #000;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-page {
            width: min(100%, ${paperSettings.width});
            margin: 0 auto;
          }
          .receipt-shell {
            width: 100%;
            border: ${isModernStyle ? '1px' : isCompactPaper ? '1px' : '1.5px'} solid #000;
            border-radius: ${isModernStyle
              ? (isCompactPaper ? '12px' : '16px')
              : (isCompactPaper ? '9px' : '12px')};
            padding: ${paperSettings.shellPadding};
            overflow: hidden;
            background: ${isModernStyle ? '#fcfcfc' : '#fff'};
          }
          .center { text-align: center; }
          .line { border-bottom: 1px dashed #000; margin: ${isCompactPaper ? '6px' : '8px'} 0; }
          .double-line { border-bottom: 2px solid #000; margin: ${isCompactPaper ? '6px' : '8px'} 0; }
          .header-title {
            font-size: ${paperSettings.titleFontSize};
            font-weight: 900;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            overflow-wrap: anywhere;
          }
          .muted {
            font-size: ${isCompactPaper ? '9px' : '11px'};
            font-weight: 600;
            overflow-wrap: anywhere;
          }
          .invoice-label {
            display: inline-block;
            margin-top: 8px;
            padding: 4px 10px;
            border: 1.5px solid #000;
            border-radius: 999px;
            font-size: ${paperSettings.sectionLabelSize};
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            max-width: 100%;
            overflow-wrap: anywhere;
            background: ${isModernStyle ? '#000' : 'transparent'};
            color: ${isModernStyle ? '#fff' : '#000'};
          }
          .meta-grid {
            margin-top: 8px;
            display: grid;
            gap: 4px;
          }
          .meta-row,
          .summary-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
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
          .guest-info,
          .summary-box,
          .payment-box {
            margin-top: 10px;
            padding: ${isCompactPaper ? '7px' : '8px'};
            border: 1px solid #000;
            border-radius: ${isModernStyle ? '12px' : '8px'};
            background: ${isModernStyle ? '#f5f5f5' : '#fff'};
          }
          .section-title {
            margin-bottom: 6px;
            font-size: ${paperSettings.sectionLabelSize};
            font-weight: 900;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }
          .guest-name {
            font-size: ${isCompactPaper ? '12px' : '14px'};
            font-weight: 900;
            text-transform: uppercase;
          }
          .charge-type {
            display: inline-block;
            margin-top: 6px;
            padding: 4px 10px;
            background: #000;
            color: #fff;
            border-radius: 999px;
            font-size: ${isCompactPaper ? '9px' : '11px'};
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          /* ── ITEMS TABLE ── */
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
            table-layout: fixed;
          }
          .items-table th,
          .items-table td {
            padding: ${isCompactPaper ? '4px 2px' : '5px 3px'};
            vertical-align: top;
            overflow-wrap: anywhere;
          }
          .items-table th {
            border-bottom: 1.5px solid #000;
            font-size: ${paperSettings.sectionLabelSize};
            font-weight: 900;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }
          /* Col 1 – Description */
          .items-table th:nth-child(1),
          .items-table td:nth-child(1) {
            width: 42%;
            text-align: left;
          }
          /* Col 2 – Qty */
          .items-table th:nth-child(2),
          .items-table td:nth-child(2) {
            width: 10%;
            text-align: center;
          }
          /* Col 3 – Unit Price */
          .items-table th:nth-child(3),
          .items-table td:nth-child(3) {
            width: 24%;
            text-align: right;
          }
          /* Col 4 – Total */
          .items-table th:nth-child(4),
          .items-table td:nth-child(4) {
            width: 24%;
            text-align: right;
          }
          .items-table tbody tr {
            border-bottom: 1px dashed #ccc;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .items-table tbody tr:last-child {
            border-bottom: none;
          }
          .item-name {
            font-weight: 900;
            text-transform: uppercase;
            overflow-wrap: anywhere;
            line-height: 1.3;
          }

          /* ── TOTALS ── */
          .grand-total {
            font-size: ${paperSettings.totalFontSize};
            font-weight: 900;
          }
          .total-box {
            margin-top: 8px;
            padding: 8px;
            border: 1.5px solid #000;
            border-radius: ${isModernStyle ? '12px' : '8px'};
            background: ${isModernStyle ? '#ededed' : '#f5f5f5'};
          }
          .qr-wrap { margin-top: 10px; }
          .qr-note {
            margin-top: 4px;
            font-size: ${isCompactPaper ? '8px' : '10px'};
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }
          .footer {
            margin-top: 12px;
            font-size: ${isCompactPaper ? '8px' : '10px'};
            font-weight: 800;
          }
          .logo {
            max-width: min(100%, ${isCompactPaper ? '110px' : paperSettings.id === 'A4' ? '180px' : '150px'});
            max-height: ${isCompactPaper ? '56px' : '70px'};
            margin: 0 auto 6px;
            display: block;
            object-fit: contain;
            filter: grayscale(1);
          }
          .qr {
            width: ${qrSize}px;
            height: ${qrSize}px;
            display: block;
            margin: 0 auto;
            filter: grayscale(1);
          }
        </style>
      </head>
      <body>
      <div class="print-page">
      <div class="receipt-shell">

        <!-- ── HEADER ── -->
        <div class="center">
          ${hotelInfo?.logo_url
            ? `<img src="${hotelInfo.logo_url}" class="logo" alt="Hotel Logo" />`
            : ''}
          <div class="header-title">${escapeHtml(hotelInfo?.name || 'HOTEL')}</div>
          ${showCompanyContact && hotelInfo?.address
            ? `<div class="muted">${escapeHtml(hotelInfo.address)}</div>` : ''}
          ${showCompanyContact && hotelInfo?.phone
            ? `<div class="muted">Tel: ${escapeHtml(hotelInfo.phone)}</div>` : ''}
          ${showCompanyContact && hotelInfo?.tin_number
            ? `<div class="muted">TIN: ${escapeHtml(hotelInfo.tin_number)}</div>` : ''}
          ${showCompanyContact ? `<div class="muted">MOMO: 61043</div>` : ''}
          <div class="invoice-label">Tax Invoice</div>
          ${showChargeLabel && (chargeLabel || isRoomCharge) ? `
            <div>
              <span class="charge-type">${escapeHtml(chargeLabel || 'Charged To Room')}</span>
            </div>
          ` : ''}
        </div>

        <div class="line"></div>

        <!-- ── RECEIPT META ── -->
        <div class="meta-grid">
          <div class="meta-row">
            <span>Receipt No</span>
            <span>${escapeHtml(invoiceNumber)}</span>
          </div>
          <div class="meta-row">
            <span>Date</span>
            <span>${escapeHtml(saleDate.toLocaleDateString())}</span>
          </div>
          <div class="meta-row">
            <span>Time</span>
            <span>${escapeHtml(saleDate.toLocaleTimeString())}</span>
          </div>
          <div class="meta-row">
            <span>Payment</span>
            <span>${escapeHtml(formatPaymentMethod(paymentMethod))}</span>
          </div>
        </div>

        <!-- ── GUEST / CUSTOMER ── -->
        ${showCustomerDetails ? (booking ? `
          <div class="guest-info">
            <div class="section-title">Guest</div>
            <div class="guest-name">
              ${escapeHtml(
                `${booking.guest?.first_name || ''} ${booking.guest?.last_name || ''}`.trim()
                || 'Walk-in Guest'
              )}
            </div>
            ${booking.guest?.phone
              ? `<div class="muted">Phone: ${escapeHtml(booking.guest.phone)}</div>` : ''}
            ${booking.guest?.email
              ? `<div class="muted">Email: ${escapeHtml(booking.guest.email)}</div>` : ''}
          </div>
        ` : `
          <div class="guest-info">
            <div class="section-title">Customer</div>
            <div class="guest-name">${escapeHtml(customer?.name || 'Walk-in Customer')}</div>
            ${customer?.tin_number
              ? `<div class="muted">TIN: ${escapeHtml(customer.tin_number)}</div>` : ''}
            ${customer?.phone
              ? `<div class="muted">Phone: ${escapeHtml(customer.phone)}</div>` : ''}
            ${customer?.email
              ? `<div class="muted">Email: ${escapeHtml(customer.email)}</div>` : ''}
            ${customer?.address
              ? `<div class="muted">Address: ${escapeHtml(customer.address)}</div>` : ''}
          </div>
        `) : ''}

        <div class="line"></div>

        <!-- ── ITEMS TABLE ── -->
        <div class="section-title">Items Ordered</div>
        <table class="items-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Price</th>
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td><div class="item-name">${escapeHtml(item.service.name)}</div></td>
                <td style="text-align:center;">${item.quantity}</td>
                <td style="text-align:right;">${formatMoney(item.unit_price)}</td>
                <td style="text-align:right;"><strong>${formatMoney(item.quantity * item.unit_price)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- ── SUMMARY ── -->
        <div class="summary-box">
  <div class="section-title">Summary</div>
  <div class="summary-row">
    <span>Subtotal${taxInclusive ? ' (incl. VAT)' : ''}</span>
    <span>${formatMoney(subtotal)}</span>
  </div>
  ${discountAmount > 0 ? `
    <div class="summary-row">
      <span>${discount > 0 ? `Discount (${discount}%)` : 'Discount'}</span>
      <span>- ${formatMoney(discountAmount)}</span>
    </div>
  ` : ''}
  <div class="summary-row" style="color:#555; font-style:italic;">
    <span>${taxInclusive ? `of which VAT (${taxRate}%)` : `VAT/Tax (${taxRate}%)`}</span>
     <span>${formatMoney(taxAmount)}</span>
       </div>
  <div class="summary-row" style="margin-top:6px;">
    <span>Total</span>
    <span>${formatMoney(total)}</span>
  </div>
  ${depositCreditAmount > 0 ? `
    <div class="summary-row">
      <span>Deposit Paid</span>
      <span>- ${formatMoney(depositCreditAmount)}</span>
    </div>
  ` : ''}
</div>

        <!-- ── PAYMENT DETAILS ── -->
        ${showPaymentDetails ? (isRoomCharge ? `
          <div class="payment-box center">
            <div class="section-title">Posting Confirmation</div>
            <div class="guest-name">Posted Successfully</div>
            <div class="muted" style="margin-top:8px;">Guest Sign: __________________</div>
          </div>
        ` : hasPaymentSummary ? `
          <div class="payment-box">
            ${splitPayments && splitPayments.length > 1
              ? splitPayments.map(p => `
                  <div class="summary-row">
                    <span>${escapeHtml(formatPaymentMethod(p.method))}</span>
                    <span>${formatMoney(p.amount)}</span>
                  </div>
                `).join('')
              : ''}
            ${paidAmount && paidAmount > 0 ? `
              <div class="summary-row">
                <span>Paid</span>
                <span>${formatMoney(paidAmount)}</span>
              </div>
            ` : ''}
            ${changeAmount && changeAmount > 0 ? `
              <div class="summary-row" style="font-size:${isCompactPaper ? '11px' : '14px'}; font-weight:900;">
                <span>Change</span>
                <span>${formatMoney(changeAmount)}</span>
              </div>
            ` : ''}
          </div>
        ` : '') : ''}

        <!-- ── QR CODE ── -->
        ${showQr ? `
          <div class="center qr-wrap">
            <img src="${qrCodeDataURL}" alt="QR Code" class="qr" />
            <div class="qr-note">Scan to Verify</div>
          </div>
        ` : ''}

        <!-- ── FOOTER ── -->
        <div class="footer center">
          <div class="line"></div>
          <div style="margin: 10px 0; text-transform: uppercase; font-weight: 900;">
            
          </div>
          <div>${escapeHtml(hotelInfo?.name || 'Hotel')}</div>
          <div style="margin-top: 4px;">Printed: ${escapeHtml(new Date().toLocaleString())}</div>
        </div>

      </div>
      </div>
      </body>
      </html>
    `;

      await printHtmlDocument({
        html: receiptContent,
        title: `Invoice-${invoiceNumber}`,
      });
    } catch (error) {
      console.error('Hotel receipt print failed:', error);
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
