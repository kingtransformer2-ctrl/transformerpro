import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Loader2 } from "lucide-react";

const notificationFormSchema = z.object({
  enable_email: z.boolean(),
  enable_low_stock_alerts: z.boolean(),
  enable_expiry_alerts: z.boolean(),
});

export function NotificationSettings() {
  const { data: settings, isLoading } = useSettings("notifications");
  const updateSetting = useUpdateSetting();

  const form = useForm<z.infer<typeof notificationFormSchema>>({
    resolver: zodResolver(notificationFormSchema),
    defaultValues: {
      enable_email: false,
      enable_low_stock_alerts: true,
      enable_expiry_alerts: true,
    },
  });

  // Update form values when data loads
  useEffect(() => {
    if (settings && !isLoading) {
      const settingsMap = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {} as Record<string, any>);

      form.reset({
        enable_email: Boolean(settingsMap.enable_email),
        enable_low_stock_alerts: Boolean(settingsMap.enable_low_stock_alerts),
        enable_expiry_alerts: Boolean(settingsMap.enable_expiry_alerts),
      });
    }
  }, [settings, isLoading, form]);

  const onSubmit = async (values: z.infer<typeof notificationFormSchema>) => {
    for (const [key, value] of Object.entries(values)) {
      await updateSetting.mutateAsync({
        category: "notifications",
        key,
        value,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="enable_email"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Email Notifications</FormLabel>
                <FormDescription>
                  Send important alerts via email
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="enable_low_stock_alerts"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Low Stock Alerts</FormLabel>
                <FormDescription>
                  Show notifications when products are running low
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="enable_expiry_alerts"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Expiry Alerts</FormLabel>
                <FormDescription>
                  Show notifications for products approaching expiry
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <Button type="submit" disabled={updateSetting.isPending}>
          {updateSetting.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Notification Settings
        </Button>
      </form>
    </Form>
  );
}