import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import type { HotelInfo, HotelOrder } from '@/types/hotel';
import { getPdfPageFormat, normalizeInvoiceStyle, normalizePaperSize, type InvoiceStyle, type PaperSize } from '@/utils/paperSettings';

function estimateOrderInvoiceHeight(order: HotelOrder, paperSize: Exclude<PaperSize, 'A4'>) {
  const isCompact = paperSize === '50mm' || paperSize === '58mm';
  const isWide = paperSize === '110mm';
  const guestLineWidth = isCompact ? 18 : isWide ? 38 : 26;
  const itemLineWidth = isCompact ? 16 : isWide ? 32 : 24;

  const activeItems = order.items.filter(i => i.status !== 'cancelled');

  const guestLines = Math.max(
    1,
    Math.ceil((order.customer_name || order.booking?.guest?.first_name || 'Walk-in Guest').length / guestLineWidth)
  );
  const itemLines = activeItems.reduce((sum, item) => {
    return sum + Math.max(1, Math.ceil(item.name.length / itemLineWidth)) + 1;
  }, 0);

  return Math.max(
    paperSize === '50mm' ? 210 : paperSize === '58mm' ? 215 : paperSize === '110mm' ? 250 : 235,
    118 + guestLines * 5 + itemLines * 9
  );
}

export function printOrderInvoice(
  order: HotelOrder,
  hotelInfo?: HotelInfo,
  currencySymbol: string = 'RF',
  paperSize: PaperSize = 'A4',
  invoiceStyle: InvoiceStyle = 'formal',
  showCompanyContact: boolean = true,
  showCustomerDetails: boolean = true
) {
  const resolvedPaperSize = normalizePaperSize(paperSize);
  const resolvedInvoiceStyle = normalizeInvoiceStyle(invoiceStyle);
  const isThermal = resolvedPaperSize !== 'A4';
  const isCompactThermal = resolvedPaperSize === '50mm' || resolvedPaperSize === '58mm';
  const is58mm = resolvedPaperSize === '58mm';
  const is50mm = resolvedPaperSize === '50mm';
  const is80mm = resolvedPaperSize === '80mm';
  const is110mm = resolvedPaperSize === '110mm';

  // Filter out cancelled items for printing
  const printableOrder: HotelOrder = {
    ...order,
    items: order.items.filter(i => i.status !== 'cancelled'),
  };

  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: getPdfPageFormat(
      resolvedPaperSize,
      isThermal
        ? estimateOrderInvoiceHeight(printableOrder, resolvedPaperSize as Exclude<PaperSize, 'A4'>)
        : undefined
    )
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  // ─── margin per paper size ───────────────────────────────────────────────
  const margin =
    is50mm || is58mm ? 3
    : is80mm         ? 4
    : is110mm        ? 6
    :                  20; // A4

  const printableWidth = pageWidth - margin * 2;

  const primaryColor: [number, number, number] =
    resolvedInvoiceStyle === 'modern' ? [29, 78, 216] : [71, 85, 105];
  const darkColor: [number, number, number] = [30, 41, 59];
  const grayColor: [number, number, number] = [100, 116, 139];

  const formatPrice = (amount: number) => {
    if (currencySymbol === 'RF') {
      return `${currencySymbol} ${Math.round(amount).toLocaleString()}`;
    }
    return `${currencySymbol}${Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // A4 PATH (unchanged)
  // ─────────────────────────────────────────────────────────────────────────
  if (resolvedPaperSize === 'A4') {
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 36, 'F');

    if (hotelInfo?.logo_url) {
      try {
        doc.addImage(hotelInfo.logo_url, 'PNG', 20, 7, 22, 22);
      } catch {
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(hotelInfo?.name || 'HOTEL', 20, 20);
      }
    } else {
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(hotelInfo?.name || 'HOTEL', 20, 20);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    let headerY = 13;
    const headerRightX = pageWidth - 20;
    doc.text('ORDER INVOICE', headerRightX, headerY, { align: 'right' });
    headerY += 6;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`#${order.order_number}`, headerRightX, headerY, { align: 'right' });
    headerY += 6;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(format(new Date(order.created_at), 'MMMM dd, yyyy HH:mm'), headerRightX, headerY, { align: 'right' });

    let yPos = 55;
    doc.setFontSize(7);
    doc.setTextColor(...grayColor);
    doc.text('ESTABLISHMENT:', 20, yPos);
    doc.setTextColor(...darkColor);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    yPos += 5;
    doc.text(hotelInfo?.name || 'Hotel Establishment', 20, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    if (showCompanyContact && hotelInfo?.address) { yPos += 4; doc.text(hotelInfo.address, 20, yPos); }
    if (showCompanyContact && hotelInfo?.phone)   { yPos += 4; doc.text(`Tel: ${hotelInfo.phone}`, 20, yPos); }

    yPos = 55;
    const guestX = pageWidth / 2 + 10;
    doc.setFontSize(7);
    doc.setTextColor(...grayColor);
    doc.text('BILLED TO:', guestX, yPos);
    doc.setTextColor(...darkColor);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    yPos += 5;
    const guestName = order.customer_name
      ? order.customer_name
      : order.booking?.guest
        ? `${order.booking.guest.first_name} ${order.booking.guest.last_name}`
        : 'Walk-in Guest';
    if (showCustomerDetails) doc.text(guestName, guestX, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    yPos += 4;
    if (showCustomerDetails && order.customer_tin)     { doc.text(`TIN: ${order.customer_tin}`, guestX, yPos);         yPos += 4; }
    if (showCustomerDetails && order.customer_phone)   { doc.text(`Phone: ${order.customer_phone}`, guestX, yPos);     yPos += 4; }
    if (showCustomerDetails && order.customer_email)   { doc.text(`Email: ${order.customer_email}`, guestX, yPos);     yPos += 4; }
    if (showCustomerDetails && order.customer_address) { doc.text(`Address: ${order.customer_address}`, guestX, yPos); yPos += 4; }
    if (showCustomerDetails && order.table_number)     { doc.text(`Table: ${order.table_number}`, guestX, yPos);       yPos += 4; }
    if (showCustomerDetails && order.booking?.room?.room_number) {
      doc.text(`Room: ${order.booking.room.room_number}`, guestX, yPos);
      yPos += 4;
    }

    autoTable(doc, {
      startY: 85,
      head: [['Item', 'Qty', 'Price', 'Total']],
      body: printableOrder.items.map(item => [
        item.name,
        item.quantity.toString(),
        formatPrice(item.unit_price),
        formatPrice(item.total_price),
      ]),
      theme: 'striped',
      headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold', halign: 'left' },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { halign: 'center', cellWidth: 20 },
        2: { halign: 'right',  cellWidth: 30 },
        3: { halign: 'right',  cellWidth: 30 },
      },
      margin: { left: margin, right: margin },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL AMOUNT:', pageWidth - 80, finalY);
    doc.text(formatPrice(order.total_amount), pageWidth - 20, finalY, { align: 'right' });

    const footerY = doc.internal.pageSize.getHeight() - 20;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...grayColor);
    doc.text('Thank you for your order!', pageWidth / 2, footerY, { align: 'center' });

  } else {
    // ─────────────────────────────────────────────────────────────────────
    // THERMAL PATH  (50 / 58 / 80 / 110 mm)
    // ─────────────────────────────────────────────────────────────────────

    // ── font size scale ──────────────────────────────────────────────────
    const fs = {
      hotelName : is58mm || is50mm ? 9  : is80mm ? 10 : 12,
      label     : is58mm || is50mm ? 6  : is80mm ? 7  : 8,
      orderNum  : is58mm || is50mm ? 8  : is80mm ? 9  : 10,
      date      : is58mm || is50mm ? 5.5: is80mm ? 6  : 7,
      info      : is58mm || is50mm ? 6  : is80mm ? 7  : 8,
      tableHead : is58mm || is50mm ? 6  : is80mm ? 7  : 8,
      tableBody : is58mm || is50mm ? 6  : is80mm ? 6.5: 7,
      total     : is58mm || is50mm ? 7  : is80mm ? 8  : 9,
      footer    : is58mm || is50mm ? 6  : is80mm ? 7  : 8,
    };

    // ── column widths that actually fit ─────────────────────────────────
    // 58mm printable ≈ 52mm → margin 3 each side → 46mm usable
    const colQty   = is58mm || is50mm ? 6  : is80mm ? 8  : 12;
    const colPrice = is58mm || is50mm ? 11 : is80mm ? 14 : 20;
    const colTotal = is58mm || is50mm ? 13 : is80mm ? 16 : 20;
    const colName  = printableWidth - colQty - colPrice - colTotal;

    let yPos = 6;

    // ── Hotel name ───────────────────────────────────────────────────────
    doc.setFontSize(fs.hotelName);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkColor);
    doc.text(hotelInfo?.name || 'Hotel', pageWidth / 2, yPos, { align: 'center' });
    yPos += fs.hotelName * 0.45;

    // ── Subtitle ─────────────────────────────────────────────────────────
    if (showCompanyContact && hotelInfo?.address) {
      doc.setFontSize(fs.label);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...grayColor);
      const addrLines = doc.splitTextToSize(hotelInfo.address, printableWidth);
      doc.text(addrLines, pageWidth / 2, yPos, { align: 'center' });
      yPos += addrLines.length * (fs.label * 0.42);
    }
    if (showCompanyContact && hotelInfo?.phone) {
      doc.setFontSize(fs.label);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...grayColor);
      doc.text(`Tel: ${hotelInfo.phone}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += fs.label * 0.42;
    }
    yPos += 2;

    // ── Divider ──────────────────────────────────────────────────────────
    const drawDivider = (y: number, dashed = false) => {
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.2);
      if (dashed) {
        doc.setLineDashPattern([1, 1], 0);
      } else {
        doc.setLineDashPattern([], 0);
      }
      doc.line(margin, y, pageWidth - margin, y);
      doc.setLineDashPattern([], 0);
    };

    drawDivider(yPos);
    yPos += 3;

    // ── ORDER INVOICE + number ───────────────────────────────────────────
    doc.setFontSize(fs.label);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...grayColor);
    doc.text('ORDER INVOICE', pageWidth / 2, yPos, { align: 'center' });
    yPos += fs.label * 0.42 + 1.5;

    doc.setFontSize(fs.orderNum);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkColor);
    doc.text(`#${order.order_number}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += fs.orderNum * 0.42 + 1.5;

    doc.setFontSize(fs.date);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...grayColor);
    doc.text(
      format(new Date(order.created_at), 'dd/MM/yyyy HH:mm'),
      pageWidth / 2,
      yPos,
      { align: 'center' }
    );
    yPos += fs.date * 0.42 + 2;

    drawDivider(yPos, true);
    yPos += 3;

    // ── Guest / Table / Room info ─────────────────────────────────────────
    doc.setFontSize(fs.info);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...darkColor);

    const guestName = order.customer_name
      ? order.customer_name
      : order.booking?.guest
        ? `${order.booking.guest.first_name} ${order.booking.guest.last_name}`
        : 'Walk-in Guest';

    const infoRows: string[] = [];
    if (showCustomerDetails) infoRows.push(`Guest : ${guestName}`);
    if (showCustomerDetails && order.customer_tin)   infoRows.push(`TIN   : ${order.customer_tin}`);
    if (showCustomerDetails && order.customer_phone) infoRows.push(`Phone : ${order.customer_phone}`);
    if (order.table_number)                          infoRows.push(`Table : ${order.table_number}`);
    if (order.booking?.room?.room_number)            infoRows.push(`Room  : ${order.booking.room.room_number}`);

    for (const row of infoRows) {
      const lines = doc.splitTextToSize(row, printableWidth);
      doc.text(lines, margin, yPos);
      yPos += lines.length * (fs.info * 0.42 + 0.5);
    }

    if (infoRows.length > 0) yPos += 1;
    drawDivider(yPos, true);
    yPos += 3;

    // ── Items table ───────────────────────────────────────────────────────
    autoTable(doc, {
      startY: yPos,
      head: [['Item', 'Qty', 'Price', 'Total']],
      body: printableOrder.items.map(item => [
        item.name,
        item.quantity.toString(),
        formatPrice(item.unit_price),
        formatPrice(item.total_price),
      ]),
      theme: 'plain',
      headStyles: {
        textColor: [0, 0, 0],
        fontSize: fs.tableHead,
        fontStyle: 'bold',
        halign: 'left',
        cellPadding: { top: 1, bottom: 1, left: 0, right: 1 },
        lineWidth: { bottom: 0.3 },
        lineColor: [180, 180, 180],
      },
      bodyStyles: {
        fontSize: fs.tableBody,
        cellPadding: { top: 0.8, bottom: 0.8, left: 0, right: 1 },
        textColor: [30, 41, 59],
        lineWidth: 0,
      },
      alternateRowStyles: {
        fillColor: [248, 249, 250],
      },
      columnStyles: {
        0: { cellWidth: colName,  overflow: 'linebreak' },
        1: { cellWidth: colQty,   halign: 'center' },
        2: { cellWidth: colPrice, halign: 'right' },
        3: { cellWidth: colTotal, halign: 'right' },
      },
      margin: { left: margin, right: margin },
      tableWidth: printableWidth,
    });

    yPos = (doc as any).lastAutoTable.finalY + 2;

    // ── Totals block ──────────────────────────────────────────────────────
    drawDivider(yPos);
    yPos += 3;

    const subtotal = Number(order.subtotal || 0);
    const discountAmt = Number(order.discount_amount || 0);
    const taxAmt = Number(order.tax_amount || 0);
    const totalAmt = Number(order.total_amount || 0);

    const totalsRows: [string, string][] = [];
    if (subtotal > 0 && subtotal !== totalAmt) totalsRows.push(['Subtotal', formatPrice(subtotal)]);
    if (discountAmt > 0)                       totalsRows.push(['Discount', `-${formatPrice(discountAmt)}`]);
    if (taxAmt > 0)                            totalsRows.push(['Tax', formatPrice(taxAmt)]);

    doc.setFontSize(fs.info);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...darkColor);

    for (const [label, value] of totalsRows) {
      doc.text(label, margin, yPos);
      doc.text(value, pageWidth - margin, yPos, { align: 'right' });
      yPos += fs.info * 0.42 + 1;
    }

    // Grand total row — bold + slightly larger
    yPos += 1;
    doc.setFontSize(fs.total);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkColor);
    doc.text('TOTAL', margin, yPos);
    doc.text(formatPrice(totalAmt), pageWidth - margin, yPos, { align: 'right' });
    yPos += fs.total * 0.42 + 3;

    // ── Payment method (if available) ────────────────────────────────────
    if ((order as any).payment_method) {
      doc.setFontSize(fs.info);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...grayColor);
      doc.text(
        `Paid via: ${String((order as any).payment_method).toUpperCase()}`,
        pageWidth / 2,
        yPos,
        { align: 'center' }
      );
      yPos += fs.info * 0.42 + 2;
    }

    drawDivider(yPos, true);
    yPos += 4;

    // ── Footer ────────────────────────────────────────────────────────────
    doc.setFontSize(fs.footer);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...grayColor);
    doc.text('Thank you for your order!', pageWidth / 2, yPos, { align: 'center' });
    yPos += fs.footer * 0.42 + 2;

    if (hotelInfo?.phone) {
      doc.text(`MOMO: 61043`, pageWidth / 2, yPos, { align: 'center' });
      yPos += fs.footer * 0.42 + 1;
    }

    doc.text(format(new Date(), 'dd/MM/yyyy HH:mm'), pageWidth / 2, yPos, { align: 'center' });
  }

  doc.autoPrint();
  const blobUrl = doc.output('bloburl');
  window.open(blobUrl, '_blank');
}