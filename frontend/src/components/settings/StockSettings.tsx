import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const stockFormSchema = z.object({
  low_stock_threshold: z.number().min(1, "Threshold must be at least 1"),
  enable_expiry_alerts: z.boolean(),
  expiry_alert_days: z.number().min(1, "Must be at least 1 day"),
  auto_calculate_stock: z.boolean(),
});

export function StockSettings() {
  const { data: settings, isLoading } = useSettings("stock");
  const updateSetting = useUpdateSetting();

  const form = useForm<z.infer<typeof stockFormSchema>>({
    resolver: zodResolver(stockFormSchema),
    defaultValues: {
      low_stock_threshold: 10,
      enable_expiry_alerts: true,
      expiry_alert_days: 30,
      auto_calculate_stock: true,
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
        low_stock_threshold: Number(settingsMap.low_stock_threshold) || 10,
        enable_expiry_alerts: Boolean(settingsMap.enable_expiry_alerts),
        expiry_alert_days: Number(settingsMap.expiry_alert_days) || 30,
        auto_calculate_stock: Boolean(settingsMap.auto_calculate_stock),
      });
    }
  }, [settings, isLoading, form]);

  const onSubmit = async (values: z.infer<typeof stockFormSchema>) => {
    for (const [key, value] of Object.entries(values)) {
      await updateSetting.mutateAsync({
        category: "stock",
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
          name="low_stock_threshold"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Low Stock Threshold</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="10"
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Default minimum stock quantity before showing low stock warnings
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="auto_calculate_stock"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Auto Calculate Stock</FormLabel>
                <FormDescription>
                  Automatically calculate total stock from product batches
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
                <FormLabel className="text-base">Enable Expiry Alerts</FormLabel>
                <FormDescription>
                  Show alerts for products approaching expiry date
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
          name="expiry_alert_days"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Expiry Alert Days</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="30"
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Number of days before expiry to show alerts
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={updateSetting.isPending}>
          {updateSetting.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Stock Settings
        </Button>
      </form>
    </Form>
  );
}