import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, Calendar, Download, FileText, Filter } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { useSales } from "@/hooks/useSales";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { Product, Sale } from "@/types/inventory";
import { format, subDays, isAfter, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { useToast } from "@/hooks/use-toast";

export default function Reports() {
  const { products } = useProducts();
  const { sales } = useSales();
  const { toast } = useToast();
  const { formatCurrency, formatDate, stockSettings } = useSettingsContext();
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [filteredSales, setFilteredSales] = useState<Sale[]>([]);
  const [dateRange, setDateRange] = useState("7days");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    // Filter low stock products using settings threshold
    const lowStock = products.filter(
      (product) => product.stock_quantity <= (product.min_stock_threshold || stockSettings.low_stock_threshold)
    );
    setLowStockProducts(lowStock);

    // Filter sales based on date range
    let filteredByDate = sales;
    const now = new Date();
    
    switch (dateRange) {
      case "today":
        filteredByDate = sales.filter((sale) => 
          format(new Date(sale.sale_date), 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd')
        );
        break;
      case "7days":
        const sevenDaysAgo = subDays(now, 7);
        filteredByDate = sales.filter((sale) => 
          isAfter(new Date(sale.sale_date), sevenDaysAgo)
        );
        break;
      case "30days":
        const thirtyDaysAgo = subDays(now, 30);
        filteredByDate = sales.filter((sale) => 
          isAfter(new Date(sale.sale_date), thirtyDaysAgo)
        );
        break;
      case "month":
        const monthStart = startOfMonth(now);
        const monthEnd = endOfMonth(now);
        filteredByDate = sales.filter((sale) => {
          const saleDate = new Date(sale.sale_date);
          return saleDate >= monthStart && saleDate <= monthEnd;
        });
        break;
      case "year":
        const yearStart = startOfYear(now);
        const yearEnd = endOfYear(now);
        filteredByDate = sales.filter((sale) => {
          const saleDate = new Date(sale.sale_date);
          return saleDate >= yearStart && saleDate <= yearEnd;
        });
        break;
      default:
        filteredByDate = sales;
    }

    // Apply search filter
    if (searchTerm) {
      filteredByDate = filteredByDate.filter((sale) =>
        sale.sale_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredSales(filteredByDate);
  }, [products, sales, dateRange, searchTerm, stockSettings.low_stock_threshold]);

  const generatePDF = (reportType: string) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    
    // Header
    doc.setFontSize(20);
    doc.setTextColor(40, 40, 40);
    doc.text('Business Reports', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text(`Generated on: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, pageWidth / 2, 30, { align: 'center' });
    
    let yPosition = 50;

    switch (reportType) {
      case 'inventory':
        doc.setFontSize(16);
        doc.text('Inventory Report', 20, yPosition);
        yPosition += 10;
        
        doc.setFontSize(12);
        doc.text(`Total Products: ${products.length}`, 20, yPosition);
        yPosition += 8;
        
        const totalValue = products.reduce((sum, product) => 
          sum + (product.stock_quantity * product.purchase_price), 0
        );
        doc.text(`Total Inventory Value: ${formatCurrency(totalValue)}`, 20, yPosition);
        yPosition += 15;

        const inventoryData = products.map(product => [
          product.name,
          product.category || 'Uncategorized',
          product.stock_quantity.toString(),
          formatCurrency(product.stock_quantity * product.purchase_price),
          product.stock_quantity <= product.min_stock_threshold ? 'Low Stock' : 'Good Stock'
        ]);

        (doc as any).autoTable({
          head: [['Product', 'Category', 'Stock', 'Value', 'Status']],
          body: inventoryData,
          startY: yPosition,
          theme: 'striped',
          headStyles: { fillColor: [59, 130, 246] },
          styles: { fontSize: 10 }
        });
        break;

      case 'sales':
        doc.setFontSize(16);
        doc.text('Sales Report', 20, yPosition);
        yPosition += 10;
        
        const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.final_amount, 0);
        const avgSale = filteredSales.length > 0 ? totalRevenue / filteredSales.length : 0;
        
        doc.setFontSize(12);
        doc.text(`Period: ${getDateRangeLabel()}`, 20, yPosition);
        yPosition += 8;
        doc.text(`Total Sales: ${filteredSales.length}`, 20, yPosition);
        yPosition += 8;
        doc.text(`Total Revenue: ${formatCurrency(totalRevenue)}`, 20, yPosition);
        yPosition += 8;
        doc.text(`Average Sale: ${formatCurrency(avgSale)}`, 20, yPosition);
        yPosition += 15;

        const salesData = filteredSales.slice(0, 50).map(sale => [
          sale.sale_number || '',
          format(new Date(sale.sale_date), 'MMM dd, yyyy'),
          sale.customer_name || 'Walk-in',
          formatCurrency(sale.final_amount),
          sale.payment_method || 'Cash'
        ]);

        (doc as any).autoTable({
          head: [['Sale #', 'Date', 'Customer', 'Amount', 'Payment']],
          body: salesData,
          startY: yPosition,
          theme: 'striped',
          headStyles: { fillColor: [34, 197, 94] },
          styles: { fontSize: 10 }
        });
        break;

      case 'alerts':
        doc.setFontSize(16);
        doc.text('Stock Alert Report', 20, yPosition);
        yPosition += 10;
        
        doc.setFontSize(12);
        doc.text(`Low Stock Items: ${lowStockProducts.length}`, 20, yPosition);
        yPosition += 15;

        if (lowStockProducts.length > 0) {
          const alertsData = lowStockProducts.map(product => [
            product.name,
            product.stock_quantity.toString(),
            product.min_stock_threshold.toString(),
            'Low Stock',
            'Reorder Required'
          ]);

          (doc as any).autoTable({
            head: [['Product', 'Current Stock', 'Min Threshold', 'Status', 'Action']],
            body: alertsData,
            startY: yPosition,
            theme: 'striped',
            headStyles: { fillColor: [239, 68, 68] },
            styles: { fontSize: 10 }
          });
        } else {
          doc.text('No low stock items found.', 20, yPosition);
        }
        break;

      case 'summary':
        doc.setFontSize(16);
        doc.text('Business Summary Report', 20, yPosition);
        yPosition += 20;
        
        // Key metrics
        const summaryData = [
          ['Total Products', products.length.toString()],
          ['Total Sales', sales.length.toString()],
          ['Total Revenue', formatCurrency(sales.reduce((sum, sale) => sum + sale.final_amount, 0))],
          ['Low Stock Items', lowStockProducts.length.toString()],
          ['Period Revenue', formatCurrency(filteredSales.reduce((sum, sale) => sum + sale.final_amount, 0))],
          ['Period Sales', filteredSales.length.toString()]
        ];

        (doc as any).autoTable({
          head: [['Metric', 'Value']],
          body: summaryData,
          startY: yPosition,
          theme: 'striped',
          headStyles: { fillColor: [147, 51, 234] },
          styles: { fontSize: 12 }
        });
        break;
    }

    // Save the PDF
    doc.save(`${reportType}-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    
    toast({
      title: "Report Generated",
      description: `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} report has been downloaded successfully.`,
    });
  };

  const getDateRangeLabel = () => {
    switch (dateRange) {
      case "today": return "Today";
      case "7days": return "Last 7 Days";
      case "30days": return "Last 30 Days";
      case "month": return "This Month";
      case "year": return "This Year";
      default: return "All Time";
    }
  };

  const totalRevenue = sales.reduce((sum, sale) => sum + sale.final_amount, 0);
  const totalProductValue = products.reduce((sum, product) => 
    sum + (product.stock_quantity * product.purchase_price), 0
  );
  const periodRevenue = filteredSales.reduce((sum, sale) => sum + sale.final_amount, 0);

  // Get unique categories for filter
  const categories = ["all", ...Array.from(new Set(products.map(p => p.category).filter(Boolean)))];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Reports & Analytics</h1>
            <p className="text-muted-foreground mt-1">Comprehensive business insights and data analysis</p>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Button 
              variant="outline" 
              onClick={() => generatePDF('summary')}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600"
            >
              <Download className="h-4 w-4 mr-2" />
              Summary PDF
            </Button>
            <Button 
              variant="outline" 
              onClick={() => generatePDF('inventory')}
              className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:from-blue-600 hover:to-cyan-600"
            >
              <FileText className="h-4 w-4 mr-2" />
              Inventory PDF
            </Button>
            <Button 
              variant="outline" 
              onClick={() => generatePDF('sales')}
              className="bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Sales PDF
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-gradient-to-r from-slate-50 to-gray-50 dark:from-slate-900 dark:to-gray-900 border-0 shadow-lg">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="w-[180px] bg-background">
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="7days">Last 7 Days</SelectItem>
                    <SelectItem value="30days">Last 30 Days</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="year">This Year</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <Input
                placeholder="Search sales by number or customer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="md:max-w-xs bg-background"
              />
            </div>
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Total Products</CardTitle>
              <BarChart3 className="h-5 w-5 opacity-75" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{products.length}</div>
              <p className="text-xs opacity-75 mt-1">
                Active inventory items
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium opacity-90">{getDateRangeLabel()} Sales</CardTitle>
              <TrendingUp className="h-5 w-5 opacity-75" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{filteredSales.length}</div>
              <p className="text-xs opacity-75 mt-1">
                Transactions in period
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium opacity-90">{getDateRangeLabel()} Revenue</CardTitle>
              <TrendingUp className="h-5 w-5 opacity-75" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCurrency(periodRevenue)}</div>
              <p className="text-xs opacity-75 mt-1">
                Period earnings
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Stock Alerts</CardTitle>
              <AlertTriangle className="h-5 w-5 opacity-75" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{lowStockProducts.length}</div>
              <p className="text-xs opacity-75 mt-1">
                Items need restocking
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Reports */}
        <Tabs defaultValue="inventory" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 bg-muted/50">
            <TabsTrigger value="inventory" className="data-[state=active]:bg-background">
              Inventory Report
            </TabsTrigger>
            <TabsTrigger value="sales" className="data-[state=active]:bg-background">
              Sales Report
            </TabsTrigger>
            <TabsTrigger value="alerts" className="data-[state=active]:bg-background">
              Stock Alerts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inventory">
            <Card className="shadow-lg border-0">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-xl">Inventory Overview</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      Complete product inventory analysis
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={() => generatePDF('inventory')}
                    className="bg-background"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
                    <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">
                      Total Inventory Value
                    </div>
                    <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      {formatCurrency(totalProductValue)}
                    </div>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                    <div className="text-lg font-semibold text-green-700 dark:text-green-300">
                      Well Stocked Items
                    </div>
                    <div className="text-2xl font-bold text-green-900 dark:text-green-100">
                      {products.length - lowStockProducts.length}
                    </div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950 p-4 rounded-lg">
                    <div className="text-lg font-semibold text-red-700 dark:text-red-300">
                      Low Stock Items
                    </div>
                    <div className="text-2xl font-bold text-red-900 dark:text-red-100">
                      {lowStockProducts.length}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-semibold">Product</TableHead>
                        <TableHead className="font-semibold">Category</TableHead>
                        <TableHead className="font-semibold">Stock Quantity</TableHead>
                        <TableHead className="font-semibold">Value</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.map((product) => (
                        <TableRow key={product.id} className="hover:bg-muted/30">
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell>{product.category || 'Uncategorized'}</TableCell>
                          <TableCell className="font-mono">{product.stock_quantity}</TableCell>
                          <TableCell className="font-mono">
                            {formatCurrency(product.stock_quantity * product.purchase_price)}
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant={
                                product.stock_quantity <= product.min_stock_threshold
                                  ? "destructive"
                                  : product.stock_quantity <= product.min_stock_threshold * 2
                                  ? "secondary"
                                  : "default"
                              }
                              className="font-medium"
                            >
                              {product.stock_quantity <= product.min_stock_threshold
                                ? "Low Stock"
                                : product.stock_quantity <= product.min_stock_threshold * 2
                                ? "Medium Stock"
                                : "Good Stock"
                              }
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sales">
            <Card className="shadow-lg border-0">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-xl">Sales Performance</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {getDateRangeLabel()} sales analysis and insights
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={() => generatePDF('sales')}
                    className="bg-background"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                    <div className="text-sm font-semibold text-green-700 dark:text-green-300">
                      Period Revenue
                    </div>
                    <div className="text-2xl font-bold text-green-900 dark:text-green-100">
                      {formatCurrency(periodRevenue)}
                    </div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
                    <div className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                      Total Transactions
                    </div>
                    <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      {filteredSales.length}
                    </div>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg">
                    <div className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                      Average Sale
                    </div>
                    <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                      {filteredSales.length > 0 ? formatCurrency(periodRevenue / filteredSales.length) : formatCurrency(0)}
                    </div>
                  </div>
                  <div className="bg-orange-50 dark:bg-orange-950 p-4 rounded-lg">
                    <div className="text-sm font-semibold text-orange-700 dark:text-orange-300">
                      All Time Revenue
                    </div>
                    <div className="text-2xl font-bold text-orange-900 dark:text-orange-100">
                      {formatCurrency(totalRevenue)}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-semibold">Sale Number</TableHead>
                        <TableHead className="font-semibold">Date</TableHead>
                        <TableHead className="font-semibold">Customer</TableHead>
                        <TableHead className="font-semibold">Amount</TableHead>
                        <TableHead className="font-semibold">Payment Method</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSales.slice(0, 20).map((sale) => (
                        <TableRow key={sale.id} className="hover:bg-muted/30">
                          <TableCell className="font-medium font-mono">{sale.sale_number}</TableCell>
                          <TableCell>
                            {format(new Date(sale.sale_date), 'MMM dd, yyyy HH:mm')}
                          </TableCell>
                          <TableCell>{sale.customer_name || 'Walk-in Customer'}</TableCell>
                          <TableCell className="font-mono font-semibold">
                            {formatCurrency(sale.final_amount)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {sale.payment_method}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                
                {filteredSales.length > 20 && (
                  <div className="text-center mt-4 text-sm text-muted-foreground">
                    Showing 20 of {filteredSales.length} sales. Export PDF for complete data.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="alerts">
            <Card className="shadow-lg border-0">
              <CardHeader className="bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950 dark:to-orange-950">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-xl">Stock Alerts</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      Products requiring immediate attention
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={() => generatePDF('alerts')}
                    className="bg-background"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {lowStockProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="bg-green-100 dark:bg-green-900 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-4">
                      <TrendingUp className="h-12 w-12 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="text-xl font-medium mb-2">All products are well stocked!</div>
                    <div className="text-muted-foreground">No low stock alerts at this time.</div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-red-50 dark:bg-red-950 p-4 rounded-lg border border-red-200 dark:border-red-800">
                      <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                        <AlertTriangle className="h-5 w-5" />
                        <span className="font-semibold">
                          {lowStockProducts.length} product{lowStockProducts.length !== 1 ? 's' : ''} require{lowStockProducts.length === 1 ? 's' : ''} immediate restocking
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="font-semibold">Product</TableHead>
                            <TableHead className="font-semibold">Current Stock</TableHead>
                            <TableHead className="font-semibold">Min Threshold</TableHead>
                            <TableHead className="font-semibold">Status</TableHead>
                            <TableHead className="font-semibold">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lowStockProducts.map((product) => (
                            <TableRow key={product.id} className="hover:bg-muted/30">
                              <TableCell className="font-medium">{product.name}</TableCell>
                              <TableCell className="font-mono text-red-600 dark:text-red-400 font-semibold">
                                {product.stock_quantity}
                              </TableCell>
                              <TableCell className="font-mono">{product.min_stock_threshold}</TableCell>
                              <TableCell>
                                <Badge variant="destructive" className="font-medium">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Critical
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Button variant="outline" size="sm" className="hover:bg-primary hover:text-primary-foreground">
                                  Reorder Now
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}