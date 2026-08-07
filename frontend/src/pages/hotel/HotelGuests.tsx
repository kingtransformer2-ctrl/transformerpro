import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHotelGuests, useCreateGuest, useUpdateGuest } from '@/hooks/useHotel';
import { useNavigationAccess } from '@/hooks/useNavigationAccess';
import { HotelGuest } from '@/types/hotel';
import { Plus, Search, Edit, Loader2, Users, Star, Mail, Phone, UtensilsCrossed } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';

export default function HotelGuests() {
  const { data: guests, isLoading } = useHotelGuests();
  const createGuest = useCreateGuest();
  const updateGuest = useUpdateGuest();
  const { canAccessRoute } = useNavigationAccess();

  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGuest, setEditingGuest] = useState<HotelGuest | null>(null);
  const canAccessServiceMenu = canAccessRoute('/hotel/service-menu');

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    id_proof_type: '',
    id_proof_number: '',
    address: '',
    nationality: 'India',
  });

  const filteredGuests = guests?.filter(guest => {
    const searchLower = search.toLowerCase();
    return (
      guest.first_name.toLowerCase().includes(searchLower) ||
      guest.last_name.toLowerCase().includes(searchLower) ||
      guest.phone?.includes(search) ||
      guest.email?.toLowerCase().includes(searchLower)
    );
  }) || [];

  const handleSubmit = async () => {
    if (!formData.first_name || !formData.last_name || !formData.phone) {
      toast.error('Please fill in required fields');
      return;
    }

    try {
      if (editingGuest) {
        await updateGuest.mutateAsync({ id: editingGuest.id, ...formData });
      } else {
        await createGuest.mutateAsync(formData);
      }
      setIsDialogOpen(false);
      resetForm();
    } catch {
      // Error handled by mutation
    }
  };

  const resetForm = () => {
    setFormData({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      id_proof_type: '',
      id_proof_number: '',
      address: '',
      nationality: 'India',
    });
    setEditingGuest(null);
  };

  const handleEdit = (guest: HotelGuest) => {
    setEditingGuest(guest);
    setFormData({
      first_name: guest.first_name,
      last_name: guest.last_name,
      email: guest.email || '',
      phone: guest.phone,
      id_proof_type: guest.id_proof_type || '',
      id_proof_number: guest.id_proof_number || '',
      address: guest.address || '',
      nationality: guest.nationality,
    });
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Guests</h1>
          <p className="text-muted-foreground">Manage guest profiles and history</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAccessServiceMenu && (
            <Link to="/hotel/service-menu">
              <Button variant="outline" className="gap-2">
                <UtensilsCrossed className="h-4 w-4" />
                Service Menu
              </Button>
            </Link>
          )}
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Guest
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingGuest ? 'Edit Guest' : 'Add New Guest'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name *</Label>
                  <Input
                    value={formData.first_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name *</Label>
                  <Input
                    value={formData.last_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone *</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ID Proof Type</Label>
                  <Select
                    value={formData.id_proof_type}
                    onValueChange={(v) => setFormData(prev => ({ ...prev, id_proof_type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="passport">Passport</SelectItem>
                      <SelectItem value="drivers_license">Driver's License</SelectItem>
                      <SelectItem value="national_id">National ID</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ID Proof Number</Label>
                  <Input
                    value={formData.id_proof_number}
                    onChange={(e) => setFormData(prev => ({ ...prev, id_proof_number: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Address</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Nationality</Label>
                <Input
                  value={formData.nationality}
                  onChange={(e) => setFormData(prev => ({ ...prev, nationality: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={createGuest.isPending || updateGuest.isPending}>
                  {(createGuest.isPending || updateGuest.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingGuest ? 'Update' : 'Create'} Guest
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Guests Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>ID Proof</TableHead>
                  <TableHead>Nationality</TableHead>
                  <TableHead>Loyalty Points</TableHead>
                  <TableHead>Member Since</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGuests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-muted-foreground">No guests found</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGuests.map(guest => (
                    <TableRow key={guest.id}>
                      {/* ... rest of table content */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="font-medium text-primary">
                            {guest.first_name[0]}{guest.last_name[0]}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium">{guest.first_name} {guest.last_name}</p>
                          {guest.address && (
                            <p className="text-sm text-muted-foreground">{guest.address}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-sm">
                          <Phone className="h-3 w-3" />
                          {guest.phone}
                        </div>
                        {guest.email && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {guest.email}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {guest.id_proof_type ? (
                        <div>
                          <p className="capitalize">{guest.id_proof_type.replace('_', ' ')}</p>
                          <p className="text-sm text-muted-foreground">{guest.id_proof_number}</p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Not provided</span>
                      )}
                    </TableCell>
                    <TableCell>{guest.nationality}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1">
                        <Star className="h-3 w-3" />
                        {guest.loyalty_points}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {format(new Date(guest.created_at), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="icon" onClick={() => handleEdit(guest)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
      </div>
    </Layout>
  );
}
