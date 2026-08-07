import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { useCustomers } from "@/hooks/useCustomers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Plus, Search, Edit, Trash2, User, Eye, Download, CheckSquare } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { apiClient } from "@/integrations/supabase/client";
import type { Customer } from "@/hooks/useCustomers";
import { CustomerDetailsDialog } from "@/components/customers/CustomerDetailsDialog";
import { BulkUpdateDialog } from "@/components/common/BulkUpdateDialog";
import { exportToExcel, exportToCSV } from "@/lib/export";
import { Checkbox } from "@/components/ui/checkbox";

export default function Customers() {
  const { 
    customers, 
    loading, 
    refreshCustomers, 
    addCustomer, 
    updateCustomer, 
    deleteCustomer: removeCustomer, 
    bulkUpdateCustomers,
    bulkDeleteCustomers 
  } = useCustomers();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    tin_number: "",
  });

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, formData);
        toast({
          title: "Success",
          description: "Customer updated successfully",
        });
      } else {
        await addCustomer(formData);
        toast({
          title: "Success",
          description: "Customer created successfully",
        });
      }
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save customer",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      tin_number: customer.tin_number || "",
    });
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteCustomer) return;
    try {
      await removeCustomer(deleteCustomer.id);
      toast({
        title: "Success",
        description: "Customer deleted successfully",
      });
      setDeleteCustomer(null);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete customer",
        variant: "destructive",
      });
    }
  };

  const handleBulkDelete = async () => {
    try {
      const ids = Array.from(selectedCustomers);
      await bulkDeleteCustomers(ids);
      toast({
        title: "Success",
        description: `${ids.length} customers deleted successfully`,
      });
      setSelectedCustomers(new Set());
      setBulkDeleteConfirmOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete customers",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setFormData({ name: "", phone: "", email: "", address: "", tin_number: "" });
    setEditingCustomer(null);
  };

  const handleExportExcel = () => {
    const exportData = filteredCustomers.map(c => ({
      Name: c.name,
      Phone: c.phone || '',
      TIN: c.tin_number || '',
      Email: c.email || '',
      Address: c.address || '',
    }));
    exportToExcel(exportData, `customers-${new Date().toISOString().split('T')[0]}`, 'Customers');
    toast({ title: "Success", description: "Customers exported to Excel" });
  };

  const handleExportCSV = () => {
    const exportData = filteredCustomers.map(c => ({
      Name: c.name,
      Phone: c.phone || '',
      TIN: c.tin_number || '',
      Email: c.email || '',
      Address: c.address || '',
    }));
    exportToCSV(exportData, `customers-${new Date().toISOString().split('T')[0]}`);
    toast({ title: "Success", description: "Customers exported to CSV" });
  };

  const handleBulkUpdate = async (updates: Record<string, any>) => {
    try {
      const ids = Array.from(selectedCustomers);
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, value]) => value !== '' && value !== undefined)
      );
      await bulkUpdateCustomers(ids, cleanUpdates);
      toast({ title: "Success", description: `${ids.length} customers updated` });
      setSelectedCustomers(new Set());
    } catch (error) {
      toast({ title: "Error", description: "Failed to update customers", variant: "destructive" });
    }
  };

  const toggleCustomer = (id: string) => {
    const newSelected = new Set(selectedCustomers);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedCustomers(newSelected);
  };

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) resetForm();
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Customers</h1>
            <p className="text-muted-foreground">Manage customer information</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refreshCustomers()}>
              <Search className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Customer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingCustomer ? "Edit Customer" : "Add New Customer"}
                  </DialogTitle>
                  <DialogDescription>
                    {editingCustomer
                      ? "Update customer information"
                      : "Enter customer details to create a new record"}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        value={formData.phone}
                        onChange={(e) =>
                          setFormData({ ...formData, phone: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="tin_number">TIN Number</Label>
                      <Input
                        id="tin_number"
                        value={formData.tin_number}
                        onChange={(e) =>
                          setFormData({ ...formData, tin_number: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) =>
                        setFormData({ ...formData, address: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex gap-2 justify-end pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleDialogClose(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingCustomer ? "Update" : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Customer List</CardTitle>
            <CardDescription>
              View and manage all customers ({filteredCustomers.length})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, phone, or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2 items-center">
                {selectedCustomers.size > 0 && (
                  <>
                    <Button onClick={() => setBulkUpdateOpen(true)} variant="outline" size="sm">
                      <CheckSquare className="h-4 w-4 mr-2" />
                      Update ({selectedCustomers.size})
                    </Button>
                    <Button onClick={() => setBulkDeleteConfirmOpen(true)} variant="destructive" size="sm">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete ({selectedCustomers.size})
                    </Button>
                  </>
                )}
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

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedCustomers.size === filteredCustomers.length && filteredCustomers.length > 0}
                      onCheckedChange={() => {
                        if (selectedCustomers.size === filteredCustomers.length) {
                          setSelectedCustomers(new Set());
                        } else {
                          setSelectedCustomers(new Set(filteredCustomers.map(c => c.id)));
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>TIN</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10">
                      Loading customers...
                    </TableCell>
                  </TableRow>
                ) : filteredCustomers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">
                      <div className="py-8">
                        <User className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">
                          No customers found
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCustomers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedCustomers.has(customer.id)}
                          onCheckedChange={() => toggleCustomer(customer.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {customer.name}
                      </TableCell>
                      <TableCell>{customer.phone || "-"}</TableCell>
                      <TableCell>{customer.tin_number || "-"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{customer.email || "-"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{customer.address || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            title="View Details"
                            onClick={() => { setSelectedCustomer(customer); setDetailsOpen(true); }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            title="Edit"
                            onClick={() => handleEdit(customer)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            title="Delete"
                            onClick={() => setDeleteCustomer(customer)}
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
          </CardContent>
        </Card>

        {/* Delete Confirmation */}
        <AlertDialog
          open={!!deleteCustomer}
          onOpenChange={() => setDeleteCustomer(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Customer</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete {deleteCustomer?.name}? This
                action cannot be undone and will remove all local and cloud records for this customer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Delete Confirmation */}
        <AlertDialog
          open={bulkDeleteConfirmOpen}
          onOpenChange={setBulkDeleteConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Bulk Delete Customers</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete {selectedCustomers.size} customers? This
                action cannot be undone and will remove all selected records from the system.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground">
                Delete {selectedCustomers.size} Customers
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <CustomerDetailsDialog
          customer={selectedCustomer}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />

        <BulkUpdateDialog
          open={bulkUpdateOpen}
          onOpenChange={setBulkUpdateOpen}
          onUpdate={handleBulkUpdate}
          selectedCount={selectedCustomers.size}
          fields={[
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'tin_number', label: 'TIN Number', type: 'text' },
            { key: 'email', label: 'Email', type: 'text' },
            { key: 'address', label: 'Address', type: 'text' },
          ]}
        />
      </div>
    </Layout>
  );
}
