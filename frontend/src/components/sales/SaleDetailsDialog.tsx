import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiClient } from "@/integrations/supabase/client";
import { Sale, SaleItem } from "@/types/inventory";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { printSaleReceipt, downloadSaleReceipt } from "@/utils/saleReceiptPdf";
import { Receipt, User, Phone, Calendar, CreditCard, FileText, Printer, Download } from "lucide-react";

interface SaleDetailsDialogProps {
  sale: Sale | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaleDetailsDialog({ sale, open, onOpenChange }: SaleDetailsDialogProps) {
  const { formatCurrency, formatDate, companyProfile, getCurrencySymbol, posSettings, receiptSettings } = useSettingsContext();
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sale && open) {
      fetchSaleItems();
    }
  }, [sale, open]);

  const fetchSaleItems = async () => {
    if (!sale) return;
    
    setLoading(true);
    try {
      const { data } = await apiClient
        .from('sale_items')
        .select('*, product:products(*)')
        .eq('sale_id', sale.id);
      
      setSaleItems(data || []);
    } catch (error) {
      console.error('Error fetching sale items:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!sale) return null;

  const receiptOptions = {
    sale,
    items: saleItems,
    companyInfo: companyProfile,
    currencySymbol: getCurrencySymbol(),
    taxName: posSettings.tax_name || 'Tax',
    paperSize: receiptSettings?.paper_size as any || 'A4',
    receiptStyle: receiptSettings?.receipt_style as any || 'classic',
  };

  const getPaymentMethodColor = (method: string) => {
    switch (method.toLowerCase()) {
      case 'cash': return 'bg-green-100 text-green-800';
      case 'card': return 'bg-blue-100 text-blue-800';
      case 'digital': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Receipt className="h-5 w-5" />
            Sale Details - {sale.sale_number}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Sale Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-medium">{formatDate(sale.sale_date)}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Payment Method</p>
                <Badge className={getPaymentMethodColor(sale.payment_method)}>
                  {sale.payment_method}
                </Badge>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <User className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-medium">{sale.customer_name || "Walk-in Customer"}</p>
                {sale.customer_phone && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {sale.customer_phone}
                  </p>
                )}
              </div>
            </div>
          </div>

          {sale.notes && (
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="text-sm mt-1">{sale.notes}</p>
              </div>
            </div>
          )}

          <Separator />

          {/* Sale Items */}
          <div>
            <h3 className="font-semibold mb-3">Items Sold</h3>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8">
                        Loading items...
                      </TableCell>
                    </TableRow>
                  ) : saleItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8">
                        No items found
                      </TableCell>
                    </TableRow>
                  ) : (
                    saleItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.product?.name}</p>
                            {item.product?.barcode && (
                              <p className="text-sm text-muted-foreground">
                                {item.product.barcode}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unit_price)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(item.total_price)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <Separator />

          {/* Totals */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{formatCurrency(sale.total_amount)}</span>
            </div>
            
            {sale.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="font-medium text-destructive">
                  -{formatCurrency(sale.discount)}
                </span>
              </div>
            )}
            
            {sale.tax_amount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{posSettings.tax_name || 'Tax'}</span>
                <span className="font-medium">{formatCurrency(sale.tax_amount)}</span>
              </div>
            )}
            
            <Separator />
            
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{formatCurrency(sale.final_amount)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => printSaleReceipt(receiptOptions)}
            disabled={loading || saleItems.length === 0}
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <Button
            variant="outline"
            onClick={() => downloadSaleReceipt(receiptOptions)}
            disabled={loading || saleItems.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
