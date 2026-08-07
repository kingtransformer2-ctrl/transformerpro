import React, { createContext, useContext, useEffect, useState } from 'react';
import { useSettings, useCompanyProfile } from '@/hooks/useSettings';
import { normalizeInvoiceStyle, normalizePaperSize, normalizeReceiptStyle } from '@/utils/paperSettings';

interface SystemSettings {
  currency: string;
  timezone: string;
  date_format: string;
  language: string;
}

interface ThemeSettings {
  primary_color: string;
  dark_mode: boolean;
  font_size: string;
}

interface NotificationSettings {
  enable_email: boolean;
  enable_low_stock_alerts: boolean;
  enable_expiry_alerts: boolean;
}

interface StockSettings {
  low_stock_threshold: number;
  enable_expiry_alerts: boolean;
  expiry_alert_days: number;
  auto_calculate_stock: boolean;
}

interface POSSettings {
  pos_name: string;
  default_payment_method: string;
  enable_discounts: boolean;
  max_discount_percent: number;
  enable_customer_display: boolean;
  enable_tax: boolean;
  tax_rate: number;
  tax_name: string;
  tax_inclusive: boolean;
}

interface ReceiptSettings {
  header_text: string;
  footer_text: string;
  show_logo: boolean;
  paper_size: string;
  receipt_style: string;
  invoice_style: string;
  show_qr: boolean;
  show_company_contact: boolean;
  show_customer_details: boolean;
  show_payment_details: boolean;
}

interface CompanyProfile {
  id: string;
  company_name: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  logo_url?: string;
  business_hours?: any;
  tax_rates?: any;
}

interface SettingsContextType {
  systemSettings: SystemSettings;
  themeSettings: ThemeSettings;
  notificationSettings: NotificationSettings;
  stockSettings: StockSettings;
  posSettings: POSSettings;
  receiptSettings: ReceiptSettings;
  companyProfile: CompanyProfile | null;
  isLoading: boolean;
  formatCurrency: (amount: number) => string;
  formatDate: (date: Date | string) => string;
  getCurrencySymbol: () => string;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  currency: 'RWF',
  timezone: 'Africa/Kigali',
  date_format: 'DD/MM/YYYY',
  language: 'en',
};

const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  primary_color: 'hsl(221.2, 83.2%, 53.3%)',
  dark_mode: false,
  font_size: 'medium',
};

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enable_email: false,
  enable_low_stock_alerts: true,
  enable_expiry_alerts: true,
};

const DEFAULT_STOCK_SETTINGS: StockSettings = {
  low_stock_threshold: 10,
  enable_expiry_alerts: true,
  expiry_alert_days: 30,
  auto_calculate_stock: true,
};

const DEFAULT_POS_SETTINGS: POSSettings = {
  pos_name: 'Silver POS',
  default_payment_method: 'cash',
  enable_discounts: true,
  max_discount_percent: 50,
  enable_customer_display: true,
  enable_tax: false,
  tax_rate: 0,
  tax_name: 'Tax',
  tax_inclusive: true,
};

const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  header_text: 'Thank you for your purchase!',
  footer_text: 'Visit us again!',
  show_logo: true,
  paper_size: '50mm',
  receipt_style: 'classic',
  invoice_style: 'formal',
  show_qr: true,
  show_company_contact: true,
  show_customer_details: true,
  show_payment_details: true,
};

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { data: systemSettingsData } = useSettings('system');
  const { data: themeSettingsData } = useSettings('theme');
  const { data: notificationSettingsData } = useSettings('notifications');
  const { data: stockSettingsData } = useSettings('stock');
  const { data: posSettingsData } = useSettings('pos');
  const { data: receiptSettingsData } = useSettings('receipt');
  const { data: companyData, isLoading: companyLoading } = useCompanyProfile();

  const [systemSettings, setSystemSettings] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(DEFAULT_THEME_SETTINGS);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [stockSettings, setStockSettings] = useState<StockSettings>(DEFAULT_STOCK_SETTINGS);
  const [posSettings, setPosSettings] = useState<POSSettings>(DEFAULT_POS_SETTINGS);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(DEFAULT_RECEIPT_SETTINGS);

  const isLoading = companyLoading;

  // Helper function to convert settings array to object
  const settingsArrayToObject = (settingsArray: any[]) => {
    return settingsArray?.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {}) || {};
  };

  // Update system settings
  useEffect(() => {
    if (systemSettingsData) {
      const settingsMap = settingsArrayToObject(systemSettingsData);
      setSystemSettings({
        currency: settingsMap.currency || DEFAULT_SYSTEM_SETTINGS.currency,
        timezone: settingsMap.timezone || DEFAULT_SYSTEM_SETTINGS.timezone,
        date_format: settingsMap.date_format || DEFAULT_SYSTEM_SETTINGS.date_format,
        language: settingsMap.language || DEFAULT_SYSTEM_SETTINGS.language,
      });
    }
  }, [systemSettingsData]);

  // Update theme settings and apply them
  useEffect(() => {
    if (themeSettingsData) {
      const settingsMap = settingsArrayToObject(themeSettingsData);
      const newThemeSettings = {
        primary_color: settingsMap.primary_color || DEFAULT_THEME_SETTINGS.primary_color,
        dark_mode: settingsMap.dark_mode === 'true' || settingsMap.dark_mode === true,
        font_size: settingsMap.font_size || DEFAULT_THEME_SETTINGS.font_size,
      };
      setThemeSettings(newThemeSettings);

      // Apply theme changes to the DOM
      const root = document.documentElement;
      
      // Apply dark mode
      if (newThemeSettings.dark_mode) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }

      // Apply primary color by updating CSS custom property
      root.style.setProperty('--primary', newThemeSettings.primary_color);

      // Apply font size
      const fontSizeMap = {
        small: '14px',
        medium: '16px',
        large: '18px',
        'extra-large': '20px',
      };
      root.style.setProperty('--base-font-size', fontSizeMap[newThemeSettings.font_size as keyof typeof fontSizeMap] || '16px');
    }
  }, [themeSettingsData]);

  // Update other settings
  useEffect(() => {
    if (notificationSettingsData) {
      const settingsMap = settingsArrayToObject(notificationSettingsData);
      setNotificationSettings({
        enable_email: Boolean(settingsMap.enable_email),
        enable_low_stock_alerts: Boolean(settingsMap.enable_low_stock_alerts),
        enable_expiry_alerts: Boolean(settingsMap.enable_expiry_alerts),
      });
    }
  }, [notificationSettingsData]);

  useEffect(() => {
    if (stockSettingsData) {
      const settingsMap = settingsArrayToObject(stockSettingsData);
      setStockSettings({
        low_stock_threshold: Number(settingsMap.low_stock_threshold) || DEFAULT_STOCK_SETTINGS.low_stock_threshold,
        enable_expiry_alerts: Boolean(settingsMap.enable_expiry_alerts),
        expiry_alert_days: Number(settingsMap.expiry_alert_days) || DEFAULT_STOCK_SETTINGS.expiry_alert_days,
        auto_calculate_stock: Boolean(settingsMap.auto_calculate_stock),
      });
    }
  }, [stockSettingsData]);

  useEffect(() => {
    if (posSettingsData) {
      const settingsMap = settingsArrayToObject(posSettingsData);
      setPosSettings({
        pos_name: settingsMap.pos_name || DEFAULT_POS_SETTINGS.pos_name,
        default_payment_method: settingsMap.default_payment_method || DEFAULT_POS_SETTINGS.default_payment_method,
        enable_discounts: Boolean(settingsMap.enable_discounts),
        max_discount_percent: Number(settingsMap.max_discount_percent) || DEFAULT_POS_SETTINGS.max_discount_percent,
        enable_customer_display: Boolean(settingsMap.enable_customer_display),
        enable_tax: Boolean(settingsMap.enable_tax),
        tax_rate: Number(settingsMap.tax_rate) || DEFAULT_POS_SETTINGS.tax_rate,
        tax_name: settingsMap.tax_name || DEFAULT_POS_SETTINGS.tax_name,
        tax_inclusive: settingsMap.tax_inclusive !== undefined ? Boolean(settingsMap.tax_inclusive) : DEFAULT_POS_SETTINGS.tax_inclusive,
      });
    }
  }, [posSettingsData]);

  useEffect(() => {
    if (receiptSettingsData) {
      const settingsMap = settingsArrayToObject(receiptSettingsData);
      setReceiptSettings({
        header_text: settingsMap.header_text || DEFAULT_RECEIPT_SETTINGS.header_text,
        footer_text: settingsMap.footer_text || DEFAULT_RECEIPT_SETTINGS.footer_text,
        show_logo: Boolean(settingsMap.show_logo),
        paper_size: normalizePaperSize(settingsMap.paper_size || DEFAULT_RECEIPT_SETTINGS.paper_size),
        receipt_style: normalizeReceiptStyle(settingsMap.receipt_style || DEFAULT_RECEIPT_SETTINGS.receipt_style),
        invoice_style: normalizeInvoiceStyle(settingsMap.invoice_style || DEFAULT_RECEIPT_SETTINGS.invoice_style),
        show_qr: settingsMap.show_qr !== undefined ? Boolean(settingsMap.show_qr) : DEFAULT_RECEIPT_SETTINGS.show_qr,
        show_company_contact: settingsMap.show_company_contact !== undefined ? Boolean(settingsMap.show_company_contact) : DEFAULT_RECEIPT_SETTINGS.show_company_contact,
        show_customer_details: settingsMap.show_customer_details !== undefined ? Boolean(settingsMap.show_customer_details) : DEFAULT_RECEIPT_SETTINGS.show_customer_details,
        show_payment_details: settingsMap.show_payment_details !== undefined ? Boolean(settingsMap.show_payment_details) : DEFAULT_RECEIPT_SETTINGS.show_payment_details,
      });
    }
  }, [receiptSettingsData]);

  // Currency formatting function
  const getCurrencySymbol = () => {
    const currencySymbols: { [key: string]: string } = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      INR: '₹',
      CAD: 'C$',
      RWF: 'RF',
    };
    return currencySymbols[systemSettings.currency] || systemSettings.currency;
  };

  const formatCurrency = (amount: number) => {
    const symbol = getCurrencySymbol();
    // RWF doesn't use decimal places
    if (systemSettings.currency === 'RWF') {
      return `${symbol} ${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Date formatting function
  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    switch (systemSettings.date_format) {
      case 'MM/DD/YYYY':
        return dateObj.toLocaleDateString('en-US');
      case 'YYYY-MM-DD':
        return dateObj.toISOString().split('T')[0];
      case 'DD/MM/YYYY':
      default:
        return dateObj.toLocaleDateString('en-GB');
    }
  };

  const value: SettingsContextType = {
    systemSettings,
    themeSettings,
    notificationSettings,
    stockSettings,
    posSettings,
    receiptSettings,
    companyProfile: companyData?.[0] || null,
    isLoading,
    formatCurrency,
    formatDate,
    getCurrencySymbol,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettingsContext must be used within a SettingsProvider');
  }
  return context;
}
