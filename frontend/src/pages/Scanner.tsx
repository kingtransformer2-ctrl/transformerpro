import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScanLine, Search, Package, Plus } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { Product } from "@/types/inventory";
import { useToast } from "@/hooks/use-toast";
import { useSettingsContext } from "@/contexts/SettingsContext";

export default function Scanner() {
  const { products } = useProducts();
  const { toast } = useToast();
  const { formatCurrency } = useSettingsContext();
  const [scannedCode, setScannedCode] = useState("");
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = () => {
    if (!scannedCode.trim()) {
      toast({
        title: "No barcode entered",
        description: "Please enter a barcode to scan",
        variant: "destructive",
      });
      return;
    }

    // Find product by barcode
    const product = products.find(p => p.barcode === scannedCode.trim());
    
    if (product) {
      setFoundProduct(product);
      toast({
        title: "Product found!",
        description: `Found: ${product.name}`,
      });
    } else {
      setFoundProduct(null);
      toast({
        title: "Product not found",
        description: "No product found with this barcode",
        variant: "destructive",
      });
    }
  };

  const handleAddToInventory = () => {
    // This would typically open a dialog to add a new product
    toast({
      title: "Feature coming soon",
      description: "Add new product functionality will be implemented",
    });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-foreground">Barcode Scanner</h1>
        </div>

        {/* Scanner Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <ScanLine className="h-5 w-5 mr-2" />
                Scan Barcode
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Enter Barcode</label>
                <div className="flex space-x-2">
                  <Input
                    placeholder="Scan or type barcode here..."
                    value={scannedCode}
                    onChange={(e) => setScannedCode(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleScan()}
                    className="flex-1"
                  />
                  <Button onClick={handleScan} disabled={!scannedCode.trim()}>
                    <Search className="h-4 w-4 mr-2" />
                    Search
                  </Button>
                </div>
              </div>

              <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg">
                <ScanLine className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <div className="text-lg font-medium text-muted-foreground mb-2">
                  Scanner Camera View
                </div>
                <div className="text-sm text-muted-foreground mb-4">
                  Position barcode within the frame to scan
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => setIsScanning(!isScanning)}
                  disabled
                >
                  {isScanning ? 'Stop Scanning' : 'Start Camera Scanner'}
                </Button>
                <div className="text-xs text-muted-foreground mt-2">
                  Camera scanning feature coming soon
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Product Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Package className="h-5 w-5 mr-2" />
                Product Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              {foundProduct ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <h3 className="text-xl font-semibold">{foundProduct.name}</h3>
                      <p className="text-muted-foreground">{foundProduct.description}</p>
                    </div>
                    <Badge 
                      variant={foundProduct.stock_quantity > foundProduct.min_stock_threshold ? "default" : "destructive"}
                    >
                      {foundProduct.stock_quantity > foundProduct.min_stock_threshold ? "In Stock" : "Low Stock"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Barcode</label>
                      <div className="text-lg font-mono">{foundProduct.barcode}</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Category</label>
                      <div className="text-lg">{foundProduct.category || 'Uncategorized'}</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Stock Quantity</label>
                      <div className="text-lg font-semibold">{foundProduct.stock_quantity}</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Selling Price</label>
                      <div className="text-lg font-semibold">{formatCurrency(foundProduct.selling_price)}</div>
                    </div>
                  </div>

                  <div className="flex space-x-2 pt-4">
                    <Button className="flex-1">
                      Add to Sale
                    </Button>
                    <Button variant="outline" className="flex-1">
                      Edit Product
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <div className="text-lg font-medium text-muted-foreground mb-2">
                    No product scanned
                  </div>
                  <div className="text-sm text-muted-foreground mb-4">
                    Scan a barcode to view product details
                  </div>
                  {scannedCode && !foundProduct && (
                    <Button variant="outline" onClick={handleAddToInventory}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add New Product
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Button variant="outline" className="flex flex-col items-center p-6 h-auto">
                <Search className="h-8 w-8 mb-2" />
                <span>Search Products</span>
                <span className="text-xs text-muted-foreground">Find products by name or code</span>
              </Button>
              <Button variant="outline" className="flex flex-col items-center p-6 h-auto">
                <Plus className="h-8 w-8 mb-2" />
                <span>Add Product</span>
                <span className="text-xs text-muted-foreground">Create new inventory item</span>
              </Button>
              <Button variant="outline" className="flex flex-col items-center p-6 h-auto">
                <ScanLine className="h-8 w-8 mb-2" />
                <span>Bulk Scan</span>
                <span className="text-xs text-muted-foreground">Scan multiple items</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent Scans */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Scans</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <ScanLine className="h-12 w-12 mx-auto mb-4" />
              <div>No recent scans</div>
              <div className="text-sm">Scanned items will appear here</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}