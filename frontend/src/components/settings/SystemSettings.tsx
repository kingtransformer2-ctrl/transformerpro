import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { 
  useCompanyProfile, 
  useUpdateCompanyProfile, 
  useDeleteCompanyProfile,
  useSettings, 
  useUpdateSetting 
} from "@/hooks/useSettings";
import { useHotelInfo, useUpdateHotelInfo } from "@/hooks/useHotel";
import { Separator } from "@/components/ui/separator";
import { Loader2, Trash2, RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const systemFormSchema = z.object({
  currency: z.string().min(1, "Currency is required"),
  timezone: z.string().min(1, "Timezone is required"),
  date_format: z.string().min(1, "Date format is required"),
  language: z.string().min(1, "Language is required"),
});

const companyFormSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  tax_number: z.string().optional(),
  tin_number: z.string().optional(),
});

const hotelTaxFormSchema = z.object({
  tax_rate: z.number().min(0).max(100),
  tax_inclusive: z.boolean(),
});

export function SystemSettings() {
  const { data: settings, isLoading: settingsLoading } = useSettings("system");
  const { data: companyProfile, isLoading: companyLoading } = useCompanyProfile();
  const { data: hotelInfo } = useHotelInfo();
  
  const updateSetting = useUpdateSetting();
  const updateCompanyProfile = useUpdateCompanyProfile();
  const deleteCompanyProfile = useDeleteCompanyProfile();
  const updateHotelInfo = useUpdateHotelInfo();

  const [isSyncing, setIsSyncing] = useState(false);

  const systemForm = useForm<z.infer<typeof systemFormSchema>>({
    resolver: zodResolver(systemFormSchema),
    defaultValues: {
      currency: "RWF",
      timezone: "Africa/Kigali",
      date_format: "DD/MM/YYYY",
      language: "en",
    },
  });

  const companyForm = useForm<z.infer<typeof companyFormSchema>>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: {
      company_name: "",
      address: "",
      phone: "",
      email: "",
      tax_number: "",
      tin_number: "",
    },
  });

  const hotelTaxForm = useForm<z.infer<typeof hotelTaxFormSchema>>({
    resolver: zodResolver(hotelTaxFormSchema),
    defaultValues: {
      tax_rate: 18,
      tax_inclusive: false,
    },
  });

  // Update form values when data loads
  useEffect(() => {
    if (settings && !settingsLoading) {
      const settingsMap = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {} as Record<string, any>);

      systemForm.reset({
        currency: settingsMap.currency || "RWF",
        timezone: settingsMap.timezone || "Africa/Kigali",
        date_format: settingsMap.date_format || "DD/MM/YYYY",
        language: settingsMap.language || "en",
      });
    }
  }, [settings, settingsLoading, systemForm]);

  useEffect(() => {
    if (companyProfile && !companyLoading) {
      companyForm.reset({
        company_name: companyProfile.company_name || "",
        address: companyProfile.address || "",
        phone: companyProfile.phone || "",
        email: companyProfile.email || "",
        tax_number: companyProfile.tax_number || "",
        tin_number: companyProfile.tin_number || "",
      });
    }
  }, [companyProfile, companyLoading, companyForm]);

  useEffect(() => {
    if (hotelInfo) {
      hotelTaxForm.reset({
        tax_rate: hotelInfo.tax_rate ?? 18,
        tax_inclusive: hotelInfo.tax_inclusive ?? false,
      });
    }
  }, [hotelInfo, hotelTaxForm]);

  const onSystemSubmit = async (values: z.infer<typeof systemFormSchema>) => {
    try {
      for (const [key, value] of Object.entries(values)) {
        await updateSetting.mutateAsync({
          category: "system",
          key,
          value,
        });
      }
      toast.success("System settings updated successfully");
    } catch (error) {
      console.error("Error updating system settings:", error);
      toast.error("Failed to update system settings");
    }
  };

  const onCompanySubmit = async (values: z.infer<typeof companyFormSchema>) => {
    try {
      // Sync tin_number to tax_number for compatibility
      const submissionValues = {
        ...values,
        tax_number: values.tin_number
      };
      await updateCompanyProfile.mutateAsync(submissionValues);
      toast.success("Company profile updated successfully");
    } catch (error) {
      console.error("Error updating company profile:", error);
      toast.error("Failed to update company profile");
    }
  };

  const onHotelTaxSubmit = async (values: z.infer<typeof hotelTaxFormSchema>) => {
    try {
      if (!hotelInfo?.id) {
        toast.error("Restaurant information not found");
        return;
      }
      await updateHotelInfo.mutateAsync({
        id: hotelInfo.id,
        tax_rate: values.tax_rate,
        tax_inclusive: values.tax_inclusive,
      });
      toast.success("Tax settings updated successfully");
    } catch (error) {
      console.error("Error updating tax settings:", error);
      toast.error("Failed to update tax settings");
    }
  };

  const handleDeleteProfile = async () => {
    if (companyProfile?.id) {
      try {
        await deleteCompanyProfile.mutateAsync(companyProfile.id);
        companyForm.reset({
          company_name: "",
          address: "",
          phone: "",
          email: "",
          tax_number: "",
          tin_number: "",
        });
      } catch (error) {
        console.error("Error deleting profile:", error);
      }
    }
  };

  const handleSyncToHotel = async () => {
    if (!hotelInfo?.id) {
      toast.error("Hotel information record not found to sync");
      return;
    }

    const values = companyForm.getValues();
    setIsSyncing(true);
    try {
      await updateHotelInfo.mutateAsync({
        id: hotelInfo.id,
        name: values.company_name,
        address: values.address,
        phone: values.phone,
        email: values.email,
        tax_number: values.tin_number,
        tin_number: values.tin_number,
      });
      toast.success("Synced details to Restaurant");
    } catch (error) {
      toast.error("Failed to sync details");
    } finally {
      setIsSyncing(false);
    }
  };

  if (settingsLoading || companyLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-lg font-bold uppercase tracking-widest text-primary">Company Information</h3>
          <p className="text-sm text-muted-foreground">
            Manage your system identity and contact details
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button 
            variant="outline" 
            size="sm" 
            className="flex-1 sm:flex-none gap-2 font-bold text-[10px] uppercase tracking-tighter"
            onClick={handleSyncToHotel}
            disabled={isSyncing}
          >
            {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
            Sync to Restaurant
          </Button>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="destructive" 
                size="sm" 
                className="flex-1 sm:flex-none gap-2 font-bold text-[10px] uppercase tracking-tighter"
                disabled={!companyProfile}
              >
                <Trash2 className="h-3 w-3" />
                Reset Profile
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all company information including name, address, and TIN. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteProfile} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete Profile
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Form {...companyForm}>
        <form onSubmit={companyForm.handleSubmit(onCompanySubmit)} className="space-y-4">
          <FormField
            control={companyForm.control}
            name="company_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-black uppercase text-[10px] tracking-widest">System / Company Name</FormLabel>
                <FormControl>
                  <Input placeholder="Enter company name" className="font-bold" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={companyForm.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-black uppercase text-[10px] tracking-widest">Physical Address</FormLabel>
                <FormControl>
                  <Textarea placeholder="Enter company address" className="font-medium" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={companyForm.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-black uppercase text-[10px] tracking-widest">Contact Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter phone number" className="font-bold" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={companyForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-black uppercase text-[10px] tracking-widest">Support Email</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter email address" className="font-bold" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={companyForm.control}
            name="tin_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-black uppercase text-[10px] tracking-widest">TIN Number</FormLabel>
                <FormControl>
                  <Input placeholder="Enter TIN number" className="font-mono font-bold" {...field} />
                </FormControl>
                <FormDescription className="text-[9px] uppercase font-bold text-slate-400">
                  This will be displayed on all printed receipts and invoices
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={updateCompanyProfile.isPending} className="w-full sm:w-auto gap-2 font-black uppercase tracking-widest text-xs">
              {updateCompanyProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Update System Profile
            </Button>
          </div>
        </form>
      </Form>

      <Separator className="my-8" />

      <div>
        <h3 className="text-lg font-bold uppercase tracking-widest text-primary">Tax Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure VAT and tax calculation rules
        </p>
      </div>

      <Form {...hotelTaxForm}>
        <form onSubmit={hotelTaxForm.handleSubmit(onHotelTaxSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={hotelTaxForm.control}
              name="tax_rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-black uppercase text-[10px] tracking-widest">VAT Rate (%)</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      min="0" 
                      max="100" 
                      step="0.01" 
                      placeholder="18" 
                      className="font-bold"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={hotelTaxForm.control}
              name="tax_inclusive"
              render={({ field }) => (
                <FormItem className="flex flex-col justify-end pb-2">
                  <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="font-black uppercase text-[10px] tracking-widest">Tax Inclusive Pricing</FormLabel>
                      <FormDescription className="text-[9px]">
                        If enabled, prices include tax (not recommended for Rwanda VAT)
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={updateHotelInfo.isPending} className="w-full sm:w-auto gap-2 font-black uppercase tracking-widest text-xs">
              {updateHotelInfo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Tax Settings
            </Button>
          </div>
        </form>
      </Form>

      <Separator className="my-8" />

      <div>
        <h3 className="text-lg font-bold uppercase tracking-widest text-slate-900">System Configuration</h3>
        <p className="text-sm text-muted-foreground">
          Regional settings and base system preferences
        </p>
      </div>

      <Form {...systemForm}>
        <form onSubmit={systemForm.handleSubmit(onSystemSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={systemForm.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-black uppercase text-[10px] tracking-widest">Base Currency</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-bold">
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="RWF" className="font-bold">RWF - Rwandan Franc</SelectItem>
                      <SelectItem value="USD" className="font-bold">USD - US Dollar</SelectItem>
                      <SelectItem value="EUR" className="font-bold">EUR - Euro</SelectItem>
                      <SelectItem value="GBP" className="font-bold">GBP - British Pound</SelectItem>
                      <SelectItem value="INR" className="font-bold">INR - Indian Rupee</SelectItem>
                      <SelectItem value="CAD" className="font-bold">CAD - Canadian Dollar</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={systemForm.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-black uppercase text-[10px] tracking-widest">System Timezone</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-bold">
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Africa/Kigali" className="font-bold">Africa/Kigali</SelectItem>
                      <SelectItem value="UTC" className="font-bold">UTC (Universal Time)</SelectItem>
                      <SelectItem value="Europe/London" className="font-bold">Europe/London</SelectItem>
                      <SelectItem value="America/New_York" className="font-bold">America/New_York</SelectItem>
                      <SelectItem value="Asia/Dubai" className="font-bold">Asia/Dubai</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={systemForm.control}
              name="date_format"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-black uppercase text-[10px] tracking-widest">Date Display Format</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-bold">
                        <SelectValue placeholder="Select date format" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="DD/MM/YYYY" className="font-mono font-bold">DD/MM/YYYY</SelectItem>
                      <SelectItem value="MM/DD/YYYY" className="font-mono font-bold">MM/DD/YYYY</SelectItem>
                      <SelectItem value="YYYY-MM-DD" className="font-mono font-bold">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={systemForm.control}
              name="language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-black uppercase text-[10px] tracking-widest">System Language</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-bold">
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="en" className="font-bold">English</SelectItem>
                      <SelectItem value="fr" className="font-bold">Français</SelectItem>
                      <SelectItem value="rw" className="font-bold">Kinyarwanda</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={updateSetting.isPending} className="w-full sm:w-auto gap-2 font-black uppercase tracking-widest text-xs">
              {updateSetting.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Configuration
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}