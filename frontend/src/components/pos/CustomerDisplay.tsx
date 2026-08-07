import { CartItem } from "@/types/inventory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Receipt } from "lucide-react";
import { useSettingsContext } from "@/contexts/SettingsContext";

interface CustomerDisplayProps {
  cart: CartItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  customerName?: string;
}

export function CustomerDisplay({
  cart,
  subtotal,
  discountAmount,
  total,
  customerName
}: CustomerDisplayProps) {
  const { formatCurrency } = useSettingsContext();

  return (
    <div className="w-full h-full bg-gradient-to-br from-primary/10 to-secondary/10 p-6">
      <Card className="h-full border-2 border-primary/20 shadow-xl">
        <CardHeader className="text-center bg-gradient-to-r from-primary to-primary/80 text-primary-foreground rounded-t-lg">
          <CardTitle className="text-3xl font-bold flex items-center justify-center gap-3">
            <Receipt className="h-8 w-8" />
            Customer Display
          </CardTitle>
          {customerName && (
            <p className="text-xl opacity-90">Welcome, {customerName}!</p>
          )}
        </CardHeader>
        
        <CardContent className="p-8 space-y-6 h-full flex flex-col">
          {/* Current Items */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-4">
              <ShoppingCart className="h-6 w-6 text-primary" />
              <h3 className="text-2xl font-semibold text-foreground">
                Items in Cart ({cart.length})
              </h3>
            </div>
            
            {cart.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <p className="text-2xl text-muted-foreground">No items yet</p>
                <p className="text-lg text-muted-foreground/70">Items will appear here as they're scanned</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {cart.map((item) => (
                  <div
                    key={item.product.id}
                    className="flex justify-between items-center p-4 bg-card/50 rounded-lg border border-border/50"
                  >
                    <div>
                      <p className="text-xl font-medium text-foreground">
                        {item.product.name}
                      </p>
                      <p className="text-lg text-muted-foreground">
                        Qty: {item.quantity} × {formatCurrency(item.unit_price)}
                      </p>
                    </div>
                    <p className="text-2xl font-bold text-primary">
                      {formatCurrency(item.quantity * item.unit_price)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Total Section */}
          <div className="border-t-2 border-primary/20 pt-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center text-xl">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(subtotal)}
                </span>
              </div>
              
              {discountAmount > 0 && (
                <div className="flex justify-between items-center text-xl">
                  <span className="text-muted-foreground">Discount:</span>
                  <span className="font-semibold text-destructive">
                    -{formatCurrency(discountAmount)}
                  </span>
                </div>
              )}
              
              <div className="flex justify-between items-center p-4 bg-primary/10 rounded-lg border-2 border-primary/30">
                <span className="text-3xl font-bold text-foreground">Total:</span>
                <Badge variant="default" className="text-3xl font-bold px-6 py-2 bg-primary text-primary-foreground">
                  {formatCurrency(total)}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}