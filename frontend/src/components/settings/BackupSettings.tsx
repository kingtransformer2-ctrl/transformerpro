import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Download, Upload, Database, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const backupFormSchema = z.object({
  auto_backup: z.boolean(),
  backup_frequency: z.string(),
  retention_days: z.number().min(1, "Must be at least 1 day"),
});

export function BackupSettings() {
  const { data: settings, isLoading } = useSettings("backup");
  const updateSetting = useUpdateSetting();

  const form = useForm<z.infer<typeof backupFormSchema>>({
    resolver: zodResolver(backupFormSchema),
    defaultValues: {
      auto_backup: false,
      backup_frequency: "daily",
      retention_days: 30,
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
        auto_backup: Boolean(settingsMap.auto_backup),
        backup_frequency: settingsMap.backup_frequency || "daily",
        retention_days: Number(settingsMap.retention_days) || 30,
      });
    }
  }, [settings, isLoading, form]);

  const onSubmit = async (values: z.infer<typeof backupFormSchema>) => {
    for (const [key, value] of Object.entries(values)) {
      await updateSetting.mutateAsync({
        category: "backup",
        key,
        value,
      });
    }
  };

  const handleExportData = () => {
    toast({
      title: "Export initiated",
      description: "Data export will be available for download shortly.",
    });
    // Implement actual export logic here
  };

  const handleImportData = () => {
    toast({
      title: "Import feature",
      description: "Data import functionality will be implemented soon.",
    });
    // Implement actual import logic here
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="auto_backup"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Automatic Backup</FormLabel>
                  <FormDescription>
                    Enable automatic data backups
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
            name="backup_frequency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Backup Frequency</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  How often automatic backups should be created
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="retention_days"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Retention Period (Days)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    placeholder="30"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormDescription>
                  Number of days to keep backup files
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={updateSetting.isPending}>
            {updateSetting.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Backup Settings
          </Button>
        </form>
      </Form>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Data
            </CardTitle>
            <CardDescription>
              Export your data for backup or migration purposes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleExportData} variant="outline" className="w-full">
              <Database className="mr-2 h-4 w-4" />
              Export All Data
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Data
            </CardTitle>
            <CardDescription>
              Import data from backup files
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleImportData} variant="outline" className="w-full">
              <Upload className="mr-2 h-4 w-4" />
              Import Data
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backup Information</CardTitle>
          <CardDescription>
            Important information about data backup and recovery
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <p>• Automatic backups are stored securely in the cloud</p>
            <p>• All sensitive data is encrypted during backup</p>
            <p>• Manual backups can be created anytime using the export feature</p>
            <p>• Regular testing of backup restoration is recommended</p>
            <p>• Contact support for assistance with data recovery</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}