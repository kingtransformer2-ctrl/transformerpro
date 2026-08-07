import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { useProductBatches } from "@/hooks/useProductBatches";
import { ProductBatch, Product } from "@/types/inventory";
import { Package, Plus, Edit, Trash2, Calendar, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface ProductBatchesDialogProps {
  product: Product;
  trigger?: React.ReactNode;
}

type BatchFormData = Omit<ProductBatch, 'id' | 'created_at' | 'updated_at' | 'product_id'>;

export function ProductBatchesDialog({ product, trigger }: ProductBatchesDialogProps) {
  const { batches, loading, addBatch, updateBatch, deleteBatch } = useProductBatches(product.id);
  const [isOpen, setIsOpen] = useState(false);
  const [isAddingBatch, setIsAddingBatch] = useState(false);
  const [editingBatch, setEditingBatch] = useState<ProductBatch | null>(null);

  const form = useForm<BatchFormData>({
    defaultValues: {
      batch_number: "",
      purchase_price: product.purchase_price,
      selling_price: product.selling_price,
      quantity: 0,
      received_date: new Date().toISOString(),
      expiry_date: "",
      supplier: "",
      notes: "",
    },
  });

  const onSubmit = async (data: BatchFormData) => {
    try {
      const batchData = {
        ...data,
        product_id: product.id,
        received_date: data.received_date || new Date().toISOString(),
      };

      if (editingBatch) {
        await updateBatch(editingBatch.id, batchData);
      } else {
        await addBatch(batchData);
      }
      
      setIsAddingBatch(false);
      setEditingBatch(null);
      form.reset();
    } catch (error) {
      console.error('Error saving batch:', error);
    }
  };

  const handleEdit = (batch: ProductBatch) => {
    setEditingBatch(batch);
    form.reset({
      batch_number: batch.batch_number,
      purchase_price: batch.purchase_price,
      selling_price: batch.selling_price,
      quantity: batch.quantity,
      received_date: batch.received_date,
      expiry_date: batch.expiry_date || "",
      supplier: batch.supplier || "",
      notes: batch.notes || "",
    });
    setIsAddingBatch(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this batch?")) {
      await deleteBatch(id);
    }
  };

  const handleAddNew = () => {
    setEditingBatch(null);
    form.reset({
      batch_number: `BATCH-${Date.now()}`,
      purchase_price: product.purchase_price,
      selling_price: product.selling_price,
      quantity: 0,
      received_date: new Date().toISOString(),
      expiry_date: "",
      supplier: "",
      notes: "",
    });
    setIsAddingBatch(true);
  };

  const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);
  const expiredBatches = batches.filter(batch => 
    batch.expiry_date && new Date(batch.expiry_date) < new Date()
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Package className="w-4 h-4 mr-2" />
            Manage Batches
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Product Batches: {product.name}</DialogTitle>
          <DialogDescription>
            Manage different batches/lots of this product with varying expiry dates and prices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{totalStock}</p>
              <p className="text-sm text-muted-foreground">Total Stock</p>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{batches.length}</p>
              <p className="text-sm text-muted-foreground">Total Batches</p>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-2xl font-bold text-destructive">{expiredBatches.length}</p>
              <p className="text-sm text-muted-foreground">Expired Batches</p>
            </div>
          </div>

          {/* Add/Edit Batch Form */}
          {isAddingBatch && (
            <div className="border rounded-lg p-4">
              <h4 className="font-semibold mb-4">
                {editingBatch ? "Edit Batch" : "Add New Batch"}
              </h4>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="batch_number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Batch Number *</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="BATCH-001" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Quantity *</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="number"
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="purchase_price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Purchase Price *</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="number" 
                              step="0.01"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="selling_price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Selling Price *</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="number" 
                              step="0.01"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="expiry_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expiry Date</FormLabel>
                          <FormControl>
                            <Input {...field} type="date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="supplier"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Supplier</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Supplier name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder="Additional notes..." />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end space-x-2">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setIsAddingBatch(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingBatch ? "Update Batch" : "Add Batch"}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          )}

          {/* Batches Table */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-semibold">Current Batches</h4>
              <Button onClick={handleAddNew} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Batch
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8">Loading batches...</div>
            ) : batches.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No batches found. Add the first batch for this product.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch #</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Purchase Price</TableHead>
                    <TableHead>Selling Price</TableHead>
                    <TableHead>Expiry Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => {
                    const isExpired = batch.expiry_date && new Date(batch.expiry_date) < new Date();
                    const isNearExpiry = batch.expiry_date && 
                      new Date(batch.expiry_date) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                    
                    return (
                      <TableRow key={batch.id} className={isExpired ? "bg-destructive/10" : ""}>
                        <TableCell className="font-medium">{batch.batch_number}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {batch.quantity}
                            {batch.quantity <= 0 && (
                              <Badge variant="destructive" className="text-xs">Out of Stock</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>${batch.purchase_price.toFixed(2)}</TableCell>
                        <TableCell>${batch.selling_price.toFixed(2)}</TableCell>
                        <TableCell>
                          {batch.expiry_date ? (
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4" />
                              {format(new Date(batch.expiry_date), 'MMM dd, yyyy')}
                              {isExpired && (
                                <Badge variant="destructive" className="text-xs">
                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                  Expired
                                </Badge>
                              )}
                              {!isExpired && isNearExpiry && (
                                <Badge variant="outline" className="text-xs">
                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                  Near Expiry
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">No expiry</span>
                          )}
                        </TableCell>
                        <TableCell>{batch.supplier || "—"}</TableCell>
                        <TableCell>
                          <div className="flex space-x-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(batch)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(batch.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}