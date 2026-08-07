import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useInvoiceItems, useAddInvoiceItem, useDeleteInvoiceItem } from '@/hooks/useHotelServices';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { useActiveStaffShift } from '@/hooks/useHotelShifts';
import { useAvailableServices, ServiceMenuItem } from '@/hooks/useServiceMenu';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { HotelBooking } from '@/types/hotel';
import { Loader2, Trash2, Coffee, UtensilsCrossed, Wine, Sparkles, ShoppingBag, Package, AlertTriangle, Plus } from 'lucide-react';
import { toast } from 'sonner';
interface GuestServicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: HotelBooking;
}

const serviceCategories = [
  { value: 'food', label: 'Food & Dining', icon: UtensilsCrossed },
  { value: 'beverages', label: 'Beverages', icon: Coffee },
  { value: 'minibar', label: 'Mini Bar', icon: Wine },
  { value: 'laundry', label: 'Laundry', icon: Sparkles },
  { value: 'other', label: 'Other Services', icon: ShoppingBag },
];

export function GuestServicesDialog({ open, onOpenChange, booking }: GuestServicesDialogProps) {
  const { formatCurrency } = useSettingsContext();
  const { activeStaff } = useStaffSession();
  const { data: activeShift } = useActiveStaffShift(activeStaff?.staff_id);
  const [category, setCategory] = useState<string>('food');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedServiceItem, setSelectedServiceItem] = useState<ServiceMenuItem | null>(null);

  const { data: items, isLoading } = useInvoiceItems(booking.id);
  const { data: menuItems = [] } = useAvailableServices();
  const addItem = useAddInvoiceItem();
  const deleteItem = useDeleteInvoiceItem();
  // Group menu items by category with full item data
  const presetServices = useMemo(() => {
    const grouped: Record<string, ServiceMenuItem[]> = {
      food: [],
      beverages: [],
      minibar: [],
      laundry: [],
      other: [],
    };
    
    menuItems.forEach(item => {
      if (grouped[item.category]) {
        grouped[item.category].push(item);
      }
    });
    
    return grouped;
  }, [menuItems]);

  const handleAddService = async () => {
    if (!activeShift) {
      toast.error('Open a shift before adding services');
      return;
    }
    if (!description || unitPrice <= 0) {
      toast.error('Please enter service details');
      return;
    }

    try {
      // Guest services still post to the guest folio here. Inventory now moves only
      // when a hotel order item is inserted elsewhere in the order flow.
      await addItem.mutateAsync({
        booking_id: booking.id,
        description,
        item_type: category,
        unit_price: unitPrice,
        quantity,
        total_price: unitPrice * quantity,
        service_item_id: selectedServiceItem?.id,
        shift_id: activeShift.id,
        staff_id: activeStaff?.staff_id || null,
      });

      setDescription('');
      setUnitPrice(0);
      setQuantity(1);
      setSelectedServiceItem(null);
    } catch (error) {
      // Error already handled by mutation
    }
  };

  const handlePresetClick = (item: ServiceMenuItem) => {
    setSelectedServiceItem(item);
    setDescription(item.name);
    setUnitPrice(item.selling_price);
    setCategory(item.category);
  };

  const totalServices = items?.reduce((sum, item) => sum + Number(item.total_price), 0) || 0;
  const CategoryIcon = serviceCategories.find(c => c.value === category)?.icon || ShoppingBag;

  // Check if selected item has low stock
  const isLowStock = selectedServiceItem?.track_stock && 
    (selectedServiceItem.stock_quantity || 0) <= (selectedServiceItem.min_stock_threshold || 5);
  const isOutOfStock = selectedServiceItem?.track_stock && 
    (selectedServiceItem.stock_quantity || 0) === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] max-h-[95vh] overflow-hidden flex flex-col bg-slate-900 text-white border-slate-800 p-0" aria-describedby={undefined}>
        <div className="p-6 border-b border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-3xl font-bold">
              <CategoryIcon className="h-8 w-8 text-orange-500" />
              Guest Services - Room {booking.room?.room_number}
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-lg">
              Manage and add services for {booking.guest?.first_name} {booking.guest?.last_name}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid md:grid-cols-2 gap-8 flex-1 overflow-hidden p-6">
          {/* Add Service Form */}
          <div className="space-y-6 flex flex-col h-full overflow-y-auto pr-4">
            <div className="space-y-3">
              <Label className="text-lg font-semibold">Service Category</Label>
              <Select value={category} onValueChange={(val) => {
                setCategory(val);
                setSelectedServiceItem(null);
              }}>
                <SelectTrigger className="h-12 text-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {serviceCategories.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex items-center gap-3 py-1">
                        <cat.icon className="h-5 w-5" />
                        <span className="text-lg">{cat.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quick Add Presets from Database */}
            <div className="space-y-3">
              <Label className="text-lg font-semibold">Quick Add Items</Label>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto p-1">
                {presetServices[category]?.length > 0 ? (
                  presetServices[category].map((item) => {
                    const outOfStock = item.track_stock && (item.stock_quantity || 0) === 0;
                    const lowStock = item.track_stock && 
                      (item.stock_quantity || 0) <= (item.min_stock_threshold || 5) && 
                      !outOfStock;
                    
                    return (
                      <Button
                        key={item.id}
                        variant={selectedServiceItem?.id === item.id ? "default" : "outline"}
                        size="lg"
                        className="justify-start h-auto py-3 relative border-2"
                        onClick={() => handlePresetClick(item)}
                      >
                        <div className="flex flex-col items-start gap-1 flex-1 min-w-0">
                          <span className="truncate text-left w-full font-bold text-base">{item.name}</span>
                          {item.track_stock && (
                            <span className={`text-xs flex items-center gap-1 ${
                              outOfStock ? 'text-destructive' : 
                              lowStock ? 'text-amber-600' : 'text-emerald-400'
                            }`}>
                              <Package className="h-3.5 w-3.5" />
                              {item.stock_quantity} in stock
                            </span>
                          )}
                        </div>
                        <Badge variant="secondary" className="ml-1 shrink-0 text-base font-bold">{formatCurrency(item.selling_price)}</Badge>
                      </Button>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground col-span-full py-8 text-center bg-slate-800/50 rounded-xl">
                    No items in this category
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <Label className="text-lg font-semibold">Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Service description"
                  className="h-12 text-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Label className="text-lg font-semibold">Unit Price</Label>
                  <Input
                    type="number"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    className="h-12 text-lg"
                  />
                </div>
                <div className="space-y-3">
                  <Label className="text-lg font-semibold">Quantity</Label>
                  <Input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    min={1}
                    className="h-12 text-lg"
                  />
                </div>
              </div>
            </div>

            {isLowStock && (
              <div className="flex items-center gap-2 p-4 bg-amber-900/30 border border-amber-800/50 rounded-xl text-amber-200">
                <AlertTriangle className="h-6 w-6 shrink-0" />
                <p className="text-sm font-medium">
                  Low stock warning: Only {selectedServiceItem?.stock_quantity} remaining.
                </p>
              </div>
            )}

            <Button 
              size="lg"
              className="w-full h-16 gap-3 text-xl font-bold bg-orange-600 hover:bg-orange-700 shadow-lg shadow-orange-900/20" 
              onClick={handleAddService}
              disabled={addItem.isPending || !activeShift}
            >
              {addItem.isPending ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Plus className="h-6 w-6" />
              )}
              Add Service ({formatCurrency(unitPrice * quantity)})
            </Button>
          </div>

          {/* Current Services List */}
          <div className="flex flex-col h-full overflow-hidden bg-slate-800/30 rounded-2xl border border-slate-800 p-6">
            <div className="flex items-center justify-between mb-6">
              <Label className="text-xl font-bold">Current Services</Label>
              <Badge variant="outline" className="text-lg py-1 px-3 border-slate-700 bg-slate-900">
                Total: {formatCurrency(totalServices)}
              </Badge>
            </div>
            
            <ScrollArea className="flex-1 -mx-2 px-2">
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                </div>
              ) : items?.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-4">
                  <ShoppingBag className="h-16 w-16 opacity-20" />
                  <p className="text-lg font-medium">No services added yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {items?.map(item => (
                    <Card key={item.id} className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-xl bg-slate-800 flex items-center justify-center">
                            {serviceCategories.find(c => c.value === item.item_type)?.icon ? (
                              (() => {
                                const Icon = serviceCategories.find(c => c.value === item.item_type)!.icon;
                                return <Icon className="h-6 w-6 text-slate-400" />;
                              })()
                            ) : <ShoppingBag className="h-6 w-6 text-slate-400" />}
                          </div>
                          <div>
                            <p className="font-bold text-lg">{item.description}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className="bg-slate-800 text-slate-300">
                                {item.item_type}
                              </Badge>
                              <span className="text-slate-400 text-sm">
                                {item.quantity} × {formatCurrency(item.unit_price)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <p className="font-black text-xl tracking-tighter">
                            {formatCurrency(item.total_price)}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 rounded-full text-slate-500 hover:text-red-400 hover:bg-red-400/10"
                            onClick={() => deleteItem.mutate(item.id)}
                            disabled={deleteItem.isPending}
                          >
                            <Trash2 className="h-5 w-5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <div className="p-6 border-t border-slate-800 bg-slate-950/50 flex justify-end gap-3">
          <Button 
            variant="outline" 
            size="lg"
            className="h-12 px-8 border-slate-700 hover:bg-slate-800 text-lg font-bold"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button 
            size="lg"
            className="h-12 px-8 bg-emerald-600 hover:bg-emerald-700 text-lg font-bold"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
