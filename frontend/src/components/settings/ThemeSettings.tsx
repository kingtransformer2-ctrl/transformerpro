import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Loader2 } from "lucide-react";

const themeFormSchema = z.object({
  primary_color: z.string(),
  dark_mode: z.boolean(),
  font_size: z.string(),
});

export function ThemeSettings() {
  const { data: settings, isLoading } = useSettings("theme");
  const updateSetting = useUpdateSetting();

  const form = useForm<z.infer<typeof themeFormSchema>>({
    resolver: zodResolver(themeFormSchema),
    defaultValues: {
      primary_color: "221.2 83.2% 53.3%",
      dark_mode: false,
      font_size: "medium",
    },
  });

  // Apply primary color dynamically
  const applyPrimaryColor = (color: string) => {
    document.documentElement.style.setProperty('--primary', color);
    document.documentElement.style.setProperty('--ring', color);
  };

  // Update form values when data loads
  useEffect(() => {
    if (settings && !isLoading) {
      const settingsMap = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {} as Record<string, any>);

      const primaryColor = settingsMap.primary_color || "221.2 83.2% 53.3%";
      const darkMode = Boolean(settingsMap.dark_mode);

      form.reset({
        primary_color: primaryColor,
        dark_mode: darkMode,
        font_size: settingsMap.font_size || "medium",
      });

      // Apply theme on load
      applyPrimaryColor(primaryColor);
      if (darkMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [settings, isLoading, form]);

  const onSubmit = async (values: z.infer<typeof themeFormSchema>) => {
    for (const [key, value] of Object.entries(values)) {
      await updateSetting.mutateAsync({
        category: "theme",
        key,
        value,
      });
    }

    // Apply theme changes immediately
    applyPrimaryColor(values.primary_color);
    if (values.dark_mode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const presetColors = [
    { name: "Blue", value: "221.2 83.2% 53.3%" },
    { name: "Green", value: "142.1 76.2% 36.3%" },
    { name: "Purple", value: "262.1 83.3% 57.8%" },
    { name: "Red", value: "346.8 77.2% 49.8%" },
    { name: "Orange", value: "24.6 95% 53.1%" },
    { name: "Gold", value: "45 100% 51%" },
    { name: "Pink", value: "330.4 81.2% 60.4%" },
  ];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="primary_color"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Primary Color</FormLabel>
              <FormControl>
                <div className="space-y-4">
                  <Input
                    placeholder="221.2 83.2% 53.3%"
                    {...field}
                  />
                  <div className="flex gap-2 flex-wrap">
                    {presetColors.map((color) => (
                      <Button
                        key={color.name}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          field.onChange(color.value);
                          applyPrimaryColor(color.value);
                        }}
                        style={{ backgroundColor: `hsl(${color.value})`, color: "white" }}
                      >
                        {color.name}
                      </Button>
                    ))}
                  </div>
                </div>
              </FormControl>
              <FormDescription>
                Primary color in HSL format (e.g., 221.2 83.2% 53.3%)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="dark_mode"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Dark Mode</FormLabel>
                <FormDescription>
                  Enable dark theme by default
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
          name="font_size"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Font Size</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select font size" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                  <SelectItem value="extra-large">Extra Large</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                Default font size for the application
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={updateSetting.isPending}>
          {updateSetting.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Theme Settings
        </Button>
      </form>
    </Form>
  );
}