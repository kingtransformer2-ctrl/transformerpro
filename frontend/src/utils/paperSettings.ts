export type PaperSize = '50mm' | '58mm' | '80mm' | '110mm' | 'A4';
export type ReceiptStyle = 'classic' | 'modern';
export type InvoiceStyle = 'formal' | 'modern';

export interface PaperSettings {
  id: PaperSize;
  label: string;
  description: string;
  size: string;
  width: string;
  pdfWidthMm: number;
  fontSize: string;
  margin: string;
  pagePadding: string;
  shellPadding: string;
  titleFontSize: string;
  sectionLabelSize: string;
  totalFontSize: string;
  qrSize: number;
  isThermal: boolean;
  isCompact: boolean;
  minThermalHeightMm: number;
}

export const PAPER_SIZE_OPTIONS: Array<{
  value: PaperSize;
  label: string;
  description: string;
}> = [
  {
    value: '50mm',
    label: '50mm (Compact Roll)',
    description: 'Best for very small portable receipt printers.',
  },
  {
    value: '58mm',
    label: '58mm (Small Roll)',
    description: 'Common small thermal paper with a little more room.',
  },
  {
    value: '80mm',
    label: '80mm (Standard Roll)',
    description: 'The most common thermal receipt paper size.',
  },
  {
    value: '110mm',
    label: '110mm (Wide Roll)',
    description: 'Wide roll paper for more readable invoices and receipts.',
  },
  {
    value: 'A4',
    label: 'A4 (Full Page)',
    description: 'Best for office printers and formal invoice printing.',
  },
];

export const RECEIPT_STYLE_OPTIONS: Array<{
  value: ReceiptStyle;
  label: string;
  description: string;
}> = [
  {
    value: 'classic',
    label: 'Classic Receipt',
    description: 'Bold high-contrast receipt style for thermal printers.',
  },
  {
    value: 'modern',
    label: 'Modern Receipt',
    description: 'Cleaner rounded layout with softer grouping.',
  },
];

export const INVOICE_STYLE_OPTIONS: Array<{
  value: InvoiceStyle;
  label: string;
  description: string;
}> = [
  {
    value: 'formal',
    label: 'Formal Invoice',
    description: 'Professional invoice style with restrained business colors.',
  },
  {
    value: 'modern',
    label: 'Modern Invoice',
    description: 'More branded invoice style with stronger accents.',
  },
];

const PAPER_SETTINGS_MAP: Record<PaperSize, PaperSettings> = {
  '50mm': {
    id: '50mm',
    label: '50mm (Compact Roll)',
    description: 'Compact thermal roll paper',
    size: '50mm auto',
    width: '46mm',
    pdfWidthMm: 50,
    fontSize: '10px',
    margin: '1mm',
    pagePadding: '1.5mm',
    shellPadding: '8px',
    titleFontSize: '16px',
    sectionLabelSize: '9px',
    totalFontSize: '15px',
    qrSize: 84,
    isThermal: true,
    isCompact: true,
    minThermalHeightMm: 220,
  },
  '58mm': {
    id: '58mm',
    label: '58mm (Small Roll)',
    description: 'Small thermal roll paper',
    size: '58mm auto',
    width: '52mm',
    pdfWidthMm: 58,
    fontSize: '11px',
    margin: '1mm',
    pagePadding: '1.8mm',
    shellPadding: '8px',
    titleFontSize: '18px',
    sectionLabelSize: '10px',
    totalFontSize: '16px',
    qrSize: 88,
    isThermal: true,
    isCompact: true,
    minThermalHeightMm: 220,
  },
  '80mm': {
    id: '80mm',
    label: '80mm (Standard Roll)',
    description: 'Standard thermal roll paper',
    size: '80mm auto',
    width: '74mm',
    pdfWidthMm: 80,
    fontSize: '12px',
    margin: '2mm',
    pagePadding: '2.5mm',
    shellPadding: '10px',
    titleFontSize: '20px',
    sectionLabelSize: '10px',
    totalFontSize: '17px',
    qrSize: 96,
    isThermal: true,
    isCompact: false,
    minThermalHeightMm: 235,
  },
  '110mm': {
    id: '110mm',
    label: '110mm (Wide Roll)',
    description: 'Wide roll paper for detailed printouts',
    size: '110mm auto',
    width: '102mm',
    pdfWidthMm: 110,
    fontSize: '12px',
    margin: '3mm',
    pagePadding: '4mm',
    shellPadding: '14px',
    titleFontSize: '22px',
    sectionLabelSize: '11px',
    totalFontSize: '18px',
    qrSize: 110,
    isThermal: true,
    isCompact: false,
    minThermalHeightMm: 250,
  },
  A4: {
    id: 'A4',
    label: 'A4 (Full Page)',
    description: 'Full-page office printer paper',
    size: '210mm 297mm',
    width: '190mm',
    pdfWidthMm: 210,
    fontSize: '12px',
    margin: '10mm',
    pagePadding: '10mm',
    shellPadding: '18px',
    titleFontSize: '26px',
    sectionLabelSize: '11px',
    totalFontSize: '22px',
    qrSize: 120,
    isThermal: false,
    isCompact: false,
    minThermalHeightMm: 297,
  },
};

export const normalizePaperSize = (paperSize?: string | null): PaperSize => {
  if (!paperSize) {
    return '50mm';
  }

  return paperSize in PAPER_SETTINGS_MAP
    ? (paperSize as PaperSize)
    : '50mm';
};

export const normalizeReceiptStyle = (style?: string | null): ReceiptStyle => {
  if (style === 'modern') {
    return 'modern';
  }

  return 'classic';
};

export const normalizeInvoiceStyle = (style?: string | null): InvoiceStyle => {
  if (style === 'modern') {
    return 'modern';
  }

  return 'formal';
};

export const getPaperSettings = (paperSize: PaperSize | string = '50mm'): PaperSettings => {
  return PAPER_SETTINGS_MAP[normalizePaperSize(paperSize)];
};

export const getPdfPageFormat = (
  paperSize: PaperSize | string = '50mm',
  estimatedHeightMm?: number
): 'a4' | [number, number] => {
  const settings = getPaperSettings(paperSize);

  if (!settings.isThermal) {
    return 'a4';
  }

  return [
    settings.pdfWidthMm,
    Math.max(estimatedHeightMm ?? settings.minThermalHeightMm, settings.minThermalHeightMm),
  ];
};
