import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { apiClient } from "@/integrations/supabase/client";
import { Customer } from "@/hooks/useCustomers";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { User, Mail, Phone, MapPin, ShoppingBag, DollarSign, TrendingUp, Fingerprint } from "lucide-react";

interface CustomerDetailsDialogProps {
  customer: Customer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomerDetailsDialog({ customer, open, onOpenChange }: CustomerDetailsDialogProps) {
  const { formatCurrency, formatDate } = useSettingsContext();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [hotelInvoices, setHotelInvoices] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalPurchases: 0,
    totalHotelBills: 0,
    totalSpent: 0,
    averageOrderValue: 0,
    lastActivity: null as string | null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (customer && open) {
      fetchCustomerDetails();
    }
  }, [customer, open]);

  const fetchCustomerDetails = async () => {
    if (!customer) return;
    
    setLoading(true);
    try {
      // Fetch purchases
      const { data: salesData } = await apiClient
        .from('sales')
        .select('*')
        .eq('customer_id', customer.id)
        .order('sale_date', { ascending: false });
      
      // Fetch loans
      const { data: loansData } = await apiClient
        .from('customer_loans')
        .select('*')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false });

      const { data: hotelInvoiceData } = await apiClient
        .from('hotel_invoices')
        .select('*')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false });
      
      setPurchases(salesData || []);
      setLoans(loansData || []);
      setHotelInvoices(hotelInvoiceData || []);
      
      // Calculate stats
      const retailSpent = (salesData || []).reduce((sum, sale) => sum + Number(sale.final_amount), 0);
      const hotelSpent = (hotelInvoiceData || []).reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);
      const totalPurchases = (salesData || []).length;
      const totalHotelBills = (hotelInvoiceData || []).length;
      const recentDates = [
        salesData && salesData.length > 0 ? salesData[0].sale_date : null,
        hotelInvoiceData && hotelInvoiceData.length > 0 ? hotelInvoiceData[0].created_at : null,
      ].filter(Boolean) as string[];
      const lastActivity = recentDates.length > 0
        ? recentDates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
        : null;
      const totalTrackedTransactions = totalPurchases + totalHotelBills;
      const totalSpent = retailSpent + hotelSpent;
      
      setStats({
        totalPurchases,
        totalHotelBills,
        totalSpent,
        averageOrderValue: totalTrackedTransactions > 0 ? totalSpent / totalTrackedTransactions : 0,
        lastActivity,
      });
    } catch (error) {
      console.error('Error fetching customer details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!customer) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <User className="h-5 w-5" />
            {customer.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Customer Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {customer.email && (
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium text-sm break-all">{customer.email}</p>
                </div>
              </div>
            )}
            
            {customer.phone && (
              <div className="flex items-start gap-3">
                <Phone className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p className="font-medium">{customer.phone}</p>
                </div>
              </div>
            )}

            {customer.tin_number && (
              <div className="flex items-start gap-3">
                <Fingerprint className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">TIN Number</p>
                  <p className="font-medium">{customer.tin_number}</p>
                </div>
              </div>
            )}
            
            {customer.address && (
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Address</p>
                  <p className="font-medium text-sm">{customer.address}</p>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Retail Purchases</p>
              </div>
              <p className="text-2xl font-bold">{stats.totalPurchases}</p>
            </div>
            
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Combined Spend</p>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(stats.totalSpent)}</p>
            </div>
            
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Hotel Bills</p>
              </div>
              <p className="text-2xl font-bold">{stats.totalHotelBills}</p>
            </div>
            
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Last Activity</p>
              </div>
              <p className="text-sm font-bold">
                {stats.lastActivity ? formatDate(stats.lastActivity) : "Never"}
              </p>
            </div>
          </div>

          <Separator />

          {/* Tabs */}
          <Tabs defaultValue="purchases" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="purchases">Purchase History ({purchases.length})</TabsTrigger>
              <TabsTrigger value="hotel-bills">Hotel Bills ({hotelInvoices.length})</TabsTrigger>
              <TabsTrigger value="loans">Loans ({loans.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="purchases" className="space-y-2 max-h-96 overflow-y-auto">
              {purchases.map((sale) => (
                <div key={sale.id} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{sale.sale_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(sale.sale_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(sale.final_amount)}</p>
                      <Badge className={
                        sale.payment_method === 'cash' ? 'bg-green-100 text-green-800' :
                        sale.payment_method === 'card' ? 'bg-blue-100 text-blue-800' :
                        'bg-purple-100 text-purple-800'
                      }>
                        {sale.payment_method}
                      </Badge>
                    </div>
                  </div>
                  {sale.notes && (
                    <p className="text-sm text-muted-foreground mt-2">{sale.notes}</p>
                  )}
                </div>
              ))}
              {purchases.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No purchases found</p>
              )}
            </TabsContent>

            <TabsContent value="hotel-bills" className="space-y-2 max-h-96 overflow-y-auto">
              {hotelInvoices.map((invoice) => (
                <div key={invoice.id} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{invoice.invoice_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(invoice.created_at)}
                      </p>
                      {(invoice.customer_phone || invoice.customer_email) && (
                        <p className="text-sm text-muted-foreground">
                          {[invoice.customer_phone, invoice.customer_email].filter(Boolean).join(' • ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(Number(invoice.total_amount || 0))}</p>
                      <Badge variant={invoice.payment_status === 'paid' ? 'default' : 'secondary'}>
                        {invoice.payment_status || 'pending'}
                      </Badge>
                    </div>
                  </div>
                  {invoice.notes && (
                    <p className="text-sm text-muted-foreground mt-2">{invoice.notes}</p>
                  )}
                </div>
              ))}
              {hotelInvoices.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No hotel bills found</p>
              )}
            </TabsContent>

            <TabsContent value="loans" className="space-y-2 max-h-96 overflow-y-auto">
              {loans.map((loan) => (
                <div key={loan.id} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium">{loan.loan_number}</p>
                      <p className="text-sm text-muted-foreground">
                        Created: {formatDate(loan.created_at)}
                      </p>
                      {loan.due_date && (
                        <p className="text-sm text-muted-foreground">
                          Due: {formatDate(loan.due_date)}
                        </p>
                      )}
                    </div>
                    <Badge variant={loan.status === 'completed' ? 'default' : loan.status === 'active' ? 'secondary' : 'destructive'}>
                      {loan.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total</p>
                      <p className="font-medium">{formatCurrency(loan.total_amount)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Paid</p>
                      <p className="font-medium text-green-600">{formatCurrency(loan.paid_amount)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Remaining</p>
                      <p className="font-medium text-red-600">{formatCurrency(loan.remaining_amount)}</p>
                    </div>
                  </div>
                  {loan.notes && (
                    <p className="text-sm text-muted-foreground mt-2">{loan.notes}</p>
                  )}
                </div>
              ))}
              {loans.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No loans found</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
