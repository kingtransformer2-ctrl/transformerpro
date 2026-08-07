import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { useProducts } from "@/hooks/useProducts";
import { useStockMovements } from "@/hooks/useStockMovements";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, AlertTriangle, Package, TrendingUp, TrendingDown, RotateCcw } from "lucide-react";
import { format } from "date-fns";

export function StockManagement() {
  const { products, refreshProducts } = useProducts();
  const { stockMovements, addStockMovement, loading } = useStockMovements();
  const { formatDate, stockSettings } = useSettingsContext();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [movementType, setMovementType] = useState<'in' | 'out' | 'adjustment'>('in');
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const lowStockProducts = products.filter(product => 
    product.stock_quantity <= (product.min_stock_threshold || stockSettings.low_stock_threshold)
  );

  const handleSubmitMovement = async () => {
    if (!selectedProduct || !quantity || !reason) return;

    try {
      await addStockMovement({
        product_id: selectedProduct,
        movement_type: movementType,
        quantity: parseInt(quantity),
        reason,
        notes: notes || undefined,
      });

      // Reset form
      setSelectedProduct("");
      setQuantity("");
      setReason("");
      setNotes("");
      setIsDialogOpen(false);
      
      // Refresh products to get updated stock quantities
      refreshProducts();
    } catch (error) {
      // Error handled in hook
    }
  };

  const getMovementIcon = (type: string) => {
    switch (type) {
      case 'in':
        return <TrendingUp className="h-4 w-4 text-success" />;
      case 'out':
        return <TrendingDown className="h-4 w-4 text-destructive" />;
      case 'adjustment':
        return <RotateCcw className="h-4 w-4 text-warning" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

  const getMovementBadge = (type: string) => {
    switch (type) {
      case 'in':
        return <Badge className="bg-success/10 text-success border-success">Stock In</Badge>;
      case 'out':
        return <Badge variant="destructive">Stock Out</Badge>;
      case 'adjustment':
        return <Badge className="bg-warning/10 text-warning border-warning">Adjustment</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">Stock Management</h1>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Record Movement
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record Stock Movement</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="product-select">Product</Label>
                  <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} (Current: {product.stock_quantity})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="movement-type">Movement Type</Label>
                  <Select value={movementType} onValueChange={(value: 'in' | 'out' | 'adjustment') => setMovementType(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in">Stock In (Add)</SelectItem>
                      <SelectItem value="out">Stock Out (Remove)</SelectItem>
                      <SelectItem value="adjustment">Adjustment (Set to)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="quantity">
                    {movementType === 'adjustment' ? 'New Total Quantity' : 'Quantity'}
                  </Label>
                  <Input
                    id="quantity"
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="Enter quantity"
                    min="0"
                  />
                </div>
                
                <div>
                  <Label htmlFor="reason">Reason</Label>
                  <Input
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g., Purchase, Damage, Inventory Count"
                  />
                </div>
                
                <div>
                  <Label htmlFor="notes">Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Additional notes..."
                  />
                </div>
                
                <Button 
                  onClick={handleSubmitMovement} 
                  className="w-full"
                  disabled={!selectedProduct || !quantity || !reason}
                >
                  Record Movement
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="movements">Stock Movements</TabsTrigger>
            <TabsTrigger value="alerts">Low Stock Alerts</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Products</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{products.length}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Stock Value</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(products.reduce((sum, product) => sum + (product.stock_quantity * product.purchase_price), 0))}
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-warning" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-warning">{lowStockProducts.length}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Units</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {products.reduce((sum, product) => sum + product.stock_quantity, 0)}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Current Stock Levels</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Current Stock</TableHead>
                      <TableHead>Min Threshold</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell>{product.category || '-'}</TableCell>
                        <TableCell>{product.stock_quantity}</TableCell>
                        <TableCell>{product.min_stock_threshold || '-'}</TableCell>
                        <TableCell>
                          {product.stock_quantity <= (product.min_stock_threshold || 0) ? (
                            <Badge variant="destructive">Low Stock</Badge>
                          ) : product.stock_quantity === 0 ? (
                            <Badge variant="destructive">Out of Stock</Badge>
                          ) : (
                            <Badge className="bg-success/10 text-success border-success">In Stock</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(product.stock_quantity * product.purchase_price)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="movements" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Stock Movements</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8">Loading movements...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockMovements.map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell>
                            {format(new Date(movement.created_at), 'MMM dd, yyyy HH:mm')}
                          </TableCell>
                          <TableCell className="font-medium">
                            {movement.product?.name || 'Unknown Product'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              {getMovementIcon(movement.movement_type)}
                              {getMovementBadge(movement.movement_type)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className={
                              movement.movement_type === 'in' ? 'text-success' :
                              movement.movement_type === 'out' ? 'text-destructive' :
                              'text-warning'
                            }>
                              {movement.movement_type === 'in' ? '+' : 
                               movement.movement_type === 'out' ? '-' : ''}
                              {movement.quantity}
                            </span>
                          </TableCell>
                          <TableCell>{movement.reason}</TableCell>
                          <TableCell>{movement.notes || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="alerts" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                  <span>Low Stock Alerts</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lowStockProducts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No low stock alerts at the moment
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Current Stock</TableHead>
                        <TableHead>Min Threshold</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Action Needed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lowStockProducts.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell>
                            <span className="text-destructive font-medium">
                              {product.stock_quantity}
                            </span>
                          </TableCell>
                          <TableCell>{product.min_stock_threshold}</TableCell>
                          <TableCell>
                            {product.stock_quantity === 0 ? (
                              <Badge variant="destructive">Out of Stock</Badge>
                            ) : (
                              <Badge variant="destructive">Low Stock</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              Reorder recommended
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

export default StockManagement;