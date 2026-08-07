import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { Sale, SaleItem } from '@/types/inventory';
import { getPdfPageFormat, getPaperSettings, normalizePaperSize, normalizeReceiptStyle, type PaperSize, type ReceiptStyle } from '@/utils/paperSettings';

interface CompanyInfo {
  company_name: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  tin_number?: string;
  logo_url?: string;
}

interface SaleReceiptOptions {
  sale: Sale;
  items: SaleItem[];
  companyInfo?: CompanyInfo | null;
  currencySymbol?: string;
  taxName?: string;
  paperSize?: PaperSize;
  receiptStyle?: ReceiptStyle;
  showQr?: boolean;
  showCompanyContact?: boolean;
  showCustomerDetails?: boolean;
  showPaymentDetails?: boolean;
}

function formatAmount(amount: number, symbol: string): string {
  if (symbol === 'RF') {
    return `${symbol} ${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateSaleReceiptPdf({
  sale,
  items,
  companyInfo,
  currencySymbol = 'RF',
  taxName = 'Tax',
  paperSize = 'A4',
  receiptStyle = 'classic',
  showQr = true,
  showCompanyContact = true,
  showCustomerDetails = true,
  showPaymentDetails = true
}: SaleReceiptOptions): jsPDF {
  const resolvedPaperSize = normalizePaperSize(paperSize);
  const resolvedReceiptStyle = normalizeReceiptStyle(receiptStyle);
  const paperSettings = getPaperSettings(resolvedPaperSize);
  const isThermal = paperSettings.isThermal;
  const isCompactThermal = resolvedPaperSize === '50mm' || resolvedPaperSize === '58mm';
  const estimatedThermalHeight = isThermal
    ? Math.max(
        paperSettings.minThermalHeightMm,
        128 +
          (companyInfo?.address ? Math.ceil(companyInfo.address.length / (isCompactThermal ? 18 : 28)) * 4 : 0) +
          (sale.customer_name ? Math.ceil(sale.customer_name.length / (isCompactThermal ? 18 : 28)) * 4 : 0) +
          items.reduce((sum, item) => {
            const name = item.product?.name || 'Item';
            const nameLines = Math.max(1, Math.ceil(name.length / (isCompactThermal ? 16 : resolvedPaperSize === '110mm' ? 38 : 26)));
            return sum + nameLines * 8 + 4;
          }, 0) +
          ((sale.customer_phone ? 1 : 0) + (sale.notes ? Math.ceil(sale.notes.length / (isCompactThermal ? 18 : 30)) : 0)) * 5
      )
    : undefined;

  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: getPdfPageFormat(resolvedPaperSize, estimatedThermalHeight)
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = resolvedPaperSize === 'A4' ? 20 : isCompactThermal ? 3.5 : resolvedPaperSize === '110mm' ? 6 : 5;
  const contentWidth = pageWidth - (margin * 2);

  // Colors
  const primaryColor: [number, number, number] =
    resolvedReceiptStyle === 'modern' ? [30, 41, 59] : [15, 23, 42];
  const accentColor: [number, number, number] =
    resolvedReceiptStyle === 'modern' ? [14, 116, 144] : [17, 24, 39];
  const darkColor: [number, number, number] = [31, 41, 55];
  const grayColor: [number, number, number] = [107, 114, 128];

  const formatPrice = (amount: number) => {
    if (currencySymbol === 'RF') {
      return `${currencySymbol} ${Math.round(amount).toLocaleString()}`;
    }
    return `${currencySymbol}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Header band
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 42, 'F');

  // Logo or Company Name
  if (companyInfo?.logo_url) {
    try {
      doc.addImage(companyInfo.logo_url, 'PNG', margin, 8, 24, 24);
    } catch (e) {
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(resolvedPaperSize === 'A4' ? 22 : isCompactThermal ? 12 : 14);
      doc.setFont('helvetica', 'bold');
      doc.text(companyInfo?.company_name || 'RETAIL SYSTEM', margin, 22);
    }
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(resolvedPaperSize === 'A4' ? 22 : isCompactThermal ? 12 : 14);
    doc.setFont('helvetica', 'bold');
    doc.text(companyInfo?.company_name || 'RETAIL SYSTEM', margin, 22);
  }

  // Header Details
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : isCompactThermal ? 6 : 7);
  doc.setFont('helvetica', 'normal');
  let headerY = 15;
  const headerRightX = pageWidth - margin;

  doc.text('SALES RECEIPT', headerRightX, headerY, { align: 'right' });
  headerY += resolvedPaperSize === 'A4' ? 6 : 4;
  doc.setFontSize(resolvedPaperSize === 'A4' ? 14 : isCompactThermal ? 8.5 : 10);
  doc.setFont('helvetica', 'bold');
  doc.text(`#${sale.sale_number}`, headerRightX, headerY, { align: 'right' });
  headerY += resolvedPaperSize === 'A4' ? 6 : 4;
  doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : isCompactThermal ? 6 : 7);
  doc.setFont('helvetica', 'normal');
  doc.text(format(new Date(sale.sale_date), 'MMMM dd, yyyy HH:mm'), headerRightX, headerY, { align: 'right' });

  // Company Contact Info in header sub-bar
  doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : isCompactThermal ? 5.8 : 6.4);
  const contactText = [
    companyInfo?.address,
    companyInfo?.phone ? `Tel: ${companyInfo.phone}` : null,
    companyInfo?.tin_number ? `TIN: ${companyInfo.tin_number}` : (companyInfo?.tax_number ? `TIN: ${companyInfo.tax_number}` : null)
  ].filter(Boolean).join('  |  ');
  if (showCompanyContact && contactText) {
    const headerContactWidth = Math.max(contentWidth - (resolvedPaperSize === 'A4' ? 0 : contentWidth * 0.45), 18);
    const contactLines = doc.splitTextToSize(contactText, headerContactWidth);
    doc.text(contactLines, margin, 36);
  }

  // Reset
  doc.setTextColor(...darkColor);

  // Customer Section
  let y = 55;
  if (showCustomerDetails) {
    doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : isCompactThermal ? 6.2 : 7);
    doc.setTextColor(...grayColor);
    doc.text('CUSTOMER:', margin, y);
    doc.setTextColor(...darkColor);
    doc.setFontSize(resolvedPaperSize === 'A4' ? 10 : isCompactThermal ? 7.2 : 8.2);
    doc.setFont('helvetica', 'bold');
    y += 6;
    const customerLines = doc.splitTextToSize(sale.customer_name || 'Walk-in Customer', isThermal ? contentWidth * 0.52 : 60);
    doc.text(customerLines, margin, y);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(resolvedPaperSize === 'A4' ? 9 : isCompactThermal ? 6.2 : 7);
    if (sale.customer_phone) {
      y += customerLines.length * (resolvedPaperSize === 'A4' ? 4.5 : 3.5);
      doc.text(`Phone: ${sale.customer_phone}`, margin, y);
    }
  }

  // Payment Method info
  const payX = resolvedPaperSize === 'A4' ? pageWidth - 70 : resolvedPaperSize === '110mm' ? pageWidth - 42 : pageWidth - 28;
  y = 55;
  if (showPaymentDetails) {
    doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : isCompactThermal ? 6.2 : 7);
    doc.setTextColor(...grayColor);
    doc.text('PAYMENT:', payX, y);
    doc.setTextColor(...darkColor);
    doc.setFontSize(resolvedPaperSize === 'A4' ? 10 : isCompactThermal ? 7.2 : 8.2);
    doc.setFont('helvetica', 'bold');
    y += 6;
  }
  
  let paymentDisplay = sale.payment_method;
  let splitPayments: Array<{ method: string; amount: number }> = [];
  try {
    const parsed = JSON.parse(sale.payment_method);
    if (Array.isArray(parsed)) {
      splitPayments = parsed;
      paymentDisplay = 'Split Payment';
    }
  } catch {}
  if (showPaymentDetails) {
    doc.text(paymentDisplay.toUpperCase(), payX, y);
  }

  // Items table
  y += 15;
  const tableData = items.map(item => [
    item.product?.name || 'Unknown Product',
    item.quantity.toString(),
    formatPrice(item.unit_price),
    formatPrice(item.total_price),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['ITEM', 'QTY', 'UNIT PRICE', 'TOTAL']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: resolvedPaperSize === 'A4' ? 8 : isCompactThermal ? 5.8 : 6.4,
      halign: 'center'
    },
    bodyStyles: { fontSize: resolvedPaperSize === 'A4' ? 9 : isCompactThermal ? 6.4 : 7, textColor: darkColor },
    columnStyles: {
      0: { cellWidth: resolvedPaperSize === 'A4' ? 'auto' : resolvedPaperSize === '110mm' ? 44 : 'auto' },
      1: { cellWidth: resolvedPaperSize === 'A4' ? 20 : isCompactThermal ? 8 : resolvedPaperSize === '110mm' ? 12 : 10, halign: 'center' },
      2: { cellWidth: resolvedPaperSize === 'A4' ? 35 : isCompactThermal ? 13 : resolvedPaperSize === '110mm' ? 20 : 16, halign: 'right' },
      3: { cellWidth: resolvedPaperSize === 'A4' ? 35 : isCompactThermal ? 13 : resolvedPaperSize === '110mm' ? 20 : 16, halign: 'right' },
    },
    margin: { left: margin, right: margin },
    styles: { font: 'helvetica' }
  });

  const finalY = (doc as any).lastAutoTable.finalY || y + 50;

  // Totals
  let totY = finalY + 12;
  const totX = resolvedPaperSize === 'A4' ? pageWidth - 85 : resolvedPaperSize === '110mm' ? pageWidth - 55 : pageWidth - 42;

  doc.setFontSize(resolvedPaperSize === 'A4' ? 9 : isCompactThermal ? 6.5 : 7.2);
  doc.setFont('helvetica', 'normal');

  // Subtotal
  doc.setTextColor(...grayColor);
  doc.text('SUBTOTAL', totX, totY);
  doc.setTextColor(...darkColor);
  doc.text(formatPrice(sale.total_amount), pageWidth - margin, totY, { align: 'right' });

  // Discount
  if (sale.discount > 0) {
    totY += 7;
    doc.setTextColor(22, 163, 74);
    doc.text('DISCOUNT', totX, totY);
    doc.text(`-${formatPrice(sale.discount)}`, pageWidth - margin, totY, { align: 'right' });
  }

  // Tax
  if (sale.tax_amount && sale.tax_amount > 0) {
    totY += 7;
    doc.setTextColor(...grayColor);
    doc.text(taxName.toUpperCase(), totX, totY);
    doc.setTextColor(...darkColor);
    doc.text(formatPrice(sale.tax_amount), pageWidth - margin, totY, { align: 'right' });
  }

  // Divider
  totY += 4;
  doc.setDrawColor(226, 232, 240);
  doc.line(totX - 5, totY, pageWidth - margin, totY);

  // Grand total
  totY += 10;
  doc.setFontSize(resolvedPaperSize === 'A4' ? 12 : isCompactThermal ? 8 : 9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...accentColor);
  doc.text('TOTAL AMOUNT', totX, totY);
  doc.text(formatPrice(sale.final_amount), pageWidth - margin, totY, { align: 'right' });

  // Split payments breakdown
  if (showPaymentDetails && splitPayments.length > 1) {
    totY += 15;
    doc.setFontSize(resolvedPaperSize === 'A4' ? 9 : isCompactThermal ? 6.5 : 7.2);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkColor);
    doc.text('Payment Details:', margin, totY);
    totY += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : isCompactThermal ? 5.8 : 6.4);
    for (const p of splitPayments) {
      doc.setTextColor(...grayColor);
      doc.text(`${p.method.toUpperCase()}:`, margin + 5, totY);
      doc.setTextColor(...darkColor);
      doc.text(formatPrice(p.amount), margin + (resolvedPaperSize === 'A4' ? 70 : resolvedPaperSize === '110mm' ? 44 : 30), totY);
      totY += 5;
    }
  }

  // PAID stamp
  if (showPaymentDetails) {
    totY += 10;
    doc.setLineWidth(0.5);
    doc.setDrawColor(34, 197, 94);
    doc.setTextColor(34, 197, 94);
    doc.setFontSize(resolvedPaperSize === 'A4' ? 12 : isCompactThermal ? 8 : 9);
    doc.rect(pageWidth / 2 - (resolvedPaperSize === 'A4' ? 20 : resolvedPaperSize === '110mm' ? 18 : 15), totY, resolvedPaperSize === 'A4' ? 40 : resolvedPaperSize === '110mm' ? 36 : 30, 10);
    doc.text('PAID', pageWidth / 2, totY + 7, { align: 'center' });
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - (resolvedPaperSize === 'A4' ? 20 : 10);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);

  doc.setFontSize(resolvedPaperSize === 'A4' ? 7 : isCompactThermal ? 5.8 : 6.3);
  doc.setTextColor(...grayColor);
  doc.setFont('helvetica', 'normal');
  doc.text('Thank you for your business! Please visit us again.', pageWidth / 2, footerY, { align: 'center' });
  if (companyInfo?.email) {
    doc.text(companyInfo.email, pageWidth / 2, footerY + 4, { align: 'center' });
  }

  return doc;
}


export function printSaleReceipt(options: SaleReceiptOptions) {
  const doc = generateSaleReceiptPdf(options);
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
}

export function downloadSaleReceipt(options: SaleReceiptOptions) {
  const doc = generateSaleReceiptPdf(options);
  doc.save(`Receipt-${options.sale.sale_number}.pdf`);
}
