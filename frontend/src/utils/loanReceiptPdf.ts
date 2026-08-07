import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { CustomerLoan, LoanItem, LoanPayment } from '@/types/loans';
import { getPdfPageFormat, normalizeInvoiceStyle, normalizePaperSize, type InvoiceStyle, type PaperSize } from '@/utils/paperSettings';

interface CompanyInfo {
  company_name: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  tin_number?: string;
}

interface LoanReceiptOptions {
  loan: CustomerLoan;
  items: LoanItem[];
  payments: LoanPayment[];
  companyInfo?: CompanyInfo | null;
  currencySymbol?: string;
  paperSize?: PaperSize;
  invoiceStyle?: InvoiceStyle;
}

function fmt(amount: number, symbol: string): string {
  if (symbol === 'RF') {
    return `${symbol} ${Math.round(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `${symbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateLoanReceiptPdf({
  loan,
  items,
  payments,
  companyInfo,
  currencySymbol = 'RF',
  paperSize = 'A4',
  invoiceStyle = 'formal'
}: LoanReceiptOptions): jsPDF {
  const resolvedPaperSize = normalizePaperSize(paperSize);
  const resolvedInvoiceStyle = normalizeInvoiceStyle(invoiceStyle);
  const isThermal = resolvedPaperSize !== 'A4';
  const isCompactThermal = resolvedPaperSize === '50mm' || resolvedPaperSize === '58mm';
  const estimatedHeight = isThermal
    ? Math.max(
        resolvedPaperSize === '50mm' ? 220 : resolvedPaperSize === '58mm' ? 225 : resolvedPaperSize === '110mm' ? 270 : 245,
        135 + items.length * 10 + payments.length * 8 + (loan.notes ? Math.ceil(loan.notes.length / (isCompactThermal ? 20 : 32)) * 5 : 0)
      )
    : undefined;

  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: getPdfPageFormat(
      resolvedPaperSize,
      isThermal ? estimatedHeight : undefined
    )
  });

  const pw = doc.internal.pageSize.getWidth();
  const margin = resolvedPaperSize === 'A4' ? 20 : isCompactThermal ? 4 : resolvedPaperSize === '110mm' ? 6 : 5;

  const primary: [number, number, number] =
    resolvedInvoiceStyle === 'modern' ? [139, 92, 246] : [71, 85, 105];
  const dark: [number, number, number] = [31, 41, 55];
  const gray: [number, number, number] = [107, 114, 128];

  if (resolvedPaperSize === 'A4') {
    // Header band
    doc.setFillColor(...primary);
    doc.rect(0, 0, pw, 38, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(companyInfo?.company_name || 'RETAIL SYSTEM', 20, 20);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const parts: string[] = [];
    if (companyInfo?.address) parts.push(companyInfo.address);
    if (companyInfo?.phone) parts.push(`Tel: ${companyInfo.phone}`);
    if (companyInfo?.tin_number) parts.push(`TIN: ${companyInfo.tin_number}`);
    else if (companyInfo?.tax_number) parts.push(`TIN: ${companyInfo.tax_number}`);
    doc.text(parts.join('  |  ') || '', 20, 30);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('LOAN STATEMENT', pw - 20, 18, { align: 'right' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`#${loan.loan_number}`, pw - 20, 28, { align: 'right' });

    doc.setTextColor(...dark);

    // Loan info box
    let y = 50;
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(20, y, pw - 40, 35, 3, 3, 'F');

    y += 10;
    doc.setFontSize(9);
    doc.setTextColor(...gray);
    doc.text('Customer', 30, y);
    doc.text('Date Issued', 90, y);
    doc.text('Due Date', 140, y);

    y += 8;
    doc.setTextColor(...dark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(loan.customer?.name || 'Unknown', 30, y);
    doc.text(format(new Date(loan.created_at), 'MMM dd, yyyy'), 90, y);
    doc.text(loan.due_date ? format(new Date(loan.due_date), 'MMM dd, yyyy') : 'No due date', 140, y);

    // Customer phone
    if (loan.customer?.phone) {
      y += 7;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...gray);
      doc.text(`Phone: ${loan.customer.phone}`, 30, y);
    }
  } else {
    // POS Sizes
    let y = 10;
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...dark);
    doc.text(companyInfo?.company_name || 'Retail', pw / 2, y, { align: 'center' });
    y += 6;
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('LOAN STATEMENT', pw / 2, y, { align: 'center' });
    y += 5;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`#${loan.loan_number}`, pw / 2, y, { align: 'center' });
    y += 6;
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray);
    doc.text(format(new Date(loan.created_at), 'dd/MM/yyyy'), pw / 2, y, { align: 'center' });
    y += 5;

    // Divider
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pw - margin, y);
    y += 5;

    doc.setFontSize(9);
    doc.setTextColor(...dark);
    doc.text(`Customer: ${loan.customer?.name || 'Unknown'}`, margin, y);
    y += 5;
    if (loan.due_date) {
      doc.text(`Due: ${format(new Date(loan.due_date), 'dd/MM/yyyy')}`, margin, y);
      y += 5;
    }
  }

  // Status badge
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const statusColors: Record<string, [number, number, number]> = {
    active: [37, 99, 235],
    completed: [34, 197, 94],
    overdue: [239, 68, 68],
    cancelled: [107, 114, 128],
  };
  const statusColor = statusColors[loan.status] || gray;
  doc.setTextColor(...statusColor);
  doc.text(`Status: ${loan.status.toUpperCase()}`, 140, y);

  // Interest rate
  if (loan.interest_rate && loan.interest_rate > 0) {
    doc.setTextColor(...gray);
    doc.text(`Interest Rate: ${loan.interest_rate}%`, pw - 20, y, { align: 'right' });
  }

  // Loan items table (if any)
  const tableY = resolvedPaperSize === 'A4' ? (items.length > 0 ? y + 15 : y) : 45;
  if (items.length > 0) {
    if (resolvedPaperSize === 'A4') {
      doc.setTextColor(...dark);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Loan Items', 20, y + 15);
    }

    const itemData = items.map(item => [
      item.product?.name || 'Item',
      item.quantity.toString(),
      fmt(item.unit_price, currencySymbol),
      fmt(item.total_price, currencySymbol),
    ]);

    autoTable(doc, {
      startY: resolvedPaperSize === 'A4' ? y + 20 : tableY,
      head: [['Item', 'Qty', 'Price', 'Total']],
      body: itemData,
      theme: resolvedPaperSize === 'A4' ? 'striped' : 'plain',
      headStyles: { 
        fillColor: resolvedPaperSize === 'A4' ? primary : [255, 255, 255], 
        textColor: resolvedPaperSize === 'A4' ? [255, 255, 255] : [0, 0, 0], 
        fontStyle: 'bold', 
        fontSize: resolvedPaperSize === 'A4' ? 9 : 8,
        lineWidth: resolvedPaperSize === 'A4' ? 0 : { bottom: 0.1 }
      },
      bodyStyles: { fontSize: resolvedPaperSize === 'A4' ? 9 : 7, textColor: dark },
      columnStyles: {
        0: { cellWidth: resolvedPaperSize === 'A4' ? 'auto' : resolvedPaperSize === '110mm' ? 44 : 'auto' },
        1: { cellWidth: resolvedPaperSize === 'A4' ? 25 : isCompactThermal ? 8 : resolvedPaperSize === '110mm' ? 12 : 10, halign: 'center' },
        2: { cellWidth: resolvedPaperSize === 'A4' ? 35 : isCompactThermal ? 13 : resolvedPaperSize === '110mm' ? 20 : 15, halign: 'right' },
        3: { cellWidth: resolvedPaperSize === 'A4' ? 35 : isCompactThermal ? 13 : resolvedPaperSize === '110mm' ? 20 : 15, halign: 'right' },
      },
      margin: { left: margin, right: margin },
    });

    y = (doc as any).lastAutoTable.finalY + 10;
  } else {
    y = tableY;
  }

  // Loan summary box
  const summaryWidth = resolvedPaperSize === 'A4' ? pw - 40 : pw - (margin * 2);
  const summaryX = margin;
  
  if (resolvedPaperSize === 'A4') {
    doc.setFillColor(243, 244, 246);
    doc.roundedRect(20, y, pw - 40, 35, 3, 3, 'F');
  } else {
    doc.setDrawColor(230, 230, 230);
    doc.line(margin, y, pw - margin, y);
    y += 5;
  }

  const sumY = resolvedPaperSize === 'A4' ? y + 12 : y + 5;
  doc.setFontSize(resolvedPaperSize === 'A4' ? 10 : 9);
  doc.setFont('helvetica', 'normal');

  if (resolvedPaperSize === 'A4') {
    doc.setTextColor(...gray);
    doc.text('Total Amount:', 30, sumY);
    doc.setTextColor(...dark);
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(loan.total_amount, currencySymbol), 100, sumY);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(34, 197, 94);
    doc.text('Paid:', 30, sumY + 10);
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(loan.paid_amount, currencySymbol), 100, sumY + 10);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(239, 68, 68);
    doc.text('Remaining:', 30, sumY + 20);
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(loan.remaining_amount, currencySymbol), 100, sumY + 20);

    // Grand remaining on right side
    doc.setFontSize(16);
    doc.setTextColor(...primary);
    doc.text('BALANCE DUE', pw - 25, sumY + 5, { align: 'right' });
    doc.text(fmt(loan.remaining_amount, currencySymbol), pw - 25, sumY + 18, { align: 'right' });
    
    y = y + 45;
  } else {
    doc.setTextColor(...dark);
    doc.text('Total Amount:', summaryX, sumY);
    doc.text(fmt(loan.total_amount, currencySymbol), pw - margin, sumY, { align: 'right' });

    doc.text('Paid Amount:', summaryX, sumY + 6);
    doc.text(fmt(loan.paid_amount, currencySymbol), pw - margin, sumY + 6, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primary);
    doc.text('Balance Due:', summaryX, sumY + 12);
    doc.text(fmt(loan.remaining_amount, currencySymbol), pw - margin, sumY + 12, { align: 'right' });
    
    y = sumY + 18;
  }

  // Payment history
  if (payments.length > 0) {
    doc.setTextColor(...dark);
    doc.setFontSize(resolvedPaperSize === 'A4' ? 11 : 9);
    doc.setFont('helvetica', 'bold');
    doc.text('Payment History', margin, y);
    y += 5;

    const paymentData = payments.map(p => [
      format(new Date(p.payment_date), resolvedPaperSize === 'A4' ? 'MMM dd, yyyy HH:mm' : 'dd/MM/yy'),
      fmt(p.amount, currencySymbol),
      p.payment_method.toUpperCase(),
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Date', 'Amount', 'Method']],
      body: paymentData,
      theme: resolvedPaperSize === 'A4' ? 'striped' : 'plain',
      headStyles: { 
        fillColor: resolvedPaperSize === 'A4' ? primary : [255, 255, 255], 
        textColor: resolvedPaperSize === 'A4' ? [255, 255, 255] : [0, 0, 0], 
        fontStyle: 'bold', 
        fontSize: resolvedPaperSize === 'A4' ? 9 : 8,
        lineWidth: resolvedPaperSize === 'A4' ? 0 : { bottom: 0.1 }
      },
      bodyStyles: { fontSize: resolvedPaperSize === 'A4' ? 9 : 7, textColor: dark },
      columnStyles: {
        0: { cellWidth: resolvedPaperSize === 'A4' ? 60 : resolvedPaperSize === '110mm' ? 40 : 25 },
        1: { cellWidth: resolvedPaperSize === 'A4' ? 40 : resolvedPaperSize === '110mm' ? 26 : 20, halign: 'right' },
        2: { cellWidth: 'auto' },
      },
      margin: { left: margin, right: margin },
    });
    
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Notes
  if (loan.notes) {
    const notesY = y + 2;
    doc.setFontSize(resolvedPaperSize === 'A4' ? 9 : 8);
    doc.setTextColor(...gray);
    doc.setFont('helvetica', 'normal');
    doc.text(`Notes: ${loan.notes}`, margin, notesY);
    y = notesY + 10;
  }

  // Footer
  if (resolvedPaperSize === 'A4') {
    const footerY = doc.internal.pageSize.getHeight() - 25;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.line(20, footerY - 10, pw - 20, footerY - 10);

    doc.setFontSize(8);
    doc.setTextColor(...gray);
    doc.setFont('helvetica', 'normal');
    doc.text('This is a loan statement. Please make payments before the due date.', pw / 2, footerY, { align: 'center' });
    if (companyInfo?.email) {
      doc.text(companyInfo.email, pw / 2, footerY + 5, { align: 'center' });
    }
    doc.text(`Generated: ${format(new Date(), 'MMMM dd, yyyy HH:mm')}`, pw / 2, footerY + 12, { align: 'center' });
  } else {
    doc.setFontSize(7);
    doc.setTextColor(...gray);
    doc.text('Thank you!', pw / 2, y, { align: 'center' });
  }

  return doc;
}

export function printLoanReceipt(options: LoanReceiptOptions) {
  const doc = generateLoanReceiptPdf(options);
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
}

export function downloadLoanReceipt(options: LoanReceiptOptions) {
  const doc = generateLoanReceiptPdf(options);
  doc.save(`Loan-Statement-${options.loan.loan_number}.pdf`);
}
