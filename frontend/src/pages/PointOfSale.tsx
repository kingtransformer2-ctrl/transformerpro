import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Layout } from "@/components/layout/Layout";
import { useProducts } from "@/hooks/useProducts";
import { useSales } from "@/hooks/useSales";
import { useCustomers } from "@/hooks/useCustomers";
import { useProductBatches } from "@/hooks/useProductBatches";
import { useBatchStock } from "@/hooks/useBatchStock";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { useLoans } from "@/hooks/useLoans";
import { CartItem } from "@/types/inventory";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Search, Plus, Minus, Trash2, Monitor, Package, Printer, CreditCard, X, Calculator, Percent, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ReceiptPrint } from "@/components/pos/ReceiptPrint";
import { CustomerDisplay } from "@/components/pos/CustomerDisplay";
import { CreateLoanDialog } from "@/components/loans/CreateLoanDialog";
import { BarcodeScanner } from "@/components/pos/BarcodeScanner";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

export default function PointOfSale() {
  const { formatCurrency, posSettings, getCurrencySymbol } = useSettingsContext();
  const { products } = useProducts();
  const { createSale } = useSales();
  const { findOrCreateCustomer } = useCustomers();
  const { getBatchesForSale } = useProductBatches();
  const { getProductStock } = useBatchStock(products);
  const { createLoan } = useLoans();
  const { toast } = useToast();
  
  // Helper function for printing (to avoid double currency symbols)
  const printCurrency = (amount: number) => {
    return `${getCurrencySymbol()}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState(0);
  
  const handleDiscountChange = (value: number) => {
    if (!posSettings.enable_discounts) {
      toast({
        title: "Disabled",
        description: "Discounts are disabled in settings",
        variant: "destructive",
      });
      return;
    }
    if (value > (posSettings.max_discount_percent || 100)) {
      toast({
        title: "Error",
        description: `Maximum discount is ${posSettings.max_discount_percent}%`,
        variant: "destructive",
      });
      return;
    }
    setDiscount(value);
  };
  const [paymentMethod, setPaymentMethod] = useState(posSettings.default_payment_method);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [tempPrice, setTempPrice] = useState(0);
  const [lastSale, setLastSale] = useState<any>(null);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [showCustomerDisplay, setShowCustomerDisplay] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [paidAmount, setPaidAmount] = useState("");
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [tinNumber, setTinNumber] = useState("");
  const [receiptPhone, setReceiptPhone] = useState("");
  const [splitPayments, setSplitPayments] = useState<Array<{ method: string; amount: number }>>([]);
  const [showLoanDialog, setShowLoanDialog] = useState(false);
  const [pendingSaleData, setPendingSaleData] = useState<any>(null);
  
  // Barcode scanner support for physical scanners
  const barcodeBuffer = useRef("");
  const barcodeTimeout = useRef<NodeJS.Timeout>();

  const filteredProducts = useMemo(() => {
    return products.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.barcode?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  // Handle barcode scan from physical scanner or camera
  const handleBarcodeScan = useCallback((barcode: string) => {
    const product = products.find(p => p.barcode === barcode);
    if (product) {
      addToCart(product.id);
      toast({
        title: "Product Added",
        description: `${product.name} added to cart`,
      });
    } else {
      toast({
        title: "Not Found",
        description: `No product with barcode: ${barcode}`,
        variant: "destructive",
      });
    }
  }, [products, toast]);

  // Listen for physical barcode scanner input
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "Enter") {
        if (barcodeBuffer.current.length > 0) {
          handleBarcodeScan(barcodeBuffer.current);
          barcodeBuffer.current = "";
        }
      } else if (e.key.length === 1) {
        // Accumulate characters
        barcodeBuffer.current += e.key;
        
        // Clear buffer after 100ms of inactivity
        clearTimeout(barcodeTimeout.current);
        barcodeTimeout.current = setTimeout(() => {
          barcodeBuffer.current = "";
        }, 100);
      }
    };

    window.addEventListener("keypress", handleKeyPress);
    return () => {
      window.removeEventListener("keypress", handleKeyPress);
      clearTimeout(barcodeTimeout.current);
    };
  }, [handleBarcodeScan]);

  const addToCart = useCallback(async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) {
      toast({
        title: "Error",
        description: "Product not found",
        variant: "destructive",
      });
      return;
    }

    const existingItem = cart.find(item => item.product.id === productId);
    const newQuantity = existingItem ? existingItem.quantity + 1 : 1;
    
    // Check batch availability using FEFO logic
    const { canFulfill } = await getBatchesForSale(productId, newQuantity);
    if (!canFulfill) {
      toast({
        title: "Error",
        description: "Insufficient stock",
        variant: "destructive",
      });
      return;
    }

    if (existingItem) {
      setCart(prev => prev.map(item =>
        item.product.id === productId
          ? { ...item, quantity: newQuantity }
          : item
      ));
      setSelectedProduct({...existingItem, quantity: newQuantity});
    } else {
      const newItem = {
        product,
        quantity: 1,
        unit_price: product.selling_price
      };
      setCart(prev => [...prev, newItem]);
      setSelectedProduct(newItem);
    }
  }, [products, cart, getBatchesForSale, toast]);

  const selectCartItem = (item: CartItem) => {
    setSelectedProduct(item);
  };

  const updateSelectedProduct = (updates: Partial<CartItem>) => {
    if (!selectedProduct) return;
    
    const updatedItem = { ...selectedProduct, ...updates };
    setSelectedProduct(updatedItem);
    
    if (updates.quantity !== undefined) {
      if (updates.quantity <= 0) {
        removeFromCart(selectedProduct.product.id);
        setSelectedProduct(null);
      } else {
        updateQuantity(selectedProduct.product.id, updates.quantity);
      }
    } else if (updates.unit_price !== undefined) {
      updatePrice(selectedProduct.product.id, updates.unit_price);
    }
  };

  const handleNumpadClick = (value: string) => {
    if (value === "C") {
      setPaidAmount("");
    } else if (value === ".") {
      if (!paidAmount.includes(".")) {
        setPaidAmount(prev => prev + ".");
      }
    } else {
      setPaidAmount(prev => prev + value);
    }
  };

  const addSplitPayment = () => {
    const amount = parseFloat(paidAmount);
    if (!amount || amount <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    const totalPaid = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    if (totalPaid + amount > total + 0.01) {
      toast({
        title: "Error",
        description: "Total paid amount exceeds sale total",
        variant: "destructive",
      });
      return;
    }

    setSplitPayments(prev => [...prev, { method: paymentMethod, amount }]);
    setPaidAmount("");
  };

  const handleFullPayment = async () => {
    setPaidAmount(total.toString());
    // Use a small timeout to ensure state update before processing
    setTimeout(() => {
      handleCompleteSale(total);
    }, 100);
  };

  const removeSplitPayment = (index: number) => {
    setSplitPayments(prev => prev.filter((_, i) => i !== index));
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    // Check batch availability using FEFO logic
    const { canFulfill } = await getBatchesForSale(productId, quantity);
    if (!canFulfill) {
      toast({
        title: "Error",
        description: "Cannot exceed available stock",
        variant: "destructive",
      });
      return;
    }

    setCart(prev => prev.map(item =>
      item.product.id === productId
        ? { ...item, quantity }
        : item
    ));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const updatePrice = (productId: string, newPrice: number) => {
    setCart(prev => prev.map(item =>
      item.product.id === productId
        ? { ...item, unit_price: newPrice }
        : item
    ));
    setEditingPrice(null);
  };

  const [taxEnabled, setTaxEnabled] = useState(true);

  useEffect(() => {
    setTaxEnabled(posSettings.enable_tax);
  }, [posSettings.enable_tax]);

  const { subtotal, discountAmount, taxableAmount, taxAmount, total } = useMemo(() => {
    const subtotal = cart.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const discountAmount = (subtotal * discount) / 100;
    
    let taxableAmount, taxAmount, total;
    
    if (taxEnabled) {
      if (posSettings.tax_inclusive) {
        // Total already includes tax
        total = subtotal - discountAmount;
        taxAmount = total * ((posSettings.tax_rate || 0) / (100 + (posSettings.tax_rate || 0)));
        taxableAmount = total - taxAmount;
      } else {
        // Tax is added to subtotal
        taxableAmount = subtotal - discountAmount;
        taxAmount = (taxableAmount * (posSettings.tax_rate || 0)) / 100;
        total = taxableAmount + taxAmount;
      }
    } else {
      taxableAmount = subtotal - discountAmount;
      taxAmount = 0;
      total = taxableAmount;
    }

    return { subtotal, discountAmount, taxableAmount, taxAmount, total };
  }, [cart, discount, taxEnabled, posSettings.tax_inclusive, posSettings.tax_rate]);

  const remainingAmount = useMemo(() => {
    const totalPaid = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    return Math.max(0, total - totalPaid);
  }, [total, splitPayments]);

  const handleCompleteSale = async (overridePaidAmount?: number) => {
    if (cart.length === 0) {
      toast({
        title: "Error",
        description: "Cart is empty",
        variant: "destructive",
      });
      return;
    }

    // Prepare the payments array for processing
    let paymentsToProcess = [...splitPayments];
    
    // For split payments, check if fully paid
    if (splitPayments.length > 0) {
      if (remainingAmount > 0.01) {
        toast({
          title: "Error",
          description: `Remaining amount: ${formatCurrency(remainingAmount)}`,
          variant: "destructive",
        });
        return;
      }
    } else {
      // For single payment, default to total if no amount entered
      const amount = overridePaidAmount ?? (paidAmount ? parseFloat(paidAmount) : total);
      if (amount < total - 0.01) {
        toast({
          title: "Error",
          description: "Please enter the full payment amount",
          variant: "destructive",
        });
        return;
      }
      // Use single payment for processing
      paymentsToProcess = [{ method: paymentMethod, amount: total }];
    }

    // Check if loan payment is being used
    const hasLoanPayment = paymentsToProcess.some(p => p.method === 'loan');
    
    // If loan payment is selected, open loan dialog immediately
    if (hasLoanPayment) {
      setShowPaymentDialog(false);
      
      // Find the loan payment amount specifically
      const loanPayment = paymentsToProcess.find(p => p.method === 'loan');
      const loanAmount = loanPayment?.amount || 0;
      
      // Store sale data to complete after loan is created
      setPendingSaleData({
        customerName,
        customerPhone,
        subtotal,
        discountAmount,
        taxAmount,
        total,
        cart,
        customerId: undefined,
        paymentsToProcess,
        loanAmount
      });
      setShowLoanDialog(true);
      return;
    }

    setShowPaymentDialog(false);

    try {
      let customerId;
      
      // Create or find customer if name is provided
      if (customerName.trim()) {
        const customer = await findOrCreateCustomer(customerName.trim(), customerPhone.trim() || undefined);
        customerId = customer.id;
      }

      // Determine payment method for database - store as JSON if multiple payments
      const finalPaymentMethod = paymentsToProcess.length > 1 
        ? JSON.stringify(paymentsToProcess) 
        : paymentsToProcess[0].method;

      const saleData = {
        customer_name: customerName || undefined,
        customer_phone: customerPhone || undefined,
        total_amount: subtotal,
        discount: discountAmount,
        tax_amount: taxAmount,
        final_amount: total,
        payment_method: finalPaymentMethod,
        sale_date: new Date().toISOString(),
        notes: undefined
      };

      // Pass the cart items directly - they already match CartItem interface
      const sale = await createSale(saleData, cart, customerId);
      setLastSale({ ...sale, customer_name: customerName, customer_phone: customerPhone });

      toast({
        title: "Success",
        description: `Sale ${sale.sale_number} completed successfully`,
      });

      // Auto-print receipt after successful sale
      setReceiptData({
        saleNumber: sale.sale_number,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        items: [...cart],
        subtotal,
        discount: discountAmount,
        taxAmount,
        taxName: posSettings.tax_name || "Tax",
        total,
        paymentMethod: splitPayments.length > 0 ? "Split Payment" : paymentMethod,
        splitPayments: splitPayments.length > 0 ? splitPayments : undefined,
        tinNumber: tinNumber || undefined,
        receiptPhone: receiptPhone || undefined,
        saleDate: sale.sale_date
      });

      // Clear the cart and customer info after a brief delay
      setTimeout(() => {
        setCart([]);
        setCustomerName("");
        setCustomerPhone("");
        setDiscount(0);
        setPaymentMethod(posSettings.default_payment_method);
        setSelectedProduct(null);
        setPaidAmount("");
        setTinNumber("");
        setReceiptPhone("");
        setSplitPayments([]);
      }, 1000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to complete sale",
        variant: "destructive",
      });
    }
  };

  // Payment dialog keyboard support
  useEffect(() => {
    if (!showPaymentDialog) return;

    const handlePaymentKeyboard = (e: KeyboardEvent) => {
      // Ignore if user is typing in a non-payment input field
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement && !target.readOnly) {
        return;
      }

      // Number keys for numpad
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleNumpadClick(e.key);
      }
      
      // Decimal point
      else if (e.key === '.') {
        e.preventDefault();
        handleNumpadClick('.');
      }
      
      // Backspace or Delete to clear
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleNumpadClick('C');
      }
      
      // Enter to complete payment
      else if (e.key === 'Enter' && remainingAmount <= 0.01) {
        e.preventDefault();
        handleCompleteSale();
      }
      
      // Escape to cancel
      else if (e.key === 'Escape') {
        e.preventDefault();
        setShowPaymentDialog(false);
        setSplitPayments([]);
        setPaidAmount("");
      }
      
      // Plus or Equals to add split payment
      else if ((e.key === '+' || e.key === '=') && paidAmount && parseFloat(paidAmount) > 0) {
        e.preventDefault();
        addSplitPayment();
      }
      
      // Payment method shortcuts (case insensitive)
      else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPaymentMethod('cash');
      }
      else if (e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPaymentMethod('card');
      }
      else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPaymentMethod('momo');
      }
      else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPaymentMethod('airtel');
      }
      else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPaymentMethod('loan');
      }
    };

    window.addEventListener('keydown', handlePaymentKeyboard);
    return () => {
      window.removeEventListener('keydown', handlePaymentKeyboard);
    };
  }, [showPaymentDialog, remainingAmount, paidAmount]);

  const handleLoanCreated = async (loan: any) => {
    console.log('handleLoanCreated called with loan:', loan);
    
    if (!pendingSaleData) {
      console.error('No pending sale data');
      toast({
        title: "Error",
        description: "No pending sale data found",
        variant: "destructive",
      });
      return;
    }

    if (!loan) {
      console.error('No loan object received');
      toast({
        title: "Error",
        description: "Loan creation failed - no loan object",
        variant: "destructive",
      });
      return;
    }

    const { 
      customerName, 
      customerPhone, 
      subtotal, 
      discountAmount, 
      taxAmount, 
      total, 
      cart, 
      paymentsToProcess
    } = pendingSaleData;

    // Close loan dialog
    setShowLoanDialog(false);

    try {
      // Use the customer from the loan
      const customerId = loan.customer_id;
      
      console.log('Creating sale with customerId:', customerId);
      
      // Determine payment method for database
      const finalPaymentMethod = paymentsToProcess.length > 1 
        ? JSON.stringify(paymentsToProcess) 
        : paymentsToProcess[0].method;

      const saleData = {
        customer_name: customerName || undefined,
        customer_phone: customerPhone || undefined,
        total_amount: subtotal,
        discount: discountAmount,
        tax_amount: taxAmount,
        final_amount: total,
        payment_method: finalPaymentMethod,
        sale_date: new Date().toISOString(),
        notes: undefined
      };

      const sale = await createSale(saleData, cart, customerId);
      setLastSale({ ...sale, customer_name: customerName, customer_phone: customerPhone });

      toast({
        title: "Success",
        description: `Loan created and sale ${sale.sale_number} completed successfully`,
      });

      // Auto-print receipt
      setReceiptData({
        saleNumber: sale.sale_number,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        items: [...cart],
        subtotal,
        discount: discountAmount,
        taxAmount,
        taxName: posSettings.tax_name || "Tax",
        total,
        paymentMethod: paymentsToProcess.length > 1 ? "Split Payment" : paymentsToProcess[0].method,
        splitPayments: paymentsToProcess.length > 1 ? paymentsToProcess : undefined,
        tinNumber: tinNumber || undefined,
        receiptPhone: receiptPhone || undefined,
        saleDate: sale.sale_date
      });

      // Clear everything
      setTimeout(() => {
        setCart([]);
        setCustomerName("");
        setCustomerPhone("");
        setDiscount(0);
        setPaymentMethod(posSettings.default_payment_method);
        setSelectedProduct(null);
        setPaidAmount("");
        setTinNumber("");
        setReceiptPhone("");
        setSplitPayments([]);
        setPendingSaleData(null);
      }, 1000);
    } catch (error) {
      console.error('Error completing sale after loan:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to complete sale after loan creation",
        variant: "destructive",
      });
    }
  };

  return (
    <Layout>
      <div className="h-[calc(100vh-40px)] bg-background overflow-hidden">
        {/* Compact Header with Total and Complete Sale */}
        <div className="flex items-center justify-between px-3 py-1 border-b border-border bg-card">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border-r pr-4 mr-2">
              <div className="h-6 w-6 bg-primary/10 rounded flex items-center justify-center border border-primary/20">
                <span className="text-xs font-black text-primary uppercase">
                  {posSettings.pos_name.charAt(0)}
                </span>
              </div>
              <div className="text-sm font-black tracking-tighter text-slate-800 uppercase">
                {posSettings.pos_name.split(' ')[0]} <span className="text-primary font-light ml-1 text-[8px] tracking-[0.2em] uppercase">{posSettings.pos_name.split(' ').slice(1).join(' ') || 'POS'}</span>
              </div>
            </div>
            <div className="text-xl font-bold text-primary">
              Total: {formatCurrency(total)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
                <DialogTrigger asChild>
                  <Button
                    disabled={cart.length === 0}
                    className="h-10 px-6 bg-success hover:bg-success/90 text-success-foreground font-semibold"
                  >
                    Complete Sale
                  </Button>
                </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader className="flex-shrink-0">
                  <DialogTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Complete Payment
                  </DialogTitle>
                  <div className="text-xs text-muted-foreground mt-2 space-y-1">
                    <p>💡 Keyboard shortcuts: <kbd className="px-1 py-0.5 bg-muted rounded text-xs">0-9</kbd> numpad, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Enter</kbd> complete, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Esc</kbd> cancel</p>
                    <p>Payment methods: <kbd className="px-1 py-0.5 bg-muted rounded text-xs">C</kbd> Cash, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">D</kbd> Card, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">M</kbd> MOMO, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">A</kbd> Airtel, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">L</kbd> Loan</p>
                  </div>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto space-y-6 pr-2">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border">
                      <div className="space-y-1">
                        <div className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">Total Amount Due</div>
                        <div className="text-4xl font-black text-primary tabular-nums">
                          {formatCurrency(total)}
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <div className="text-[10px] text-muted-foreground uppercase font-bold">Subtotal: {formatCurrency(subtotal)}</div>
                        <div className="text-[10px] text-muted-foreground uppercase font-bold">Tax ({posSettings.tax_rate}%): {formatCurrency(taxAmount)}</div>
                        {discountAmount > 0 && (
                          <div className="text-[10px] text-success uppercase font-bold">Discount: -{formatCurrency(discountAmount)}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between px-4 py-2 bg-primary/5 rounded-lg border border-primary/10">
                      <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-primary" />
                        <Label htmlFor="tax-toggle" className="text-xs font-bold uppercase cursor-pointer">Include Tax in Payment</Label>
                      </div>
                      <Switch 
                        id="tax-toggle" 
                        checked={taxEnabled} 
                        onCheckedChange={setTaxEnabled} 
                      />
                    </div>
                  </div>

                  {splitPayments.length > 0 && (
                    <div className="text-center p-2 bg-amber-50 rounded-lg border border-amber-100">
                      <div className="text-sm font-bold text-amber-700">
                        Remaining: {formatCurrency(remainingAmount)}
                      </div>
                    </div>
                  )}

                  {/* Full Payment Quick Button */}
                  <Button 
                    onClick={handleFullPayment}
                    className="w-full h-14 text-xl font-black bg-primary hover:bg-primary/90 flex items-center justify-center gap-3 shadow-lg active:scale-[0.98] transition-all"
                  >
                    <ShieldCheck className="h-7 w-7" />
                    COMPLETE FULL PAYMENT
                  </Button>

                  {/* Split Payments List - Hidden, but payment methods are still recorded */}
                  
                  <div>
                    <Label className="text-sm font-medium">Payment Method</Label>
                    <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod}>
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="cash" id="cash" />
                            <Label htmlFor="cash" className="cursor-pointer">
                              Cash <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-xs">C</kbd>
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="momo" id="momo" />
                            <Label htmlFor="momo" className="cursor-pointer">
                              MOMO <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-xs">M</kbd>
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="airtel" id="airtel" />
                            <Label htmlFor="airtel" className="cursor-pointer">
                              Airtel Money <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-xs">A</kbd>
                            </Label>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="card" id="card" />
                            <Label htmlFor="card" className="cursor-pointer">
                              Card <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-xs">D</kbd>
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="loan" id="loan" />
                            <Label htmlFor="loan" className="cursor-pointer">
                              Loan Payment <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-xs">L</kbd>
                            </Label>
                          </div>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Split Payments List */}
                  {splitPayments.length > 0 && (
                    <div className="space-y-2 border-t pt-4">
                      <Label className="text-sm font-medium">Split Payments</Label>
                      <div className="space-y-1.5">
                        {splitPayments.map((payment, index) => (
                          <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded-md text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="capitalize">{payment.method}</Badge>
                              <span className="font-bold">{formatCurrency(payment.amount)}</span>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-6 w-6 p-0 text-destructive"
                              onClick={() => removeSplitPayment(index)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Amount Input with Keypad */}
                  <div>
                    <Label className="text-sm font-medium">Amount for {paymentMethod.toUpperCase()}</Label>
                    <Input 
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                      placeholder="0.00"
                      className="h-10 text-lg font-mono text-center"
                      readOnly
                    />
                    
                    {/* Numeric Keypad */}
                    <div className="grid grid-cols-3 gap-1.5 mt-2">
                      {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "C"].map((key) => (
                        <Button
                          key={key}
                          variant="outline"
                          className="h-9 text-base font-semibold"
                          onClick={() => handleNumpadClick(key)}
                        >
                          {key}
                        </Button>
                      ))}
                    </div>

                    {/* Add Payment Button for Split Payments */}
                    <Button
                      onClick={addSplitPayment}
                      variant="secondary"
                      className="w-full mt-2"
                      disabled={!paidAmount || parseFloat(paidAmount) <= 0}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Payment
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm">TIN Number</Label>
                      <Input 
                        value={tinNumber}
                        onChange={(e) => setTinNumber(e.target.value)}
                        placeholder="Optional"
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-sm">Receipt Phone</Label>
                      <Input 
                        value={receiptPhone}
                        onChange={(e) => setReceiptPhone(e.target.value)}
                        placeholder="Optional"
                        className="h-8"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0 pt-4 border-t">
                  <Button 
                    onClick={handleCompleteSale}
                    className="flex-1 bg-success hover:bg-success/90"
                    disabled={remainingAmount > 0.01}
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Complete & Print
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setShowPaymentDialog(false);
                      setSplitPayments([]);
                      setPaidAmount("");
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            
            <CreateLoanDialog
              open={showLoanDialog}
              onOpenChange={setShowLoanDialog}
              prefilledAmount={pendingSaleData?.loanAmount}
              onLoanCreated={handleLoanCreated}
            />
            
            <Button
              variant="outline"
              onClick={() => setShowCustomerDisplay(!showCustomerDisplay)}
              size="sm"
            >
              <Monitor className="h-4 w-4 mr-2" />
              Display
            </Button>
            </div>
          </div>
        </div>

        {/* Main Content - Full Width */}
        <div className="h-[calc(100%-40px)]">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Expanded Left Panel - Cart Items */}
            <ResizablePanel defaultSize={60} minSize={50} maxSize={70}>
              <div className="h-full bg-card border-r border-border flex flex-col">
                <div className="p-3 border-b border-border">
                  <h3 className="font-semibold text-sm">Cart Items</h3>
                </div>
                
                {/* Cart Items List - One Column Layout */}
                <div className="flex-1 overflow-auto p-3">
                  <div className="space-y-2">
                    {cart.map((item) => (
                      <div
                        key={item.product.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border bg-background hover:bg-muted/50"
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm truncate">{item.product.name}</h4>
                        </div>
                        
                        <div className="flex items-center gap-2 ml-3">
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="h-6 w-6 p-0"
                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span 
                            className="text-sm font-medium cursor-pointer min-w-[30px] text-center"
                            onClick={() => addToCart(item.product.id)}
                          >
                            {item.quantity}
                          </span>
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="h-6 w-6 p-0"
                            onClick={() => addToCart(item.product.id)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        
                        <div className="text-sm font-medium ml-3 min-w-[80px] text-right">
                          {formatCurrency(item.unit_price)}
                        </div>
                        
                        <Button 
                          size="sm" 
                          variant="ghost"
                          className="h-6 w-6 p-0 ml-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => removeFromCart(item.product.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {cart.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">Cart is empty</p>
                    )}
                  </div>
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right Panel - Products Grid */}
            <ResizablePanel defaultSize={40} minSize={30} maxSize={50}>
                <div className="h-full bg-background">
                  {/* Search */}
                  <div className="p-4 border-b border-border">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search products or scan barcode..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10 h-9"
                        />
                      </div>
                      <BarcodeScanner onScan={handleBarcodeScan} />
                    </div>
                  </div>

                  {/* Products Grid - Compact - 9 cards per column */}
                  <div className="p-1.5 h-[calc(100%-60px)] overflow-auto">
                    <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5">
                      {filteredProducts.map((product) => {
                        const stock = getProductStock(product.id);
                        const inCart = cart.find(item => item.product.id === product.id);
                        
                        return (
                          <Card
                            key={product.id}
                            className={`cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-105 ${
                              inCart ? 'ring-1 ring-primary bg-primary/5' : ''
                            }`}
                            onClick={() => addToCart(product.id)}
                          >
                            <CardContent className="p-1.5">
                              <div className="text-center">
                                {product.image_url ? (
                                  <div className="w-10 h-10 bg-muted/50 rounded-md mb-0.5 mx-auto overflow-hidden">
                                    <img 
                                      src={product.image_url} 
                                      alt={product.name}
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                ) : (
                                  <div className="w-6 h-6 bg-muted/50 rounded-md mb-0.5 mx-auto flex items-center justify-center">
                                    <Package className="h-3 w-3 text-muted-foreground" />
                                  </div>
                                )}
                                <h3 className="font-medium text-[9px] truncate mb-0.5 leading-tight" title={product.name}>
                                  {product.name}
                                </h3>
                                <div className="text-[8px] text-muted-foreground mb-0.5">
                                  Stock: {stock}
                                </div>
                                <div className="font-bold text-[9px] text-primary">
                                  {formatCurrency(product.selling_price)}
                                </div>
                                {inCart && (
                                  <Badge variant="secondary" className="mt-0.5 text-[7px] px-0.5 py-0 h-3">
                                    {inCart.quantity}
                                  </Badge>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
        </div>

        {/* Customer Display Modal */}
        {showCustomerDisplay && (
          <CustomerDisplay
            cart={cart}
            subtotal={subtotal}
            discountAmount={discountAmount}
            total={total}
            customerName={customerName}
          />
        )}

        {/* Receipt Printing */}
        {receiptData && (
          <ReceiptPrint
            key={`${receiptData.saleNumber || 'receipt'}-${String(receiptData.saleDate || '')}-${receiptData.total || 0}`}
            {...receiptData}
            onPrintComplete={() => setReceiptData(null)}
          />
        )}
      </div>
    </Layout>
  );
}
