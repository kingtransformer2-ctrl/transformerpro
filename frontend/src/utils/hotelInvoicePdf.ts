import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import QRCode from 'qrcode';
import { HotelInvoice, HotelBooking } from '@/types/hotel';
import { getPdfPageFormat, normalizeInvoiceStyle, normalizePaperSize, type InvoiceStyle, type PaperSize } from '@/utils/paperSettings';

interface InvoiceItem {
  id: string;
  description: string;
  item_type: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface HotelInfoData {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  tin_number?: string;
  tax_rate?: number;
  logo_url?: string;
}

type InvoicePaperSize = PaperSize;

function formatMoney(amount: number, currencySymbol: string) {
  if (currencySymbol === 'RF') {
    return `${currencySymbol} ${Math.round(Number(amount || 0)).toLocaleString()}`;
  }

  return `${currencySymbol}${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatLabel(value?: string | null) {
  if (!value) return '-';

  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getInvoiceTaxRate(invoice: HotelInvoice, hotelInfo?: HotelInfoData) {
  if (typeof hotelInfo?.tax_rate === 'number' && hotelInfo.tax_rate >= 0) {
    return hotelInfo.tax_rate;
  }

  const taxableBase = Number(invoice.subtotal || 0) - Number(invoice.discount_amount || 0);
  if (taxableBase > 0 && Number(invoice.tax_amount || 0) > 0) {
    return Number(((Number(invoice.tax_amount) / taxableBase) * 100).toFixed(2));
  }

  return 0;
}

async function createInvoiceQrDataUrl(
  invoice: HotelInvoice & { items?: InvoiceItem[] },
  booking?: HotelBooking,
  hotelInfo?: HotelInfoData
) {
  const resolvedGuest = invoice.guest || booking?.guest || invoice.booking?.guest;
  const payload = JSON.stringify({
    invoice_number: invoice.invoice_number,
    total_amount: Number(invoice.total_amount || 0),
    customer_name:
      invoice.customer_name ||
      `${resolvedGuest?.first_name || ''} ${resolvedGuest?.last_name || ''}`.trim() ||
      'Walk-in Customer',
    hotel_name: hotelInfo?.name || null,
  });

  return QRCode.toDataURL(payload, {
    width: 180,
    margin: 1,
    color: {
      dark: '#111827',
      light: '#FFFFFF',
    },
  });
}

function estimateThermalHeight(
  invoice: HotelInvoice & { items?: InvoiceItem[] },
  booking?: HotelBooking,
  hotelInfo?: HotelInfoData,
  paperSize: Exclude<PaperSize, 'A4'>
) {
  const compactPaper = paperSize === '50mm' || paperSize === '58mm';
  const isWidePaper = paperSize === '110mm';
  const customerAddressLines = Math.max(1, Math.ceil((invoice.customer_address || '').length / (paperSize === '50mm' ? 16 : compactPaper ? 20 : isWidePaper ? 38 : 28)));
  const hotelAddressLines = Math.max(1, Math.ceil((hotelInfo?.address || '').length / (paperSize === '50mm' ? 16 : compactPaper ? 20 : isWidePaper ? 40 : 30)));
  const notesLines = Math.max(0, Math.ceil((invoice.notes || '').length / (paperSize === '50mm' ? 14 : compactPaper ? 18 : isWidePaper ? 36 : 26)));
  const itemLines = (invoice.items || []).reduce((sum, item) => {
    const descriptionLines = Math.max(1, Math.ceil((item.description || '').length / (paperSize === '50mm' ? 14 : compactPaper ? 18 : isWidePaper ? 34 : 24)));
    return sum + descriptionLines + 1;
  }, 0);

  const footerReserve = paperSize === '50mm' ? 34 : paperSize === '58mm' ? 38 : isWidePaper ? 44 : 40;
  const baseHeight = paperSize === '50mm' ? 132 : paperSize === '58mm' ? 126 : isWidePaper ? 145 : 136;
  return Math.max(
    paperSize === '50mm' ? 220 : paperSize === '58mm' ? 205 : isWidePaper ? 250 : 235,
    baseHeight + hotelAddressLines * 4 + customerAddressLines * 4 + notesLines * 4 + itemLines * 9 + footerReserve
  );
}

export async function generateHotelInvoicePdf(
  invoice: HotelInvoice & { items?: InvoiceItem[] },
  booking?: HotelBooking,
  hotelInfo?: HotelInfoData,
  currencySymbol: string = 'RF',
  paperSize: InvoicePaperSize = 'A4',
  invoiceStyle: InvoiceStyle = 'formal',
  showQr: boolean = true,
  showCompanyContact: boolean = true,
  showCustomerDetails: boolean = true
) {
  const resolvedPaperSize = normalizePaperSize(paperSize);
  const resolvedInvoiceStyle = normalizeInvoiceStyle(invoiceStyle);
  const isThermal = resolvedPaperSize !== 'A4';
  const isCompactThermal = resolvedPaperSize === '50mm' || resolvedPaperSize === '58mm';
  const isWideThermal = resolvedPaperSize === '110mm';
  const pdfFormat = getPdfPageFormat(
    resolvedPaperSize,
    isThermal
      ? estimateThermalHeight(invoice, booking, hotelInfo, resolvedPaperSize as Exclude<PaperSize, 'A4'>)
      : undefined
  );

  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: pdfFormat,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = resolvedPaperSize === 'A4' ? 16 : resolvedPaperSize === '50mm' ? 2.8 : resolvedPaperSize === '58mm' ? 3 : resolvedPaperSize === '110mm' ? 6 : 4;
  const contentWidth = pageWidth - margin * 2;

  const primaryColor: [number, number, number] =
    resolvedInvoiceStyle === 'modern' ? [30, 64, 175] : [15, 23, 42];
  const accentColor: [number, number, number] =
    resolvedInvoiceStyle === 'modern' ? [2, 132, 199] : [37, 99, 235];
  const darkColor: [number, number, number] = [17, 24, 39];
  const grayColor: [number, number, number] = [100, 116, 139];
  const borderColor: [number, number, number] = [203, 213, 225];
  const thermalMutedColor: [number, number, number] = [55, 65, 81];
  const thermalLabelColor = isThermal ? thermalMutedColor : grayColor;
  const thermalAccentColor = isThermal ? darkColor : accentColor;

  const resolvedBooking = booking || invoice.booking;
  const resolvedGuest = invoice.guest || resolvedBooking?.guest;
  const customerName = invoice.customer_name || `${resolvedGuest?.first_name || ''} ${resolvedGuest?.last_name || ''}`.trim() || 'Walk-in Customer';
  const customerPhone = invoice.customer_phone || resolvedGuest?.phone || '';
  const customerEmail = invoice.customer_email || resolvedGuest?.email || '';
  const customerAddress = invoice.customer_address || resolvedGuest?.address || '';
  const customerTin = invoice.customer_tin || '';
  const taxRate = getInvoiceTaxRate(invoice, hotelInfo);
  const invoiceItems = invoice.items || [];
  const qrCodeDataUrl = await createInvoiceQrDataUrl(invoice, resolvedBooking, hotelInfo);

  let y = 0;

  if (resolvedPaperSize === 'A4') {
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 34, 'F');

    if (hotelInfo?.logo_url) {
      try {
        doc.addImage(hotelInfo.logo_url, 'PNG', margin, 6, 20, 20);
      } catch {
        // Ignore image failures and fall back to hotel name.
      }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(hotelInfo?.name || 'HOTEL', hotelInfo?.logo_url ? margin + 24 : margin, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    const headerLines = [
      showCompanyContact ? hotelInfo?.address : null,
      showCompanyContact && hotelInfo?.phone ? `Tel: ${hotelInfo.phone}` : null,
      showCompanyContact && hotelInfo?.email ? `Email: ${hotelInfo.email}` : null,
      showCompanyContact ? (hotelInfo?.tin_number ? `TIN: ${hotelInfo.tin_number}` : hotelInfo?.tax_number ? `TIN: ${hotelInfo.tax_number}` : null) : null,
    ].filter(Boolean) as string[];

    let headerContactY = 21;
    headerLines.slice(0, 2).forEach((line) => {
      doc.text(line, hotelInfo?.logo_url ? margin + 24 : margin, headerContactY);
      headerContactY += 4;
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('TAX INVOICE', pageWidth - margin, 11, { align: 'right' });
    doc.setFontSize(14);
    doc.text(invoice.invoice_number, pageWidth - margin, 18, { align: 'right' });

    y = 42;
  } else {
    y = margin + 2;
    if (hotelInfo?.logo_url) {
      try {
        const logoSize = resolvedPaperSize === '50mm' ? 13 : resolvedPaperSize === '58mm' ? 15 : resolvedPaperSize === '110mm' ? 19 : 17;
        doc.addImage(hotelInfo.logo_url, 'PNG', pageWidth / 2 - logoSize / 2, y - 1, logoSize, logoSize);
        y += logoSize + 1;
      } catch {
        // Ignore image failures and keep text-only header.
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(resolvedPaperSize === '50mm' ? 11 : resolvedPaperSize === '58mm' ? 12.5 : resolvedPaperSize === '110mm' ? 15 : 13);
    doc.setTextColor(...darkColor);
    doc.text((hotelInfo?.name || 'HOTEL').toUpperCase(), pageWidth / 2, y, { align: 'center' });
    y += resolvedPaperSize === '50mm' ? 5.5 : resolvedPaperSize === '110mm' ? 7 : 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(resolvedPaperSize === '50mm' ? 7 : resolvedPaperSize === '110mm' ? 8 : 7.4);
    [
      showCompanyContact ? hotelInfo?.address : null,
      showCompanyContact && hotelInfo?.phone ? `Tel: ${hotelInfo.phone}` : null,
      showCompanyContact ? hotelInfo?.email : null,
      showCompanyContact ? (hotelInfo?.tin_number ? `TIN: ${hotelInfo.tin_number}` : hotelInfo?.tax_number ? `TIN: ${hotelInfo.tax_number}` : null) : null,
    ].filter(Boolean).forEach((line) => {
      const lines = doc.splitTextToSize(line as string, contentWidth);
      doc.text(lines, pageWidth / 2, y, { align: 'center' });
      y += lines.length * (resolvedPaperSize === '50mm' ? 3.6 : resolvedPaperSize === '110mm' ? 4.5 : 4);
    });

    y += 1;
    y += 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(resolvedPaperSize === '50mm' ? 8.8 : resolvedPaperSize === '110mm' ? 10.5 : 9.4);
    doc.text('TAX INVOICE', pageWidth / 2, y, { align: 'center' });
    y += 4;
    doc.setFontSize(resolvedPaperSize === '50mm' ? 8 : resolvedPaperSize === '110mm' ? 9.2 : 8.6);
    doc.text(invoice.invoice_number, pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setTextColor(...darkColor);
  }

  const sectionLabelSize = resolvedPaperSize === 'A4' ? 8 : resolvedPaperSize === '50mm' ? 6.2 : resolvedPaperSize === '110mm' ? 7.4 : 6.8;
  const sectionTextSize = resolvedPaperSize === 'A4' ? 9 : resolvedPaperSize === '50mm' ? 6.9 : resolvedPaperSize === '110mm' ? 8.1 : 7.4;

  const drawSectionTitle = (title: string, topY: number) => {
    doc.setTextColor(...thermalLabelColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(sectionLabelSize);
    if (isThermal) {
      doc.text(title.toUpperCase(), pageWidth / 2, topY, { align: 'center' });
    } else {
      doc.text(title.toUpperCase(), margin, topY);
    }
    return topY + (resolvedPaperSize === 'A4' ? 5 : resolvedPaperSize === '50mm' ? 3.2 : resolvedPaperSize === '110mm' ? 4 : 3.6);
  };

  const drawInfoBlock = (label: string, lines: string[], x: number, topY: number, width: number) => {
    let nextY = topY;
    doc.setTextColor(...thermalLabelColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(sectionLabelSize);
    doc.text(label.toUpperCase(), x, nextY);
    nextY += resolvedPaperSize === 'A4' ? 5 : resolvedPaperSize === '50mm' ? 3.6 : resolvedPaperSize === '110mm' ? 4.4 : 4;

    doc.setTextColor(...darkColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(sectionTextSize);

    lines.filter(Boolean).forEach((line, index) => {
      const lineParts = doc.splitTextToSize(line, width);
      doc.setFont('helvetica', index === 0 ? 'bold' : 'normal');
      doc.text(lineParts, x, nextY);
      nextY += lineParts.length * (resolvedPaperSize === 'A4' ? 4 : resolvedPaperSize === '50mm' ? 3 : resolvedPaperSize === '110mm' ? 3.8 : 3.4);
    });

    return nextY;
  };

  const drawCenteredInfoBlock = (label: string, lines: string[], topY: number, width: number) => {
    let nextY = topY;
    const blockLines = lines.filter(Boolean);
    const lineHeight = resolvedPaperSize === '50mm' ? 3.6 : resolvedPaperSize === '110mm' ? 4.4 : 4.1;

    doc.setTextColor(...thermalLabelColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(sectionLabelSize);
    doc.text(label.toUpperCase(), pageWidth / 2, nextY, { align: 'center' });
    nextY += resolvedPaperSize === '50mm' ? 4.2 : resolvedPaperSize === '110mm' ? 5 : 4.6;

    doc.setTextColor(...darkColor);
    doc.setFontSize(sectionTextSize);

    blockLines.forEach((line, index) => {
      const lineParts = doc.splitTextToSize(line, width - 2);
      doc.setFont('helvetica', index === 0 ? 'bold' : 'normal');
      doc.text(lineParts, pageWidth / 2, nextY, { align: 'center' });
      nextY += lineParts.length * lineHeight;
    });

    return nextY + 1;
  };

  if (resolvedPaperSize === 'A4' && showCustomerDetails) {
    const blockTop = y;
    const leftWidth = (contentWidth / 2) - 6;
    const rightX = margin + leftWidth + 12;
    const rightWidth = pageWidth - margin - rightX;

    const hotelLines = [
      hotelInfo?.name || 'Hotel',
      hotelInfo?.address || '',
      hotelInfo?.phone ? `Phone: ${hotelInfo.phone}` : '',
      hotelInfo?.email ? `Email: ${hotelInfo.email}` : '',
      hotelInfo?.tin_number ? `TIN: ${hotelInfo.tin_number}` : hotelInfo?.tax_number ? `TIN: ${hotelInfo.tax_number}` : '',
    ];

    const customerLines = [
      customerName,
      customerPhone ? `Phone: ${customerPhone}` : '',
      customerEmail ? `Email: ${customerEmail}` : '',
      customerAddress ? `Address: ${customerAddress}` : '',
      customerTin ? `TIN: ${customerTin}` : '',
    ];

    const leftEndY = drawInfoBlock('From', hotelLines, margin, blockTop, leftWidth);
    const rightEndY = drawInfoBlock('Bill To', customerLines, rightX, blockTop, rightWidth);
    y = Math.max(leftEndY, rightEndY) + 4;
  } else if (showCustomerDetails) {
    y = drawCenteredInfoBlock('Bill To', [
      customerName,
      customerPhone ? `Phone: ${customerPhone}` : '',
      customerEmail ? `Email: ${customerEmail}` : '',
      customerAddress ? `Address: ${customerAddress}` : '',
      customerTin ? `TIN: ${customerTin}` : '',
    ], y, contentWidth) + 2;
  }

  y += resolvedPaperSize === 'A4' ? 8 : resolvedPaperSize === '50mm' ? 5 : resolvedPaperSize === '110mm' ? 7 : 6;

  y = drawSectionTitle('Invoice Items', y);

  const thermalBody = invoiceItems.map((item) => [
    `${item.description}${item.item_type ? `\n${formatLabel(item.item_type)} • ${item.quantity} x ${formatMoney(item.unit_price, currencySymbol)}` : `\n${item.quantity} x ${formatMoney(item.unit_price, currencySymbol)}`}`,
    formatMoney(item.total_price, currencySymbol),
  ]);

  const desktopBody = invoiceItems.map((item, index) => [
    `${index + 1}. ${item.description}`,
    formatLabel(item.item_type || 'service'),
    String(item.quantity),
    formatMoney(item.unit_price, currencySymbol),
    formatMoney(item.total_price, currencySymbol),
  ]);

  autoTable(doc, {
    startY: y,
    head: isThermal ? [['Item', 'Total']] : [['Item', 'Type', 'Qty', 'Unit Price', 'Total']],
    body: isThermal ? thermalBody : desktopBody,
    theme: isThermal ? 'plain' : 'grid',
    margin: { left: margin, right: margin },
    styles: {
      font: 'helvetica',
      fontSize: resolvedPaperSize === 'A4' ? 8.5 : resolvedPaperSize === '50mm' ? 6.4 : resolvedPaperSize === '110mm' ? 7.4 : 6.9,
      textColor: darkColor,
      cellPadding: isThermal ? { top: 1.5, right: 0.6, bottom: 1.7, left: 0.6 } : 2.2,
      lineColor: borderColor,
      lineWidth: isThermal ? 0 : 0.15,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: isThermal ? [255, 255, 255] as [number, number, number] : primaryColor,
      textColor: isThermal ? thermalMutedColor : [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: resolvedPaperSize === 'A4' ? 8 : resolvedPaperSize === '50mm' ? 6 : resolvedPaperSize === '110mm' ? 6.8 : 6.4,
      lineWidth: isThermal ? 0 : 0.15,
    },
    bodyStyles: {
      valign: 'top',
    },
    alternateRowStyles: isThermal ? undefined : {
      fillColor: [248, 250, 252],
    },
    columnStyles: isThermal
      ? {
          0: { cellWidth: contentWidth - (resolvedPaperSize === '50mm' ? 14 : isWideThermal ? 24 : 16) },
          1: { cellWidth: resolvedPaperSize === '50mm' ? 14 : isWideThermal ? 24 : 16, halign: 'right' },
        }
      : {
          0: { cellWidth: 78 },
          1: { cellWidth: 28, halign: 'center' },
          2: { cellWidth: 16, halign: 'center' },
          3: { cellWidth: 30, halign: 'right' },
          4: { cellWidth: 32, halign: 'right' },
        },
    didParseCell: (data) => {
      if (isThermal && data.section === 'body' && data.column.index === 0) {
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawCell: (data) => {
      if (isThermal && data.section === 'body' && data.column.index === 0) {
        const lineY = data.cell.y + data.cell.height;
        doc.setDrawColor(...borderColor);
        doc.setLineWidth(0.12);
        doc.line(margin + 1, lineY, pageWidth - margin - 1, lineY);
      }
    },
  });

  y = ((doc as any).lastAutoTable?.finalY || y) + (resolvedPaperSize === 'A4' ? 8 : resolvedPaperSize === '50mm' ? 4 : resolvedPaperSize === '110mm' ? 6 : 5);

  const totalsBoxWidth = resolvedPaperSize === 'A4' ? 78 : contentWidth;
  const totalsBoxX = resolvedPaperSize === 'A4' ? pageWidth - margin - totalsBoxWidth : margin;
  const totalsRows = [
    { label: 'Subtotal', value: formatMoney(invoice.subtotal, currencySymbol), color: darkColor },
    ...(Number(invoice.discount_amount || 0) > 0
      ? [{ label: 'Discount', value: `- ${formatMoney(invoice.discount_amount, currencySymbol)}`, color: [22, 163, 74] as [number, number, number] }]
      : []),
    { label: `Tax${taxRate > 0 ? ` (${taxRate}%)` : ''}`, value: formatMoney(invoice.tax_amount, currencySymbol), color: darkColor },
  ];
  const totalsHeight = 18 + totalsRows.length * (resolvedPaperSize === 'A4' ? 6.5 : resolvedPaperSize === '50mm' ? 4.8 : resolvedPaperSize === '110mm' ? 6 : 5.4);

  if (!isThermal) {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(totalsBoxX, y, totalsBoxWidth, totalsHeight, 1.5, 1.5, 'F');
  }

  let totalsY = y + 6;
  totalsRows.forEach((row) => {
    doc.setTextColor(...thermalLabelColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : resolvedPaperSize === '50mm' ? 6.3 : resolvedPaperSize === '110mm' ? 7.3 : 6.9);
    doc.text(row.label.toUpperCase(), totalsBoxX + 4, totalsY);
    doc.setTextColor(...(isThermal ? darkColor : row.color));
    doc.setFont('helvetica', isThermal ? 'bold' : 'normal');
    doc.text(row.value, totalsBoxX + totalsBoxWidth - 4, totalsY, { align: 'right' });
    totalsY += resolvedPaperSize === 'A4' ? 6.5 : resolvedPaperSize === '50mm' ? 5.2 : resolvedPaperSize === '110mm' ? 6.2 : 5.8;
  });

  doc.setDrawColor(...(isThermal ? darkColor : borderColor));
  doc.setLineWidth(isThermal ? 0.25 : 0.15);
  doc.line(totalsBoxX + 4, totalsY - 2, totalsBoxX + totalsBoxWidth - 4, totalsY - 2);
  doc.setTextColor(...thermalAccentColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(resolvedPaperSize === 'A4' ? 11 : resolvedPaperSize === '50mm' ? 8 : resolvedPaperSize === '110mm' ? 9.5 : 8.8);
  doc.text('GRAND TOTAL', totalsBoxX + 4, totalsY + 4);
  doc.text(formatMoney(invoice.total_amount, currencySymbol), totalsBoxX + totalsBoxWidth - 4, totalsY + 4, { align: 'right' });

  y += totalsHeight + (resolvedPaperSize === 'A4' ? 8 : resolvedPaperSize === '50mm' ? 5 : resolvedPaperSize === '110mm' ? 7 : 6);

  if (invoice.notes) {
    y = drawSectionTitle('Notes', y);
    doc.setTextColor(...darkColor);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(resolvedPaperSize === 'A4' ? 8.5 : resolvedPaperSize === '50mm' ? 6.1 : resolvedPaperSize === '110mm' ? 7.1 : 6.7);
    const noteLines = doc.splitTextToSize(invoice.notes, contentWidth);
    doc.text(noteLines, margin, y);
    y += noteLines.length * (resolvedPaperSize === 'A4' ? 4 : resolvedPaperSize === '50mm' ? 2.9 : resolvedPaperSize === '110mm' ? 3.6 : 3.2) + 4;
  }

  if (showQr) {
    const qrSize = resolvedPaperSize === 'A4' ? 24 : resolvedPaperSize === '50mm' ? 18 : resolvedPaperSize === '58mm' ? 20 : resolvedPaperSize === '110mm' ? 24 : 20;
    const qrX = pageWidth / 2 - qrSize / 2;
    doc.addImage(qrCodeDataUrl, 'PNG', qrX, y, qrSize, qrSize);
    y += qrSize + (resolvedPaperSize === 'A4' ? 6 : 5);

    doc.setTextColor(...thermalLabelColor);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(resolvedPaperSize === 'A4' ? 7.5 : resolvedPaperSize === '50mm' ? 6 : resolvedPaperSize === '110mm' ? 6.8 : 6.4);
    doc.text('Scan receipt', pageWidth / 2, y, { align: 'center' });
    y += resolvedPaperSize === 'A4' ? 6 : 5;
  }

  const footerY = isThermal ? y + 4 : Math.min(y + 6, pageHeight - 18);
  doc.setDrawColor(...(isThermal ? borderColor : borderColor));
  doc.line(margin, footerY, pageWidth - margin, footerY);
  doc.setTextColor(...thermalLabelColor);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : resolvedPaperSize === '50mm' ? 6.2 : resolvedPaperSize === '110mm' ? 7 : 6.6);
  doc.text('This is a computer-generated tax invoice.', pageWidth / 2, footerY + 5, { align: 'center' });
  doc.setTextColor(...darkColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(resolvedPaperSize === 'A4' ? 8 : resolvedPaperSize === '50mm' ? 6.6 : resolvedPaperSize === '110mm' ? 7.5 : 7.2);
  const thankYouLines = doc.splitTextToSize(`Thank you for choosing ${hotelInfo?.name || 'our hotel'}!`, contentWidth - (isThermal ? 2 : 0));
  doc.text(thankYouLines, pageWidth / 2, footerY + (resolvedPaperSize === 'A4' ? 10 : 8), {
    align: 'center',
  });

  return doc;
}

export async function printHotelInvoice(
  invoice: HotelInvoice & { items?: InvoiceItem[] },
  booking?: HotelBooking,
  hotelInfo?: HotelInfoData,
  currencySymbol: string = 'RF',
  paperSize: InvoicePaperSize = 'A4',
  invoiceStyle: InvoiceStyle = 'formal',
  showQr: boolean = true,
  showCompanyContact: boolean = true,
  showCustomerDetails: boolean = true
) {
  const doc = await generateHotelInvoicePdf(invoice, booking, hotelInfo, currencySymbol, paperSize, invoiceStyle, showQr, showCompanyContact, showCustomerDetails);
  doc.autoPrint();
  const blobUrl = doc.output('bloburl');
  window.open(blobUrl, '_blank');
}

export async function downloadHotelInvoice(
  invoice: HotelInvoice & { items?: InvoiceItem[] },
  booking?: HotelBooking,
  hotelInfo?: HotelInfoData,
  currencySymbol: string = 'RF',
  paperSize: InvoicePaperSize = 'A4',
  invoiceStyle: InvoiceStyle = 'formal',
  showQr: boolean = true,
  showCompanyContact: boolean = true,
  showCustomerDetails: boolean = true
) {
  const doc = await generateHotelInvoicePdf(invoice, booking, hotelInfo, currencySymbol, paperSize, invoiceStyle, showQr, showCompanyContact, showCustomerDetails);
  doc.save(`Invoice-${invoice.invoice_number}.pdf`);
}
