import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  getPaperSettings,
  INVOICE_STYLE_OPTIONS,
  normalizeInvoiceStyle,
  normalizePaperSize,
  normalizeReceiptStyle,
  PAPER_SIZE_OPTIONS,
  RECEIPT_STYLE_OPTIONS,
} from "@/utils/paperSettings";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const receiptFormSchema = z.object({
  header_text: z.string(),
  footer_text: z.string(),
  show_logo: z.boolean(),
  paper_size: z.string(),
  receipt_style: z.string(),
  invoice_style: z.string(),
  show_qr: z.boolean(),
  show_company_contact: z.boolean(),
  show_customer_details: z.boolean(),
  show_payment_details: z.boolean(),
});

export function ReceiptSettings() {
  const { data: settings, isLoading } = useSettings("receipt");
  const updateSetting = useUpdateSetting();

  const form = useForm<z.infer<typeof receiptFormSchema>>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: {
      header_text: "Thank you for your purchase!",
      footer_text: "Visit us again!",
      show_logo: true,
      paper_size: "50mm",
      receipt_style: "classic",
      invoice_style: "formal",
      show_qr: true,
      show_company_contact: true,
      show_customer_details: true,
      show_payment_details: true,
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
        header_text: settingsMap.header_text || "Thank you for your purchase!",
        footer_text: settingsMap.footer_text || "Visit us again!",
        show_logo: Boolean(settingsMap.show_logo),
        paper_size: normalizePaperSize(settingsMap.paper_size),
        receipt_style: normalizeReceiptStyle(settingsMap.receipt_style),
        invoice_style: normalizeInvoiceStyle(settingsMap.invoice_style),
        show_qr: settingsMap.show_qr !== undefined ? Boolean(settingsMap.show_qr) : true,
        show_company_contact: settingsMap.show_company_contact !== undefined ? Boolean(settingsMap.show_company_contact) : true,
        show_customer_details: settingsMap.show_customer_details !== undefined ? Boolean(settingsMap.show_customer_details) : true,
        show_payment_details: settingsMap.show_payment_details !== undefined ? Boolean(settingsMap.show_payment_details) : true,
      });
    }
  }, [settings, isLoading, form]);

  const previewValues = form.watch();
  const previewPaper = getPaperSettings(normalizePaperSize(previewValues.paper_size));
  const previewReceiptStyle = normalizeReceiptStyle(previewValues.receipt_style);
  const previewInvoiceStyle = normalizeInvoiceStyle(previewValues.invoice_style);
  const previewWidth =
    previewPaper.id === "50mm"
      ? 190
      : previewPaper.id === "58mm"
        ? 215
        : previewPaper.id === "80mm"
          ? 285
          : previewPaper.id === "110mm"
            ? 385
            : 430;
  const previewHeader = previewValues.header_text || "Sales Receipt";
  const previewFooter = previewValues.footer_text || "Thank you for your business!";
  const previewReceiptModern = previewReceiptStyle === "modern";
  const previewInvoiceModern = previewInvoiceStyle === "modern";
  const previewShowQr = Boolean(previewValues.show_qr);
  const previewShowCompanyContact = Boolean(previewValues.show_company_contact);
  const previewShowCustomerDetails = Boolean(previewValues.show_customer_details);
  const previewShowPaymentDetails = Boolean(previewValues.show_payment_details);

  const handleTestPrint = () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Test</title>
          <style>
            @media print {
              @page { margin: 0; size: ${previewPaper.size}; }
              body { margin: 0; padding: 0; }
            }
            * { box-sizing: border-box; }
            body {
              font-family: 'Segoe UI', Arial, sans-serif;
              background: #fff;
              color: #000;
              padding: ${previewPaper.pagePadding};
            }
            .page {
              width: min(100%, ${previewPaper.width});
              margin: 0 auto;
            }
            .doc {
              border: ${previewReceiptModern ? '1px' : '2px'} solid #000;
              border-radius: ${previewReceiptModern ? '16px' : '10px'};
              padding: ${previewPaper.shellPadding};
              background: ${previewReceiptModern ? '#fcfcfc' : '#fff'};
            }
            .center { text-align: center; }
            .title {
              font-size: ${previewPaper.titleFontSize};
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            .muted { font-size: 10px; font-weight: 600; }
            .label {
              display: inline-block;
              margin-top: 8px;
              padding: 4px 12px;
              border: 2px solid #000;
              border-radius: ${previewReceiptModern ? '999px' : '4px'};
              background: ${previewReceiptModern ? '#000' : '#fff'};
              color: ${previewReceiptModern ? '#fff' : '#000'};
              font-size: ${previewPaper.sectionLabelSize};
              font-weight: 900;
              text-transform: uppercase;
            }
            .line { border-top: 1px dashed #000; margin: 10px 0; }
            .box {
              border: 1px solid #000;
              border-radius: ${previewReceiptModern ? '12px' : '8px'};
              background: ${previewReceiptModern ? '#f5f5f5' : '#fff'};
              padding: 8px;
              margin-top: 10px;
            }
            .row {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              margin: 4px 0;
              font-size: 12px;
            }
            .row span:last-child {
              text-align: right;
              font-weight: 700;
            }
            .qr {
              width: 92px;
              height: 92px;
              border: 1px dashed #000;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              margin-top: 12px;
              font-size: 11px;
              font-weight: 800;
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="doc">
              <div class="center">
                <div class="title">Gorilla Trekking</div>
                ${previewShowCompanyContact ? `
                  <div class="muted">Musanze, Rwanda</div>
                  <div class="muted">+250 700 000 000</div>
                  <div class="muted">TIN: 123456789</div>
                ` : ''}
                <div class="label">${previewHeader}</div>
              </div>
              <div class="line"></div>
              ${previewShowCustomerDetails ? `
                <div class="box">
                  <div class="row"><span>Customer</span><span>Walk-in Customer</span></div>
                  <div class="row"><span>Date</span><span>06/06/2026 12:00</span></div>
                </div>
              ` : ''}
              <div class="box">
                <div class="row"><span>Tea</span><span>RF 2,500</span></div>
                <div class="row"><span>Lunch</span><span>RF 12,000</span></div>
              </div>
              ${previewShowPaymentDetails ? `
                <div class="box">
                  <div class="row"><span>Subtotal</span><span>RF 14,500</span></div>
                  <div class="row"><span>Tax</span><span>RF 2,610</span></div>
                  <div class="row"><span>Total</span><span>RF 17,110</span></div>
                  <div class="row"><span>Payment</span><span>Cash</span></div>
                </div>
              ` : ''}
              <div class="center">
                ${previewShowQr ? `<div class="qr">TEST QR</div>` : ''}
                <div style="margin-top: 12px; font-size: 11px; font-weight: 800;">${previewFooter}</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Unable to open print preview window");
      return;
    }

    printWindow.document.write(sampleHtml);
    printWindow.document.close();
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 250);
    };
  };

  const onSubmit = async (values: z.infer<typeof receiptFormSchema>) => {
    try {
      for (const [key, value] of Object.entries(values)) {
        await updateSetting.mutateAsync({
          category: "receipt",
          key,
          value,
        });
      }
      toast.success("Receipt settings updated successfully");
    } catch (error) {
      console.error("Error updating receipt settings:", error);
      toast.error("Failed to update receipt settings");
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
          name="header_text"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Receipt Header Text</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Thank you for your purchase!"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Text displayed at the top of the receipt
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="footer_text"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Receipt Footer Text</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Visit us again!"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Text displayed at the bottom of the receipt
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="show_logo"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Show Company Logo</FormLabel>
                <FormDescription>
                  Display company logo on printed receipts
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

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="show_qr"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Show QR Code</FormLabel>
                  <FormDescription>
                    Include QR code blocks on supported receipts and invoices.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="show_company_contact"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Show Company Contact</FormLabel>
                  <FormDescription>
                    Show address, phone, email, and tax contact details.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="show_customer_details"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Show Customer Details</FormLabel>
                  <FormDescription>
                    Show guest or customer details on printed documents.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="show_payment_details"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Show Payment Details</FormLabel>
                  <FormDescription>
                    Show payment method, paid amounts, and totals breakdown blocks.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="paper_size"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Paper Size</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select paper size" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {PAPER_SIZE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Choose the print layout that matches your receipt printer or office paper.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="receipt_style"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Receipt Style</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select receipt style" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {RECEIPT_STYLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Choose how sales and POS receipts should look when printed.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="invoice_style"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Invoice Style</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select invoice style" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {INVOICE_STYLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Choose how invoices, statements, and printable order documents should look.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Card>
          <CardHeader>
            <CardTitle>Print Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-sm text-muted-foreground">
              Preview width follows the selected paper size, and the sample styles follow your current choices.
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-3">
                <div className="text-sm font-medium">Receipt Preview</div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div
                    className={`mx-auto overflow-hidden bg-white text-black shadow-sm ${previewReceiptModern ? "rounded-2xl border border-slate-300" : "rounded-lg border-2 border-black"}`}
                    style={{ width: "100%", maxWidth: `${previewWidth}px`, padding: previewPaper.id === "A4" ? "18px" : previewPaper.isCompact ? "10px" : "14px" }}
                  >
                    <div className="text-center">
                      <div className={`font-black uppercase tracking-[0.2em] ${previewPaper.id === "A4" ? "text-xl" : previewPaper.isCompact ? "text-sm" : "text-base"}`}>
                        Gorilla Trekking
                      </div>
                      {previewShowCompanyContact ? (
                        <div className="mt-1 text-xs font-medium text-slate-600">Musanze, Rwanda</div>
                      ) : null}
                      <div
                        className={`mt-3 inline-block max-w-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] ${
                          previewReceiptModern
                            ? "rounded-full bg-black text-white"
                            : "rounded-md border-2 border-black text-black"
                        }`}
                      >
                        {previewHeader}
                      </div>
                    </div>

                    <div className="my-3 border-t border-dashed border-black" />

                    {previewShowCustomerDetails ? (
                      <div className="space-y-2">
                        {[
                          ["Receipt No", "POS-20481"],
                          ["Customer", "Walk-in Customer"],
                          ["Date", "06/06/2026 11:48"],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-start justify-between gap-3 text-xs">
                            <span className="font-bold uppercase">{label}</span>
                            <span className="max-w-[60%] text-right font-semibold">{value}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className={`mt-4 space-y-2 rounded-lg p-3 ${previewReceiptModern ? "border border-slate-200 bg-slate-50" : "border border-black bg-white"}`}>
                      {[
                        ["Coffee", "2 x RF 2,500", "RF 5,000"],
                        ["Buffet Lunch", "1 x RF 12,000", "RF 12,000"],
                      ].map(([name, meta, total]) => (
                        <div key={name} className="flex items-start justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <div className="font-black uppercase">{name}</div>
                            <div className="text-slate-600">{meta}</div>
                          </div>
                          <div className="whitespace-nowrap font-bold">{total}</div>
                        </div>
                      ))}
                    </div>

                    {previewShowPaymentDetails ? (
                      <div className={`mt-4 space-y-2 rounded-lg p-3 text-xs ${previewReceiptModern ? "border border-slate-200 bg-slate-50" : "border border-black bg-white"}`}>
                        <div className="flex justify-between gap-3">
                          <span className="font-bold uppercase">Subtotal</span>
                          <span>RF 17,000</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="font-bold uppercase">Tax</span>
                          <span>RF 3,060</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="font-bold uppercase">Payment</span>
                          <span>Cash</span>
                        </div>
                        <div className="border-t border-dashed border-black pt-2 text-sm font-black">
                          <div className="flex justify-between gap-3">
                            <span className="uppercase">Total</span>
                            <span>RF 20,060</span>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 text-center text-[11px] font-semibold uppercase tracking-[0.08em]">
                      {previewFooter}
                    </div>
                    {previewShowQr ? (
                      <div className="mt-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        QR Enabled
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">Invoice Preview</div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div
                    className={`mx-auto overflow-hidden rounded-xl border bg-white text-black shadow-sm ${
                      previewInvoiceModern ? "border-slate-200" : "border-slate-400"
                    }`}
                    style={{ width: "100%", maxWidth: `${Math.max(previewWidth, 320)}px` }}
                  >
                    <div className={`p-4 text-white ${previewInvoiceModern ? "bg-blue-700" : "bg-slate-800"}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-lg font-black uppercase tracking-[0.14em]">Gorilla Trekking</div>
                          <div className="mt-1 text-xs text-white/80">Tax Invoice</div>
                          {previewShowCompanyContact ? (
                            <div className="mt-1 text-[11px] text-white/80">Musanze District, +250 700 000 000</div>
                          ) : null}
                        </div>
                        <div className="text-right text-xs">
                          <div className="font-bold">INV-3091</div>
                          <div>06/06/2026</div>
                        </div>
                      </div>
                    </div>

                    {previewShowCustomerDetails || previewShowCompanyContact ? (
                      <div className="grid gap-4 p-4 text-xs md:grid-cols-2">
                        {previewShowCustomerDetails ? (
                          <div>
                            <div className="mb-1 font-bold uppercase text-slate-500">Bill To</div>
                            <div className="font-semibold">Mountain Guest Ltd</div>
                            <div className="text-slate-600">TIN: 123456789</div>
                            <div className="text-slate-600">Kigali, Rwanda</div>
                          </div>
                        ) : <div />}
                        {previewShowCompanyContact ? (
                          <div>
                            <div className="mb-1 font-bold uppercase text-slate-500">From</div>
                            <div className="font-semibold">Gorilla Trekking</div>
                            <div className="text-slate-600">Musanze District</div>
                            <div className="text-slate-600">+250 700 000 000</div>
                          </div>
                        ) : <div />}
                      </div>
                    ) : null}

                    <div className="px-4 pb-4">
                      <div className={`rounded-lg border text-xs ${previewInvoiceModern ? "border-slate-200 bg-slate-50" : "border-slate-300 bg-white"}`}>
                        <div className="grid grid-cols-[1.7fr_0.7fr_0.9fr] gap-3 border-b px-3 py-2 font-bold uppercase text-slate-500">
                          <span>Item</span>
                          <span className="text-center">Qty</span>
                          <span className="text-right">Total</span>
                        </div>
                        <div className="grid grid-cols-[1.7fr_0.7fr_0.9fr] gap-3 px-3 py-2">
                          <span>Room Service Dinner</span>
                          <span className="text-center">2</span>
                          <span className="text-right">RF 18,000</span>
                        </div>
                        <div className="grid grid-cols-[1.7fr_0.7fr_0.9fr] gap-3 border-t px-3 py-2">
                          <span>Airport Transfer</span>
                          <span className="text-center">1</span>
                          <span className="text-right">RF 25,000</span>
                        </div>
                      </div>

                      <div className={`mt-4 rounded-lg p-3 text-xs ${previewInvoiceModern ? "border border-slate-200 bg-slate-50" : "border border-slate-300 bg-white"}`}>
                        <div className="flex justify-between gap-3">
                          <span className="font-bold uppercase">Subtotal</span>
                          <span>RF 43,000</span>
                        </div>
                        {previewShowPaymentDetails ? (
                          <div className="mt-2 flex justify-between gap-3">
                            <span className="font-bold uppercase">VAT 18%</span>
                            <span>RF 7,740</span>
                          </div>
                        ) : null}
                        <div className="mt-3 border-t pt-3 text-sm font-black">
                          <div className="flex justify-between gap-3">
                            <span className="uppercase">Grand Total</span>
                            <span>RF 50,740</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={updateSetting.isPending}>
            {updateSetting.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Receipt Settings
          </Button>
          <Button type="button" variant="outline" onClick={handleTestPrint}>
            Print Test Page
          </Button>
        </div>
      </form>
    </Form>
  );
}
