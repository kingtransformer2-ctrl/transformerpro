import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useHotelInfo, useUpdateHotelInfo } from "@/hooks/useHotel";
import { RolePermissionsEditor } from "@/components/settings/RolePermissionsEditor";
import { Building, Receipt, Bell, Users, DollarSign, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export default function HotelSettings() {
  const { data: hotelInfo, isLoading } = useHotelInfo();
  const updateHotelInfo = useUpdateHotelInfo();
  const queryClient = useQueryClient();

  const handleSaveHotelInfo = async () => {
    try {
      if (hotelInfo?.id) {
        await Promise.resolve(updateHotelInfo.mutateAsync({ id: hotelInfo.id, ...hotelData }));
        toast.success("Restaurant information updated");
      } else {
        // Create new hotel info record
        const result = await (apiClient
          .from('hotel_info')
          .insert(hotelData)
          .select()
          .single() as any);
        
        if (result?.error) throw new Error(result.error.message || 'Failed to save');
        toast.success("Restaurant information saved");
        
        // Invalidate hotel info query to refetch
        queryClient.invalidateQueries({ queryKey: ['hotel-info'] });
      }
    } catch (error: any) {
      toast.error(error?.message || "Failed to save restaurant information");
    }
  };

  const [hotelData, setHotelData] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    tax_rate: 18,
    tax_inclusive: true,
    tin_number: "",
    cancellation_policy: "",
    logo_url: "",
  });

  // Sync the form with the actual saved settings once they load
  useEffect(() => {
    if (hotelInfo) {
      setHotelData({
        name: hotelInfo.name || "",
        address: hotelInfo.address || "",
        phone: hotelInfo.phone || "",
        email: hotelInfo.email || "",
        tax_rate: hotelInfo.tax_rate ?? 18,
        tax_inclusive: hotelInfo.tax_inclusive ?? true,
        tin_number: hotelInfo.tin_number || "",
        cancellation_policy: hotelInfo.cancellation_policy || "",
        logo_url: hotelInfo.logo_url || "",
      });
    }
  }, [hotelInfo]);

  const [notifications, setNotifications] = useState({
    emailBookingConfirmation: true,
    emailCheckoutReminder: true,
    smsBookingConfirmation: false,
    smsCheckoutReminder: false,
  });


  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Restaurant Settings</h1>
          <p className="text-muted-foreground">Configure your restaurant system preferences</p>
        </div>

        <Tabs defaultValue="general" className="space-y-4">
          <ScrollArea className="w-full">
            <TabsList className="flex w-max min-w-full justify-start h-12">
              <TabsTrigger value="general" className="flex items-center gap-2">
                <Building className="h-4 w-4" />
                General
              </TabsTrigger>
              <TabsTrigger value="billing" className="flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                Billing
              </TabsTrigger>
              <TabsTrigger value="pricing" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Pricing
              </TabsTrigger>
              <TabsTrigger value="notifications" className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notifications
              </TabsTrigger>
              <TabsTrigger value="roles" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Roles
              </TabsTrigger>
            </TabsList>
          </ScrollArea>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Restaurant Information</CardTitle>
                <CardDescription>Basic information about your restaurant</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Restaurant Name</Label>
                    <Input
                      value={hotelData.name}
                      onChange={(e) => setHotelData({ ...hotelData, name: e.target.value })}
                      placeholder="Restaurant Name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={hotelData.email}
                      onChange={(e) => setHotelData({ ...hotelData, email: e.target.value })}
                      placeholder="contact@restaurant.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      value={hotelData.phone}
                      onChange={(e) => setHotelData({ ...hotelData, phone: e.target.value })}
                      placeholder="+1 234 567 890"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Logo URL</Label>
                    <Input
                      value={hotelData.logo_url}
                      onChange={(e) => setHotelData({ ...hotelData, logo_url: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Textarea
                    value={hotelData.address}
                    onChange={(e) => setHotelData({ ...hotelData, address: e.target.value })}
                    placeholder="123 Restaurant Street, City, Country"
                    rows={2}
                  />
                </div>
                <Button onClick={handleSaveHotelInfo} disabled={updateHotelInfo.isPending}>
                  {updateHotelInfo.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="billing">
            <Card>
              <CardHeader>
                <CardTitle>Billing & Tax Settings</CardTitle>
                <CardDescription>Configure tax rates and billing preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tax Rate (%)</Label>
                    <Input
                      type="number"
                      value={hotelData.tax_rate}
                      onChange={(e) => setHotelData({ ...hotelData, tax_rate: Number(e.target.value) })}
                      min={0}
                      max={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>TIN Number</Label>
                    <Input
                      value={hotelData.tin_number}
                      onChange={(e) => setHotelData({ ...hotelData, tin_number: e.target.value })}
                      placeholder="Enter TIN number"
                      className="font-mono"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                    <div className="space-y-0.5">
                      <Label className="text-base">Tax Inclusive Pricing</Label>
                      <p className="text-sm text-muted-foreground">
                        Whether prices already include taxes (VAT/Sales Tax)
                      </p>
                    </div>
                    <Switch 
                      checked={hotelData.tax_inclusive}
                      onCheckedChange={(checked) => setHotelData({ ...hotelData, tax_inclusive: checked })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Cancellation Policy</Label>
                  <Textarea
                    value={hotelData.cancellation_policy}
                    onChange={(e) => setHotelData({ ...hotelData, cancellation_policy: e.target.value })}
                    placeholder="Free cancellation up to 24 hours before check-in..."
                    rows={4}
                  />
                </div>
                <Button onClick={handleSaveHotelInfo} disabled={updateHotelInfo.isPending}>
                  {updateHotelInfo.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pricing Tab */}
          <TabsContent value="pricing">
            <Card>
              <CardHeader>
                <CardTitle>Pricing Settings</CardTitle>
                <CardDescription>Configure default pricing rules and service charges</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Pricing rules including service charge percentage, rounding preferences, and discount limits can be configured here.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Service Charge (%)</Label>
                    <Input
                      type="number"
                      defaultValue={0}
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Discount (%)</Label>
                    <Input
                      type="number"
                      defaultValue={50}
                      min={0}
                      max={100}
                      step={5}
                      placeholder="50"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                    <div className="space-y-0.5">
                      <Label className="text-base">Round Bill Total</Label>
                      <p className="text-sm text-muted-foreground">
                        Round the final bill to the nearest whole number
                      </p>
                    </div>
                    <Switch defaultChecked={false} />
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                    <div className="space-y-0.5">
                      <Label className="text-base">Happy Hour Pricing</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable automatic discount during configured happy hours
                      </p>
                    </div>
                    <Switch defaultChecked={false} />
                  </div>
                </div>
                <Button>
                  <Save className="h-4 w-4 mr-2" />
                  Save Pricing Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Notification Settings</CardTitle>
                <CardDescription>Configure email and SMS notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <h4 className="font-medium">Email Notifications</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Reservation Confirmation</p>
                        <p className="text-sm text-muted-foreground">Send email when booking is confirmed</p>
                      </div>
                      <Switch
                        checked={notifications.emailBookingConfirmation}
                        onCheckedChange={(checked) => 
                          setNotifications({ ...notifications, emailBookingConfirmation: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Checkout Reminder</p>
                        <p className="text-sm text-muted-foreground">Send reminder before checkout time</p>
                      </div>
                      <Switch
                        checked={notifications.emailCheckoutReminder}
                        onCheckedChange={(checked) => 
                          setNotifications({ ...notifications, emailCheckoutReminder: checked })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-4">
                  <h4 className="font-medium">SMS Notifications</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Reservation Confirmation</p>
                        <p className="text-sm text-muted-foreground">Send SMS when booking is confirmed</p>
                      </div>
                      <Switch
                        checked={notifications.smsBookingConfirmation}
                        onCheckedChange={(checked) => 
                          setNotifications({ ...notifications, smsBookingConfirmation: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Checkout Reminder</p>
                        <p className="text-sm text-muted-foreground">Send SMS reminder before checkout</p>
                      </div>
                      <Switch
                        checked={notifications.smsCheckoutReminder}
                        onCheckedChange={(checked) => 
                          setNotifications({ ...notifications, smsCheckoutReminder: checked })
                        }
                      />
                    </div>
                  </div>
                </div>

                <Button>
                  <Save className="h-4 w-4 mr-2" />
                  Save Notification Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="roles">
            <Card>
              <CardHeader>
                <CardTitle>User Roles & Permissions</CardTitle>
                <CardDescription>Configure staff access levels</CardDescription>
              </CardHeader>
              <CardContent>
                <RolePermissionsEditor />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}