import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLoans } from "@/hooks/useLoans";
import { useCustomers } from "@/hooks/useCustomers";
import { useProducts } from "@/hooks/useProducts";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { CartItem } from "@/types/inventory";
import { X, Plus } from "lucide-react";

interface CreateLoanDialogProps {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  prefilledCart?: CartItem[];
  preselectedCustomerId?: string;
  onLoanCreated?: (loan: any) => void;
  prefilledAmount?: number;
}

export function CreateLoanDialog({ 
  children, 
  open: controlledOpen, 
  onOpenChange: controlledOnOpenChange,
  prefilledCart = [],
  preselectedCustomerId = "",
  onLoanCreated,
  prefilledAmount
}: CreateLoanDialogProps) {
  const { createLoan } = useLoans();
  const { customers, findOrCreateCustomer } = useCustomers();
  const { products } = useProducts();
  const { formatCurrency } = useSettingsContext();
  
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;
  
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [dueDate, setDueDate] = useState("");
  const [interestRate, setInterestRate] = useState(0);
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartItem[]>(prefilledCart);
  const [loading, setLoading] = useState(false);

  // Update cart when prefilled data changes
  useEffect(() => {
    if (open) {
      setCart(prefilledCart);
    }
  }, [open, prefilledCart]);

  const addToCart = () => {
    if (!selectedProduct) return;
    
    const product = products.find(p => p.id === selectedProduct);
    if (!product) return;

    const existingItem = cart.find(item => item.product.id === selectedProduct);
    if (existingItem) {
      setCart(cart.map(item =>
        item.product.id === selectedProduct
          ? { ...item, quantity: item.quantity + quantity }
          : item
      ));
    } else {
      setCart([...cart, {
        product,
        quantity,
        unit_price: product.selling_price
      }]);
    }

    setSelectedProduct("");
    setQuantity(1);
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }
    
    setCart(cart.map(item =>
      item.product.id === productId
        ? { ...item, quantity: newQuantity }
        : item
    ));
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);

  const handleSubmit = async () => {
    let finalCustomerId = selectedCustomer;
    
    // Create new customer if needed
    if (showNewCustomer && newCustomerName.trim()) {
      try {
        const customer = await findOrCreateCustomer(newCustomerName.trim(), newCustomerPhone.trim() || undefined);
        finalCustomerId = customer.id;
      } catch (error) {
        console.error('Error creating customer:', error);
        return;
      }
    }
    
    if (!finalCustomerId) {
      console.error('No customer selected');
      return;
    }
    
    // If prefilledAmount, no cart validation needed
    if (!prefilledAmount && cart.length === 0) {
      console.error('No cart items and no prefilled amount');
      return;
    }

    setLoading(true);
    try {
      const loan = await createLoan(
        finalCustomerId,
        cart,
        dueDate || undefined,
        interestRate || undefined,
        notes || undefined,
        prefilledAmount || undefined
      );
      
      console.log('Loan created successfully:', loan);
      
      // Reset form first
      setSelectedCustomer("");
      setNewCustomerName("");
      setNewCustomerPhone("");
      setShowNewCustomer(false);
      setCart([]);
      setDueDate("");
      setInterestRate(0);
      setNotes("");
      setOpen(false);
      
      // Call the callback after closing dialog
      if (onLoanCreated && loan) {
        console.log('Calling onLoanCreated with loan:', loan);
        onLoanCreated(loan);
      }
    } catch (error) {
      console.error('Error creating loan:', error);
      // Keep dialog open on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && (
        <DialogTrigger asChild>
          {children}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Loan</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Customer Selection */}
          <div className="space-y-2">
            <Label htmlFor="customer">Customer *</Label>
            {!showNewCustomer ? (
              <div className="space-y-2">
                <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select existing customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name} {customer.phone && `(${customer.phone})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewCustomer(true)}
                  className="w-full"
                >
                  + Create New Customer
                </Button>
              </div>
            ) : (
              <div className="space-y-2 p-3 border rounded-lg">
                <Input
                  placeholder="Customer Name *"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                />
                <Input
                  placeholder="Phone Number (Optional)"
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowNewCustomer(false);
                    setNewCustomerName("");
                    setNewCustomerPhone("");
                  }}
                  className="w-full"
                >
                  Cancel - Select Existing
                </Button>
              </div>
            )}
          </div>

          {/* Show Loan Amount if prefilled */}
          {prefilledAmount && (
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Loan Amount</p>
              <p className="text-2xl font-bold">{formatCurrency(prefilledAmount)}</p>
            </div>
          )}

          {/* Add Products - Only show if not using prefilled amount */}
          {!prefilledAmount && (
            <div className="space-y-4">
            <h3 className="text-lg font-medium">Add Products</h3>
            <div className="flex space-x-2">
              <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name} - {formatCurrency(product.selling_price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Qty"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-20"
                min="1"
              />
              <Button onClick={addToCart} disabled={!selectedProduct}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            </div>
          )}

          {/* Cart Items - Only show if not using prefilled amount */}
          {!prefilledAmount && cart.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-lg font-medium">Loan Items</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Unit Price</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cart.map((item) => (
                    <TableRow key={item.product.id}>
                      <TableCell>{item.product.name}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.product.id, parseInt(e.target.value) || 0)}
                          className="w-20"
                          min="1"
                        />
                      </TableCell>
                      <TableCell>{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell>{formatCurrency(item.unit_price * item.quantity)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFromCart(item.product.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="font-medium">Total</TableCell>
                    <TableCell className="font-bold">{formatCurrency(totalAmount)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Loan Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date (Optional)</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interestRate">Interest Rate % (Optional)</Label>
              <Input
                id="interestRate"
                type="number"
                value={interestRate}
                onChange={(e) => setInterestRate(parseFloat(e.target.value) || 0)}
                placeholder="0"
                min="0"
                step="0.1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about this loan..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={(!selectedCustomer && !newCustomerName.trim()) || (!prefilledAmount && cart.length === 0) || loading}
            >
              {loading ? "Creating..." : "Create Loan"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}