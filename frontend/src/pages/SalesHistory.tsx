import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Eye, Calendar, DollarSign, Trash2, Download, CheckSquare } from "lucide-react";
import { useSales } from "@/hooks/useSales";
import { Sale } from "@/types/inventory";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { apiClient } from "@/integrations/supabase/client";
import { SaleDetailsDialog } from "@/components/sales/SaleDetailsDialog";
import { exportToExcel, exportToCSV } from "@/lib/export";
import { Checkbox } from "@/components/ui/checkbox";
import { useSettingsContext } from "@/contexts/SettingsContext";

export default function SalesHistory() {
  const { sales, loading, refreshSales } = useSales();
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredSales, setFilteredSales] = useState<Sale[]>([]);
  const [deleteSale, setDeleteSale] = useState<Sale | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedSales, setSelectedSales] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { formatCurrency } = useSettingsContext();

  useEffect(() => {
    const filtered = sales.filter((sale) =>
      sale.sale_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (sale.customer_name && sale.customer_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      sale.payment_method.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredSales(filtered);
  }, [sales, searchTerm]);

  const getPaymentMethodColor = (method: string) => {
    switch (method.toLowerCase()) {
      case 'cash':
        return 'bg-green-100 text-green-800';
      case 'card':
        return 'bg-blue-100 text-blue-800';
      case 'digital':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleDelete = async () => {
    if (!deleteSale) return;
    try {
      await apiClient.from("sale_items").delete().eq("sale_id", deleteSale.id);
      await apiClient.from("sales").delete().eq("id", deleteSale.id);
      
      toast({
        title: "Success",
        description: "Sale deleted successfully",
      });
      setDeleteSale(null);
      refreshSales();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete sale",
        variant: "destructive",
      });
    }
  };

  const handleExportExcel = () => {
    const exportData = filteredSales.map(s => ({
      'Sale Number': s.sale_number,
      'Date': format(new Date(s.sale_date), 'yyyy-MM-dd'),
      'Customer': s.customer_name || 'Walk-in',
      'Payment Method': s.payment_method,
      'Total Amount': s.total_amount,
      'Discount': s.discount,
      'Tax': s.tax_amount || 0,
      'Final Amount': s.final_amount,
    }));
    exportToExcel(exportData, `sales-${new Date().toISOString().split('T')[0]}`, 'Sales');
    toast({ title: "Success", description: "Sales exported to Excel" });
  };

  const handleExportCSV = () => {
    const exportData = filteredSales.map(s => ({
      'Sale Number': s.sale_number,
      'Date': format(new Date(s.sale_date), 'yyyy-MM-dd'),
      'Customer': s.customer_name || 'Walk-in',
      'Payment Method': s.payment_method,
      'Total Amount': s.total_amount,
      'Discount': s.discount,
      'Tax': s.tax_amount || 0,
      'Final Amount': s.final_amount,
    }));
    exportToCSV(exportData, `sales-${new Date().toISOString().split('T')[0]}`);
    toast({ title: "Success", description: "Sales exported to CSV" });
  };

  const toggleSelectAll = () => {
    if (selectedSales.size === filteredSales.length) {
      setSelectedSales(new Set());
    } else {
      setSelectedSales(new Set(filteredSales.map(s => s.id)));
    }
  };

  const toggleSale = (id: string) => {
    const newSelected = new Set(selectedSales);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedSales(newSelected);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-foreground">Sales History</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sales.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(sales.reduce((sum, sale) => sum + sale.final_amount, 0))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Average Sale</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {sales.length > 0 
                  ? formatCurrency(sales.reduce((sum, sale) => sum + sale.final_amount, 0) / sales.length)
                  : formatCurrency(0)
                }
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sales Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by sale number, customer, or payment method..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleExportExcel} variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Excel
                </Button>
                <Button onClick={handleExportCSV} variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  CSV
                </Button>
              </div>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedSales.size === filteredSales.length && filteredSales.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Sale #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        Loading sales...
                      </TableCell>
                    </TableRow>
                  ) : filteredSales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        No sales found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSales.map((sale) => (
                      <TableRow key={sale.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedSales.has(sale.id)}
                            onCheckedChange={() => toggleSale(sale.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{sale.sale_number}</TableCell>
                        <TableCell>{format(new Date(sale.sale_date), 'MMM dd, yyyy')}</TableCell>
                        <TableCell>{sale.customer_name || 'Walk-in'}</TableCell>
                        <TableCell className="font-medium">{formatCurrency(sale.final_amount)}</TableCell>
                        <TableCell>
                          <Badge className={getPaymentMethodColor(sale.payment_method)}>
                            {sale.payment_method}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setSelectedSale(sale); setDetailsOpen(true); }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setDeleteSale(sale)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <AlertDialog
          open={!!deleteSale}
          onOpenChange={() => setDeleteSale(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Sale</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete sale {deleteSale?.sale_number}?
                This will also delete all associated sale items. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <SaleDetailsDialog
          sale={selectedSale}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      </div>
    </Layout>
  );
}
