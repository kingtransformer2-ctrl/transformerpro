import { useMemo, useState, type ElementType, type InputHTMLAttributes, type ReactNode } from "react";
import { format, isWithinInterval, parseISO, startOfMonth } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Calculator,
  Download,
  Building2,
  FileText,
  HandCoins,
  Hammer,
  Loader2,
  MoreHorizontal,
  Pencil,
  PieChart,
  Plus,
  Receipt,
  ShieldAlert,
  Smartphone,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  Banknote,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/layout/Layout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import {
  type Damage,
  type Expense,
  type FinancialReport,
  type LoanMutationInput,
  type SalaryMutationInput,
  type StaffLoan,
  type StaffPayment,
  useAddExpense,
  useDamages,
  useDeleteDamage,
  useDeleteExpense,
  useDeleteLoan,
  useDeleteSalary,
  useExpenseCategories,
  useExpenses,
  useFinancialReport,
  useIssueLoan,
  useProcessSalary,
  useReportDamage,
  useStaffLoans,
  useStaffPayments,
  useUpdateDamage,
  useUpdateExpense,
  useUpdateLoan,
  useUpdateSalary,
} from "@/hooks/useFinancials";
import { useHotelPayments, useHotelStaff } from "@/hooks/useHotel";
import { cn } from "@/lib/utils";
import { useActiveStaffShift } from "@/hooks/useHotelShifts";
import { filterPaymentsByDateRange, formatHotelPaymentMethod, getMethodTotal } from "@/lib/hotelPayments";

/**
 * Visual language: "ledger & brass" — a nod to the bound account book every
 * hotel back-office keeps. Warm ruled paper, dotted leader lines on the
 * balance sheet (the way accountants line up figures by hand), dashed
 * perforations on the summary tickets, and a brass hairline in place of the
 * usual flat accent bar. Nothing here changes behaviour — only appearance.
 */

const LBL = "text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/65";
const LEDGER_BG = {
  backgroundImage:
    "repeating-linear-gradient(to bottom, transparent, transparent 34px, hsl(var(--foreground) / 0.032) 34px, hsl(var(--foreground) / 0.032) 35px)",
};

type ExpenseFormState = {
  id?: string;
  category_id: string;
  amount: string;
  description: string;
  payment_method: string;
  expense_date: string;
  reference_number: string;
  staff_id: string;
};

type LoanFormState = {
  id?: string;
  staff_id: string;
  total_amount: string;
  monthly_deduction: string;
  reason: string;
  issued_date: string;
  status: StaffLoan["status"];
  current_total_amount?: number;
  current_balance_amount?: number;
};

type SalaryFormState = {
  id?: string;
  staff_id: string;
  base_salary: string;
  bonus_amount: string;
  loan_deduction: string;
  other_deductions: string;
  payment_month: string;
  payment_date: string;
  payment_method: string;
  status: StaffPayment["status"];
  notes: string;
};

type DamageFormState = {
  id?: string;
  item_name: string;
  damage_cost: string;
  location: string;
  charged_to_staff_id: string;
  description: string;
  status: Damage["status"];
  reported_at: string;
};

type DeleteState =
  | { type: "expense"; record: Expense }
  | { type: "loan"; record: StaffLoan }
  | { type: "payroll"; record: StaffPayment }
  | { type: "damage"; record: Damage }
  | null;

function AccentStripe() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 overflow-hidden rounded-t-2xl">
      <div className="h-[3px] w-full bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
      <div className="h-px w-full bg-gradient-to-r from-amber-500/0 via-amber-500/70 to-amber-500/0" />
    </div>
  );
}

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <Label className={LBL}>
      {children}
      {required && <span className="ml-0.5 text-amber-600 dark:text-amber-400">*</span>}
    </Label>
  );
}

function Field({
  id,
  label,
  required,
  ...props
}: { id: string; label: string; required?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <FieldLabel required={required}>{label}</FieldLabel>
      <Input
        id={id}
        className="h-9 rounded-xl border-border/60 bg-background/60 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:ring-primary/40"
        {...props}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  variant = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ElementType;
  variant?: "default" | "danger" | "success" | "purple";
}) {
  const themes = {
    default: {
      wrap: "border-border/60",
      icon: "bg-muted/60 text-muted-foreground ring-1 ring-border/40",
      value: "text-foreground",
      glow: "group-hover:from-foreground/[0.04]",
    },
    danger: {
      wrap: "border-rose-200/70 dark:border-rose-900/40",
      icon: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/70 dark:bg-rose-950/40 dark:text-rose-400 dark:ring-rose-900/50",
      value: "text-rose-800 dark:text-rose-400",
      glow: "group-hover:from-rose-500/[0.06]",
    },
    success: {
      wrap: "border-emerald-200/70 dark:border-emerald-900/40",
      icon: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900/50",
      value: "text-emerald-800 dark:text-emerald-400",
      glow: "group-hover:from-emerald-500/[0.06]",
    },
    purple: {
      wrap: "border-violet-200/70 dark:border-violet-900/40",
      icon: "bg-violet-50 text-violet-700 ring-1 ring-violet-200/70 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-900/50",
      value: "text-violet-800 dark:text-violet-400",
      glow: "group-hover:from-violet-500/[0.06]",
    },
  }[variant];

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        themes.wrap
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100", themes.glow)} />
      <div className="relative flex items-start justify-between">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", themes.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        {variant === "danger" && <ArrowDownRight className="h-4 w-4 text-rose-400/50" />}
        {variant === "success" && <ArrowUpRight className="h-4 w-4 text-emerald-400/50" />}
      </div>
      <div className="relative mt-4 border-t border-dashed border-border/60 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/60">{label}</p>
        <p className={cn("mt-1.5 font-mono text-2xl font-bold tabular-nums", themes.value)}>{value}</p>
        {sub && <p className="mt-1.5 text-[11px] text-muted-foreground/60">{sub}</p>}
      </div>
    </div>
  );
}

function StatementRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "negative" | "positive";
}) {
  return (
    <div className="flex items-baseline gap-2 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/25">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span aria-hidden className="mb-1 h-0 flex-1 border-b border-dotted border-muted-foreground/30" />
      <span
        className={cn(
          "shrink-0 font-mono text-sm font-semibold tabular-nums",
          tone === "negative" && "text-rose-700 dark:text-rose-400",
          tone === "positive" && "text-emerald-700 dark:text-emerald-400"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  variant = "ghost",
}: {
  icon: ElementType;
  label: string;
  onClick: () => void;
  variant?: "ghost" | "destructive";
}) {
  return (
    <Button
      type="button"
      variant={variant === "destructive" ? "destructive" : "ghost"}
      size="sm"
      className={cn(
        "h-8 rounded-lg px-2 text-[11px] font-medium transition-colors",
        variant === "destructive"
          ? "text-white"
          : "text-muted-foreground hover:bg-amber-500/10 hover:text-amber-800 dark:hover:text-amber-400"
      )}
      onClick={onClick}
    >
      <Icon className="mr-1.5 h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function StatusBadge({
  status,
  tone,
}: {
  status: string;
  tone: "emerald" | "amber" | "rose" | "slate" | "violet";
}) {
  const tones = {
    emerald: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-600/20 dark:text-emerald-400 dark:ring-emerald-500/30",
    amber: "bg-amber-500/10 text-amber-800 ring-1 ring-amber-600/20 dark:text-amber-400 dark:ring-amber-500/30",
    rose: "bg-rose-500/10 text-rose-700 ring-1 ring-rose-600/20 dark:text-rose-400 dark:ring-rose-500/30",
    violet: "bg-violet-500/10 text-violet-700 ring-1 ring-violet-600/20 dark:text-violet-400 dark:ring-violet-500/30",
    slate: "bg-muted text-muted-foreground ring-1 ring-border/60",
  }[tone];

  return (
    <Badge className={cn("gap-1.5 rounded-full border-0 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider shadow-none", tones)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.replace("_", " ")}
    </Badge>
  );
}

const todayValue = () => format(new Date(), "yyyy-MM-dd");
const monthValue = () => format(startOfMonth(new Date()), "yyyy-MM-dd");

const emptyExpenseForm = (): ExpenseFormState => ({
  category_id: "",
  amount: "",
  description: "",
  payment_method: "cash",
  expense_date: todayValue(),
  reference_number: "",
  staff_id: "none",
});

const emptyLoanForm = (): LoanFormState => ({
  staff_id: "",
  total_amount: "",
  monthly_deduction: "",
  reason: "",
  issued_date: todayValue(),
  status: "active",
});

const emptySalaryForm = (): SalaryFormState => ({
  staff_id: "",
  base_salary: "0",
  bonus_amount: "0",
  loan_deduction: "0",
  other_deductions: "0",
  payment_month: monthValue(),
  payment_date: todayValue(),
  payment_method: "cash",
  status: "paid",
  notes: "",
});

const emptyDamageForm = (): DamageFormState => ({
  item_name: "",
  damage_cost: "",
  location: "",
  charged_to_staff_id: "none",
  description: "",
  status: "pending",
  reported_at: todayValue(),
});

export default function HotelFinance() {
  const { formatCurrency } = useSettingsContext();
  const { activeStaff } = useStaffSession();
  const { data: activeShift } = useActiveStaffShift(activeStaff?.staff_id);
  const { data: staff = [] } = useHotelStaff();
  const { data: categories = [] } = useExpenseCategories();
  const { data: expenses = [] } = useExpenses();
  const { data: staffLoans = [] } = useStaffLoans();
  const { data: staffPayments = [] } = useStaffPayments();
  const { data: damages = [] } = useDamages();
  const { data: hotelPayments = [] } = useHotelPayments();

  const [activeTab, setActiveTab] = useState("reports");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [reportRange, setReportRange] = useState({
    start: monthValue(),
    end: todayValue(),
  });
  const { data: financialReport, isLoading: reportLoading } = useFinancialReport(reportRange.start, reportRange.end);

  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [loanDialogOpen, setLoanDialogOpen] = useState(false);
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false);
  const [damageDialogOpen, setDamageDialogOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState>(null);

  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(emptyExpenseForm());
  const [loanForm, setLoanForm] = useState<LoanFormState>(emptyLoanForm());
  const [salaryForm, setSalaryForm] = useState<SalaryFormState>(emptySalaryForm());
  const [damageForm, setDamageForm] = useState<DamageFormState>(emptyDamageForm());

  const addExpense = useAddExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const issueLoan = useIssueLoan();
  const updateLoan = useUpdateLoan();
  const deleteLoan = useDeleteLoan();
  const processSalary = useProcessSalary();
  const updateSalary = useUpdateSalary();
  const deleteSalary = useDeleteSalary();
  const reportDamage = useReportDamage();
  const updateDamage = useUpdateDamage();
  const deleteDamage = useDeleteDamage();

  const loadingDelete =
    deleteExpense.isPending || deleteLoan.isPending || deleteSalary.isPending || deleteDamage.isPending;

  const recommendedLoanDeduction = (staffId: string) =>
    staffLoans
      .filter((loan) => loan.staff_id === staffId && loan.status === "active")
      .sort((a, b) => a.issued_date.localeCompare(b.issued_date))
      .reduce((sum, loan) => sum + (loan.monthly_deduction > 0 ? Math.min(loan.monthly_deduction, loan.balance_amount) : loan.balance_amount), 0);

  const activeLoansTotal = useMemo(
    () => staffLoans.filter((loan) => loan.status === "active").reduce((sum, loan) => sum + loan.balance_amount, 0),
    [staffLoans]
  );

  const payrollMonthTotal = useMemo(
    () =>
      staffPayments
        .filter((payment) => payment.payment_month === reportRange.start.slice(0, 7) + "-01" && payment.status === "paid")
        .reduce((sum, payment) => sum + payment.net_amount, 0),
    [staffPayments, reportRange.start]
  );

  const rangeInterval = useMemo(
    () => ({
      start: parseISO(`${reportRange.start}T00:00:00`),
      end: parseISO(`${reportRange.end}T23:59:59`),
    }),
    [reportRange.end, reportRange.start]
  );

  const pdfExpenseRows = useMemo(
    () =>
      expenses.filter((expense) =>
        isWithinInterval(parseISO(`${expense.expense_date}T00:00:00`), rangeInterval)
      ),
    [expenses, rangeInterval]
  );

  const pdfSalaryRows = useMemo(
    () =>
      staffPayments.filter((payment) =>
        isWithinInterval(parseISO(`${payment.payment_date}T00:00:00`), rangeInterval)
      ),
    [rangeInterval, staffPayments]
  );

  const pdfDamageRows = useMemo(
    () =>
      damages.filter((damage) =>
        isWithinInterval(parseISO(damage.reported_at), rangeInterval)
      ),
    [damages, rangeInterval]
  );

  const filteredHotelPayments = useMemo(() => {
    const inRange = filterPaymentsByDateRange(
      hotelPayments,
      rangeInterval.start,
      rangeInterval.end
    ).filter((payment) => payment.status !== "cancelled" && payment.status !== "void");

    if (paymentMethodFilter === "all") {
      return inRange;
    }

    return inRange.filter((payment) => payment.payment_method === paymentMethodFilter);
  }, [hotelPayments, paymentMethodFilter, rangeInterval]);

  const hotelPaymentCards = useMemo(
    () => [
      { label: "Cash", value: getMethodTotal(filteredHotelPayments, ["cash"]), icon: Banknote, variant: "success" as const },
      { label: "Mobile Money", value: getMethodTotal(filteredHotelPayments, ["momo"]), icon: Smartphone, variant: "purple" as const },
      { label: "Card", value: getMethodTotal(filteredHotelPayments, ["card"]), icon: CreditCard, variant: "default" as const },
      { label: "Bank Transfer", value: getMethodTotal(filteredHotelPayments, ["bank_transfer"]), icon: Building2, variant: "default" as const },
    ],
    [filteredHotelPayments]
  );

  const triggerCls = "h-9 rounded-xl border-border/60 bg-background/60 text-sm shadow-sm focus:ring-1 focus:ring-primary/40";
  const TH = ({ children, right }: { children: ReactNode; right?: boolean }) => (
    <TableHead className={cn(LBL, "py-3", right && "text-right")}>{children}</TableHead>
  );

  const startExpenseCreate = () => {
    setExpenseForm(emptyExpenseForm());
    setExpenseDialogOpen(true);
  };

  const startLoanCreate = () => {
    setLoanForm(emptyLoanForm());
    setLoanDialogOpen(true);
  };

  const startSalaryCreate = () => {
    setSalaryForm(emptySalaryForm());
    setSalaryDialogOpen(true);
  };

  const startDamageCreate = () => {
    setDamageForm(emptyDamageForm());
    setDamageDialogOpen(true);
  };

  const handleSalaryStaffChange = (staffId: string) => {
    const selectedStaff = staff.find((member) => member.id === staffId);
    setSalaryForm((current) => ({
      ...current,
      staff_id: staffId,
      base_salary: String(selectedStaff?.base_salary || 0),
      loan_deduction: String(recommendedLoanDeduction(staffId)),
    }));
  };

  const openExpenseEdit = (expense: Expense) => {
    setExpenseForm({
      id: expense.id,
      category_id: expense.category_id || "",
      amount: String(expense.amount),
      description: expense.description || "",
      payment_method: expense.payment_method || "cash",
      expense_date: expense.expense_date,
      reference_number: expense.reference_number || "",
      staff_id: expense.staff_id || "none",
    });
    setExpenseDialogOpen(true);
  };

  const openLoanEdit = (loan: StaffLoan) => {
    setLoanForm({
      id: loan.id,
      staff_id: loan.staff_id,
      total_amount: String(loan.total_amount),
      monthly_deduction: String(loan.monthly_deduction),
      reason: loan.reason || "",
      issued_date: loan.issued_date,
      status: loan.status,
      current_total_amount: loan.total_amount,
      current_balance_amount: loan.balance_amount,
    });
    setLoanDialogOpen(true);
  };

  const openSalaryEdit = (payment: StaffPayment) => {
    setSalaryForm({
      id: payment.id,
      staff_id: payment.staff_id,
      base_salary: String(payment.base_salary),
      bonus_amount: String(payment.bonus_amount),
      loan_deduction: String(payment.loan_deduction),
      other_deductions: String(payment.other_deductions),
      payment_month: payment.payment_month,
      payment_date: payment.payment_date,
      payment_method: payment.payment_method,
      status: payment.status,
      notes: payment.notes || "",
    });
    setSalaryDialogOpen(true);
  };

  const openDamageEdit = (damage: Damage) => {
    setDamageForm({
      id: damage.id,
      item_name: damage.item_name,
      damage_cost: String(damage.damage_cost),
      location: damage.location || "",
      charged_to_staff_id: damage.charged_to_staff_id || "none",
      description: damage.description || "",
      status: damage.status,
      reported_at: format(parseISO(damage.reported_at), "yyyy-MM-dd"),
    });
    setDamageDialogOpen(true);
  };

  const salaryGross = Number(salaryForm.base_salary || 0) + Number(salaryForm.bonus_amount || 0);
  const salaryNet =
    salaryGross - Number(salaryForm.loan_deduction || 0) - Number(salaryForm.other_deductions || 0);

  const downloadBalanceSheetPdf = (report: FinancialReport) => {
    const doc = new jsPDF();
    const title = "Restaurant Finance Report";

    doc.setFontSize(18);
    doc.text(title, 14, 18);
    doc.setFontSize(10);
    doc.text(`Period: ${format(parseISO(reportRange.start), "MMM dd, yyyy")} to ${format(parseISO(reportRange.end), "MMM dd, yyyy")}`, 14, 26);
    doc.text(`Generated: ${format(new Date(), "MMM dd, yyyy HH:mm")}`, 14, 32);

    autoTable(doc, {
      startY: 40,
      theme: "grid",
      head: [["Summary", "Amount"]],
      body: [
        ["Revenue", formatCurrency(report.revenue)],
        ["Operating expenses", formatCurrency(report.operatingExpenses)],
        ["Staff advances issued", formatCurrency(report.staffAdvancesIssued)],
        ["Payroll paid", formatCurrency(report.payrollPaid)],
        ["Damage expense", formatCurrency(report.damagesExpense)],
        ["Stock consumption", formatCurrency(report.stockConsumption)],
        ["Net profit", formatCurrency(report.netProfit)],
      ],
    });

    autoTable(doc, {
      startY: (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
        ? (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
        : 100,
      theme: "striped",
      head: [["Balance Sheet", "Amount"]],
      body: [
        ["Estimated cash position", formatCurrency(report.estimatedCashPosition)],
        ["Inventory on hand estimate", formatCurrency(report.estimatedInventoryValue)],
        ["Staff loan receivables", formatCurrency(report.activeLoanReceivables)],
        ["Recoverable damages", formatCurrency(report.recoverableDamages)],
        ["Total assets", formatCurrency(report.totalAssets)],
        ["Pending payroll liabilities", formatCurrency(report.totalLiabilities)],
        ["Owner equity", formatCurrency(report.ownerEquity)],
      ],
    });

    const nextY =
      ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 140) + 10;

    autoTable(doc, {
      startY: nextY,
      head: [["Recent expenses", "Date", "Amount"]],
      body:
        pdfExpenseRows.length > 0
          ? pdfExpenseRows.slice(0, 8).map((expense) => [
              expense.description || expense.category?.name || "Expense",
              format(parseISO(`${expense.expense_date}T00:00:00`), "MMM dd, yyyy"),
              formatCurrency(expense.amount),
            ])
          : [["No expenses in this period", "-", formatCurrency(0)]],
    });

    autoTable(doc, {
      startY: ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || nextY) + 10,
      head: [["Payroll", "Staff", "Net"]],
      body:
        pdfSalaryRows.length > 0
          ? pdfSalaryRows.slice(0, 8).map((payment) => [
              format(parseISO(`${payment.payment_date}T00:00:00`), "MMM dd, yyyy"),
              `${payment.staff?.first_name || ""} ${payment.staff?.last_name || ""}`.trim() || "Staff",
              formatCurrency(payment.net_amount),
            ])
          : [["No payroll in this period", "-", formatCurrency(0)]],
    });

    autoTable(doc, {
      startY: ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || nextY) + 10,
      head: [["Damages", "Status", "Cost"]],
      body:
        pdfDamageRows.length > 0
          ? pdfDamageRows.slice(0, 8).map((damage) => [
              damage.item_name,
              damage.status,
              formatCurrency(damage.damage_cost),
            ])
          : [["No damages in this period", "-", formatCurrency(0)]],
    });

    doc.save(`restaurant-finance-${reportRange.start}-to-${reportRange.end}.pdf`);
  };

  const handleExpenseSubmit = async () => {
    if (!expenseForm.category_id || !expenseForm.amount || !expenseForm.description.trim()) {
      toast.error("Category, amount, and description are required.");
      return;
    }

    const payload = {
      category_id: expenseForm.category_id,
      amount: Number(expenseForm.amount),
      description: expenseForm.description.trim(),
      payment_method: expenseForm.payment_method,
      expense_date: expenseForm.expense_date,
      reference_number: expenseForm.reference_number.trim() || null,
      staff_id: expenseForm.staff_id === "none" ? null : expenseForm.staff_id,
      shift_id: activeShift?.id || null,
    };

    if (expenseForm.id) {
      await updateExpense.mutateAsync({ id: expenseForm.id, ...payload });
    } else {
      await addExpense.mutateAsync(payload);
    }

    setExpenseDialogOpen(false);
    setExpenseForm(emptyExpenseForm());
  };

  const handleLoanSubmit = async () => {
    if (!loanForm.staff_id || !loanForm.total_amount) {
      toast.error("Staff member and loan amount are required.");
      return;
    }

    const payload: LoanMutationInput = {
      staff_id: loanForm.staff_id,
      total_amount: Number(loanForm.total_amount),
      monthly_deduction: Number(loanForm.monthly_deduction || 0),
      reason: loanForm.reason.trim() || null,
      issued_date: loanForm.issued_date,
      status: loanForm.status,
      current_total_amount: loanForm.current_total_amount,
      current_balance_amount: loanForm.current_balance_amount,
    };

    if (loanForm.id) {
      await updateLoan.mutateAsync({
        ...payload,
        id: loanForm.id,
        current_total_amount: loanForm.current_total_amount || 0,
        current_balance_amount: loanForm.current_balance_amount || 0,
      });
    } else {
      await issueLoan.mutateAsync(payload);
    }

    setLoanDialogOpen(false);
    setLoanForm(emptyLoanForm());
  };

  const handleSalarySubmit = async () => {
    if (!salaryForm.staff_id || !salaryForm.payment_month) {
      toast.error("Staff member and payment month are required.");
      return;
    }

    const payload: SalaryMutationInput = {
      staff_id: salaryForm.staff_id,
      base_salary: Number(salaryForm.base_salary || 0),
      bonus_amount: Number(salaryForm.bonus_amount || 0),
      loan_deduction: Number(salaryForm.loan_deduction || 0),
      other_deductions: Number(salaryForm.other_deductions || 0),
      payment_month: salaryForm.payment_month,
      payment_date: salaryForm.payment_date,
      payment_method: salaryForm.payment_method,
      status: salaryForm.status,
      notes: salaryForm.notes.trim() || null,
    };

    if (salaryForm.id) {
      await updateSalary.mutateAsync({ id: salaryForm.id, ...payload });
    } else {
      await processSalary.mutateAsync(payload);
    }

    setSalaryDialogOpen(false);
    setSalaryForm(emptySalaryForm());
  };

  const handleDamageSubmit = async () => {
    if (!damageForm.item_name.trim() || !damageForm.damage_cost) {
      toast.error("Item name and damage cost are required.");
      return;
    }

    const payload = {
      item_name: damageForm.item_name.trim(),
      damage_cost: Number(damageForm.damage_cost),
      location: damageForm.location.trim() || null,
      charged_to_staff_id: damageForm.charged_to_staff_id === "none" ? null : damageForm.charged_to_staff_id,
      charged_to_guest_id: null,
      description: damageForm.description.trim() || null,
      status: damageForm.status,
      reported_at: `${damageForm.reported_at}T00:00:00.000Z`,
      shift_id: activeShift?.id || null,
      staff_id: activeStaff?.staff_id || null,
    };

    if (damageForm.id) {
      await updateDamage.mutateAsync({ id: damageForm.id, ...payload });
    } else {
      await reportDamage.mutateAsync(payload);
    }

    setDamageDialogOpen(false);
    setDamageForm(emptyDamageForm());
  };

  const handleDeleteConfirm = async () => {
    if (!deleteState) return;

    if (deleteState.type === "expense") {
      await deleteExpense.mutateAsync(deleteState.record.id);
    }

    if (deleteState.type === "loan") {
      await deleteLoan.mutateAsync(deleteState.record);
    }

    if (deleteState.type === "payroll") {
      await deleteSalary.mutateAsync(deleteState.record.id);
    }

    if (deleteState.type === "damage") {
      await deleteDamage.mutateAsync(deleteState.record.id);
    }

    setDeleteState(null);
  };

  return (
    <Layout disableScroll>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={LEDGER_BG}>
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-7xl space-y-8 p-4 pb-16 md:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <p className="section-label">Hotel management</p>
                </div>
                <h1 className="mt-1.5 font-serif text-3xl font-black tracking-tight sm:text-4xl">
                  FINANCE <span className="text-primary">&amp;</span> PAYROLL
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Proper CRUD, business reporting, and a readable balance sheet for the restaurant.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-9 rounded-xl bg-gradient-to-b from-primary to-primary/90 text-xs font-bold uppercase tracking-wider shadow-sm hover:shadow-md"
                  onClick={startExpenseCreate}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Record expense
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-xl border-border/70 bg-background/60 text-xs font-bold uppercase tracking-wider shadow-sm"
                  onClick={startSalaryCreate}
                >
                  <Briefcase className="mr-1.5 h-3.5 w-3.5" />
                  Process salary
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <KpiCard
                label="Revenue"
                value={formatCurrency(financialReport?.revenue || 0)}
                sub="Paid guest and restaurant sales"
                icon={TrendingUp}
                variant="success"
              />
              <KpiCard
                label="Operating costs"
                value={formatCurrency((financialReport?.operatingExpenses || 0) + (financialReport?.payrollPaid || 0) + (financialReport?.damagesExpense || 0))}
                sub="Without staff loan advances"
                icon={TrendingDown}
                variant="danger"
              />
              <KpiCard
                label="Loan receivables"
                value={formatCurrency(financialReport?.activeLoanReceivables || activeLoansTotal)}
                sub="Outstanding staff balances"
                icon={HandCoins}
              />
              <KpiCard
                label="Payroll paid"
                value={formatCurrency(payrollMonthTotal || financialReport?.payrollPaid || 0)}
                sub="Paid salaries in the selected period"
                icon={Calculator}
                variant="purple"
              />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="sticky top-0 z-10 bg-background/85 py-2 backdrop-blur-md">
                <TabsList className="flex h-auto w-full overflow-x-auto rounded-2xl border border-border/50 bg-muted/20 p-1 shadow-sm no-scrollbar">
                  {[
                    { value: "reports", label: "Balance Sheet", icon: PieChart },
                    { value: "expenses", label: "Expenses", icon: Receipt },
                    { value: "payroll", label: "Payroll", icon: Briefcase },
                    { value: "loans", label: "Loans", icon: HandCoins },
                    { value: "damages", label: "Damages", icon: Hammer },
                  ].map(({ value, label, icon: Icon }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="flex min-w-[110px] flex-1 items-center gap-1.5 rounded-xl py-2 text-[11px] font-bold uppercase tracking-wider transition-colors data-[state=active]:bg-gradient-to-b data-[state=active]:from-primary data-[state=active]:to-primary/90 data-[state=active]:text-white data-[state=active]:shadow-sm"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <TabsContent value="reports" className="mt-6 focus-visible:outline-none">
                <div className="grid gap-6 lg:grid-cols-12">
                  <div className="space-y-5 lg:col-span-4">
                    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
                      <AccentStripe />
                      <div className="border-b border-border/60 px-5 py-4 pt-5">
                        <h3 className="font-serif text-sm font-semibold tracking-wide">Analysis period</h3>
                      </div>
                      <div className="space-y-4 p-5">
                        <Field id="report-start" label="From date" type="date" value={reportRange.start} onChange={(e) => setReportRange((current) => ({ ...current, start: e.target.value }))} />
                        <Field id="report-end" label="To date" type="date" value={reportRange.end} onChange={(e) => setReportRange((current) => ({ ...current, end: e.target.value }))} />
                        <div className="space-y-1.5">
                          <FieldLabel>Payment filter</FieldLabel>
                          <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                            <SelectTrigger className={triggerCls}>
                              <SelectValue placeholder="Filter payment method" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Methods</SelectItem>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="momo">Mobile Money</SelectItem>
                              <SelectItem value="card">Card</SelectItem>
                              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Separator className="border-dashed" />
                        <Button
                          variant="outline"
                          className="h-9 w-full rounded-xl border-border/70 text-xs font-bold uppercase tracking-wider shadow-sm"
                          disabled={!financialReport}
                          onClick={() => financialReport && downloadBalanceSheetPdf(financialReport)}
                        >
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          Export PDF
                        </Button>
                      </div>
                    </div>

                    <div className="relative overflow-hidden rounded-2xl bg-[hsl(222_47%_11%)] p-5 text-white shadow-lg">
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500/70 to-transparent" />
                      <p className="section-label text-white/40">What changed in the logic</p>
                      <div className="mt-4 space-y-3 text-sm text-white/80">
                        <div className="flex gap-2">
                          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                          <span>Staff loans are no longer treated as normal operating expense in the report.</span>
                        </div>
                        <div className="flex gap-2">
                          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                          <span>Payroll edits and deletes now reverse loan deductions correctly.</span>
                        </div>
                        <div className="flex gap-2">
                          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                          <span>Recoverable damage is shown separately from actual hotel loss.</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm lg:col-span-8">
                    <AccentStripe />
                    <div className="flex flex-col gap-3 border-b border-border/60 px-6 py-5 pt-6 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="font-serif text-2xl font-black tracking-tight">BUSINESS BALANCE SHEET</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {format(parseISO(reportRange.start), "MMM dd, yyyy")} to {format(parseISO(reportRange.end), "MMM dd, yyyy")}
                        </p>
                      </div>
                      <Badge className="gap-1.5 rounded-full border-0 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-amber-800 ring-1 ring-amber-600/20 dark:text-amber-400 dark:ring-amber-500/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        Management view
                      </Badge>
                    </div>

                    {reportLoading ? (
                      <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
                      </div>
                    ) : financialReport ? (
                      <div className="space-y-6 p-6">
                        <div className="grid gap-4 md:grid-cols-3">
                          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                            <p className={LBL}>Total assets</p>
                            <p className="mt-2 font-mono text-3xl font-black tabular-nums text-emerald-800 dark:text-emerald-400">
                              {formatCurrency(financialReport.totalAssets)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-amber-200/70 bg-amber-50/60 p-5 dark:border-amber-900/50 dark:bg-amber-950/20">
                            <p className={LBL}>Liabilities</p>
                            <p className="mt-2 font-mono text-3xl font-black tabular-nums text-amber-800 dark:text-amber-400">
                              {formatCurrency(financialReport.totalLiabilities)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-violet-200/70 bg-violet-50/60 p-5 dark:border-violet-900/50 dark:bg-violet-950/20">
                            <p className={LBL}>Owner equity</p>
                            <p className="mt-2 font-mono text-3xl font-black tabular-nums text-violet-800 dark:text-violet-400">
                              {formatCurrency(financialReport.ownerEquity)}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-6 md:grid-cols-2">
                          <section className="rounded-2xl border border-border/60 p-4">
                            <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-3">
                              <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              <h3 className="font-serif text-sm font-black uppercase tracking-widest">Assets</h3>
                            </div>
                            <StatementRow label="Estimated cash position" value={formatCurrency(financialReport.estimatedCashPosition)} />
                            <StatementRow label="Inventory on hand estimate" value={formatCurrency(financialReport.estimatedInventoryValue)} />
                            <StatementRow label="Outstanding staff loans" value={formatCurrency(financialReport.activeLoanReceivables)} />
                            <StatementRow label="Recoverable damages" value={formatCurrency(financialReport.recoverableDamages)} />
                            <Separator className="my-2 border-dashed" />
                            <StatementRow label="Total assets" value={formatCurrency(financialReport.totalAssets)} tone="positive" />
                          </section>

                          <section className="rounded-2xl border border-border/60 p-4">
                            <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-3">
                              <FileText className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                              <h3 className="font-serif text-sm font-black uppercase tracking-widest">Liabilities &amp; Equity</h3>
                            </div>
                            <StatementRow label="Pending payroll" value={formatCurrency(financialReport.totalLiabilities)} tone="negative" />
                            <StatementRow label="Net profit in period" value={formatCurrency(financialReport.netProfit)} tone={financialReport.netProfit >= 0 ? "positive" : "negative"} />
                            <StatementRow label="Owner equity" value={formatCurrency(financialReport.ownerEquity)} tone="positive" />
                          </section>
                        </div>

                        <section className="rounded-2xl border border-border/60 p-4">
                          <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-3">
                            <TrendingUp className="h-4 w-4 text-primary" />
                            <h3 className="font-serif text-sm font-black uppercase tracking-widest">Performance Breakdown</h3>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <StatementRow label="Guest revenue" value={formatCurrency(financialReport.guestRevenue)} tone="positive" />
                            <StatementRow label="Restaurant revenue" value={formatCurrency(financialReport.restaurantRevenue)} tone="positive" />
                            <StatementRow label="Operating expenses" value={formatCurrency(financialReport.operatingExpenses)} tone="negative" />
                            <StatementRow label="Staff advances issued" value={formatCurrency(financialReport.staffAdvancesIssued)} tone="negative" />
                            <StatementRow label="Payroll paid" value={formatCurrency(financialReport.payrollPaid)} tone="negative" />
                            <StatementRow label="Damage expense" value={formatCurrency(financialReport.damagesExpense)} tone="negative" />
                            <StatementRow label="Stock purchases" value={formatCurrency(financialReport.stockPurchases)} tone="negative" />
                            <StatementRow label="Stock consumption" value={formatCurrency(financialReport.stockConsumption)} tone="negative" />
                          </div>
                        </section>

                        <section className="rounded-2xl border border-border/60 p-4">
                          <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-3">
                            <Receipt className="h-4 w-4 text-primary" />
                            <h3 className="font-serif text-sm font-black uppercase tracking-widest">Payment Method Report</h3>
                          </div>

                          <div className="grid gap-3 md:grid-cols-4">
                            {hotelPaymentCards.map((card) => (
                              <KpiCard
                                key={card.label}
                                label={card.label}
                                value={formatCurrency(card.value)}
                                sub="Posted hotel payments"
                                icon={card.icon}
                                variant={card.variant}
                              />
                            ))}
                          </div>

                          <div className="mt-4 rounded-2xl border border-border/60">
                            <Table>
                              <TableHeader>
                                <TableRow className="border-b border-border/60 bg-muted/20 hover:bg-muted/20">
                                  <TH>Date</TH>
                                  <TH>Method</TH>
                                  <TH>Receipt</TH>
                                  <TH right>Amount</TH>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredHotelPayments.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                                      No hotel payments found for this period and method filter.
                                    </TableCell>
                                  </TableRow>
                                ) : (
                                  filteredHotelPayments.slice(0, 20).map((payment) => (
                                    <TableRow key={payment.id}>
                                      <TableCell>{format(new Date(payment.created_at), "MMM dd, yyyy HH:mm")}</TableCell>
                                      <TableCell>{formatHotelPaymentMethod(payment.payment_method)}</TableCell>
                                      <TableCell>{payment.receipt_no || "-"}</TableCell>
                                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                                        {formatCurrency(Number(payment.amount || 0))}
                                      </TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </section>
                      </div>
                    ) : null}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="expenses" className="mt-6 focus-visible:outline-none">
                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
                  <AccentStripe />
                  <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 pt-5">
                    <h3 className="font-serif text-base font-bold uppercase tracking-wider">Expense history</h3>
                    <Button size="sm" className="h-8 rounded-xl bg-gradient-to-b from-primary to-primary/90 text-[10px] font-bold uppercase tracking-wider shadow-sm" onClick={startExpenseCreate}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add expense
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-2 border-border/70 bg-muted/25 hover:bg-muted/25">
                        <TH>Date</TH>
                        <TH>Category</TH>
                        <TH>Description</TH>
                        <TH>Reference</TH>
                        <TH>Method</TH>
                        <TH right>Amount</TH>
                        <TH right>Actions</TH>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-16 text-center text-xs text-muted-foreground">
                            No expenses recorded yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        expenses.map((expense, index) => (
                          <TableRow
                            key={expense.id}
                            className={cn(
                              "border-border/40 transition-colors hover:bg-amber-500/[0.05]",
                              index % 2 === 1 && "bg-muted/10"
                            )}
                          >
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {format(parseISO(`${expense.expense_date}T00:00:00`), "MMM dd, yyyy")}
                            </TableCell>
                            <TableCell>{expense.category?.name || "Uncategorized"}</TableCell>
                            <TableCell className="max-w-[260px] truncate">{expense.description}</TableCell>
                            <TableCell className="font-mono text-xs">{expense.reference_number || "—"}</TableCell>
                            <TableCell className="uppercase">{expense.payment_method.replace("_", " ")}</TableCell>
                            <TableCell className="text-right font-mono font-bold tabular-nums text-rose-700 dark:text-rose-400">
                              {formatCurrency(expense.amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <ActionButton icon={Pencil} label="Edit" onClick={() => openExpenseEdit(expense)} />
                                <ActionButton icon={Trash2} label="Delete" variant="destructive" onClick={() => setDeleteState({ type: "expense", record: expense })} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="payroll" className="mt-6 focus-visible:outline-none">
                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
                  <AccentStripe />
                  <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 pt-5">
                    <h3 className="font-serif text-base font-bold uppercase tracking-wider">Staff salary registry</h3>
                    <Button size="sm" className="h-8 rounded-xl bg-gradient-to-b from-primary to-primary/90 text-[10px] font-bold uppercase tracking-wider shadow-sm" onClick={startSalaryCreate}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Process salary
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-2 border-border/70 bg-muted/25 hover:bg-muted/25">
                        <TH>Month</TH>
                        <TH>Payment date</TH>
                        <TH>Staff member</TH>
                        <TH>Gross</TH>
                        <TH>Deductions</TH>
                        <TH>Status</TH>
                        <TH right>Net paid</TH>
                        <TH right>Actions</TH>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {staffPayments.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-16 text-center text-xs text-muted-foreground">
                            No payroll records.
                          </TableCell>
                        </TableRow>
                      ) : (
                        staffPayments.map((payment, index) => {
                          const gross = payment.base_salary + payment.bonus_amount;
                          return (
                            <TableRow
                              key={payment.id}
                              className={cn(
                                "border-border/40 transition-colors hover:bg-amber-500/[0.05]",
                                index % 2 === 1 && "bg-muted/10"
                              )}
                            >
                              <TableCell className="font-mono text-xs">{format(parseISO(`${payment.payment_month}T00:00:00`), "MMM yyyy")}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{format(parseISO(`${payment.payment_date}T00:00:00`), "MMM dd, yyyy")}</TableCell>
                              <TableCell>{payment.staff?.first_name} {payment.staff?.last_name}</TableCell>
                              <TableCell className="font-mono text-xs tabular-nums">{formatCurrency(gross)}</TableCell>
                              <TableCell className="text-xs text-rose-700 dark:text-rose-400">
                                Loan {formatCurrency(payment.loan_deduction)} / Other {formatCurrency(payment.other_deductions)}
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={payment.status} tone={payment.status === "paid" ? "emerald" : "amber"} />
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                                {formatCurrency(payment.net_amount)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <ActionButton icon={Pencil} label="Edit" onClick={() => openSalaryEdit(payment)} />
                                  <ActionButton icon={Trash2} label="Delete" variant="destructive" onClick={() => setDeleteState({ type: "payroll", record: payment })} />
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="loans" className="mt-6 focus-visible:outline-none">
                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
                  <AccentStripe />
                  <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 pt-5">
                    <h3 className="font-serif text-base font-bold uppercase tracking-wider">Staff loans and advances</h3>
                    <Button size="sm" className="h-8 rounded-xl bg-gradient-to-b from-primary to-primary/90 text-[10px] font-bold uppercase tracking-wider shadow-sm" onClick={startLoanCreate}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Issue loan
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-2 border-border/70 bg-muted/25 hover:bg-muted/25">
                        <TH>Issued</TH>
                        <TH>Staff member</TH>
                        <TH>Total</TH>
                        <TH>Repaid</TH>
                        <TH>Balance</TH>
                        <TH>Monthly deduction</TH>
                        <TH>Status</TH>
                        <TH>Reason</TH>
                        <TH right>Actions</TH>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {staffLoans.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="py-16 text-center text-xs text-muted-foreground">
                            No loans recorded.
                          </TableCell>
                        </TableRow>
                      ) : (
                        staffLoans.map((loan, index) => (
                          <TableRow
                            key={loan.id}
                            className={cn(
                              "border-border/40 transition-colors hover:bg-amber-500/[0.05]",
                              index % 2 === 1 && "bg-muted/10"
                            )}
                          >
                            <TableCell className="font-mono text-xs text-muted-foreground">{format(parseISO(`${loan.issued_date}T00:00:00`), "MMM dd, yyyy")}</TableCell>
                            <TableCell>{loan.staff?.first_name} {loan.staff?.last_name}</TableCell>
                            <TableCell className="font-mono text-xs tabular-nums">{formatCurrency(loan.total_amount)}</TableCell>
                            <TableCell className="font-mono text-xs tabular-nums">{formatCurrency(loan.total_amount - loan.balance_amount)}</TableCell>
                            <TableCell className="font-mono font-bold tabular-nums text-blue-700 dark:text-blue-400">{formatCurrency(loan.balance_amount)}</TableCell>
                            <TableCell className="text-xs">{loan.monthly_deduction > 0 ? formatCurrency(loan.monthly_deduction) : "Full balance"}</TableCell>
                            <TableCell>
                              <StatusBadge
                                status={loan.status}
                                tone={loan.status === "active" ? "amber" : loan.status === "repaid" ? "emerald" : "slate"}
                              />
                            </TableCell>
                            <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{loan.reason || "—"}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <ActionButton icon={Pencil} label="Edit" onClick={() => openLoanEdit(loan)} />
                                <ActionButton icon={Trash2} label="Delete" variant="destructive" onClick={() => setDeleteState({ type: "loan", record: loan })} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="damages" className="mt-6 focus-visible:outline-none">
                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
                  <AccentStripe />
                  <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 pt-5">
                    <h3 className="font-serif text-base font-bold uppercase tracking-wider">Property damage registry</h3>
                    <Button size="sm" className="h-8 rounded-xl bg-gradient-to-b from-primary to-primary/90 text-[10px] font-bold uppercase tracking-wider shadow-sm" onClick={startDamageCreate}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Report damage
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-2 border-border/70 bg-muted/25 hover:bg-muted/25">
                        <TH>Date</TH>
                        <TH>Item</TH>
                        <TH>Location</TH>
                        <TH>Liability</TH>
                        <TH>Status</TH>
                        <TH right>Cost</TH>
                        <TH right>Actions</TH>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {damages.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-16 text-center text-xs text-muted-foreground">
                            No damages reported.
                          </TableCell>
                        </TableRow>
                      ) : (
                        damages.map((damage, index) => (
                          <TableRow
                            key={damage.id}
                            className={cn(
                              "border-border/40 transition-colors hover:bg-amber-500/[0.05]",
                              index % 2 === 1 && "bg-muted/10"
                            )}
                          >
                            <TableCell className="font-mono text-xs text-muted-foreground">{format(parseISO(damage.reported_at), "MMM dd, yyyy")}</TableCell>
                            <TableCell>{damage.item_name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{damage.location || "—"}</TableCell>
                            <TableCell className="text-xs">
                              {damage.staff
                                ? `Staff · ${damage.staff.first_name}`
                                : damage.guest
                                  ? `Guest · ${damage.guest.first_name}`
                                  : "Hotel cost"}
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                status={damage.status}
                                tone={damage.status === "written_off" ? "rose" : damage.status === "repaired" ? "emerald" : "amber"}
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold tabular-nums">{formatCurrency(damage.damage_cost)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <ActionButton icon={Pencil} label="Edit" onClick={() => openDamageEdit(damage)} />
                                <ActionButton icon={Trash2} label="Delete" variant="destructive" onClick={() => setDeleteState({ type: "damage", record: damage })} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>

        <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
          <DialogContent className="relative max-w-lg overflow-hidden rounded-2xl border-border/60 p-0 shadow-xl">
            <AccentStripe />
            <div className="border-b border-border/60 px-6 py-5 pt-6">
              <DialogTitle className="font-serif text-base font-bold uppercase tracking-wider">
                {expenseForm.id ? "Edit expense" : "Record expense"}
              </DialogTitle>
            </div>
            <div className="grid gap-4 px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldLabel required>Category</FieldLabel>
                  <Select value={expenseForm.category_id} onValueChange={(value) => setExpenseForm((current) => ({ ...current, category_id: value }))}>
                    <SelectTrigger className={triggerCls}><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Field id="expense-date" label="Expense date" required type="date" value={expenseForm.expense_date} onChange={(e) => setExpenseForm((current) => ({ ...current, expense_date: e.target.value }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="expense-amount" label="Amount" required type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm((current) => ({ ...current, amount: e.target.value }))} />
                <Field id="expense-ref" label="Reference number" value={expenseForm.reference_number} onChange={(e) => setExpenseForm((current) => ({ ...current, reference_number: e.target.value }))} />
              </div>
              <Field id="expense-description" label="Description" required value={expenseForm.description} onChange={(e) => setExpenseForm((current) => ({ ...current, description: e.target.value }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldLabel>Payment method</FieldLabel>
                  <Select value={expenseForm.payment_method} onValueChange={(value) => setExpenseForm((current) => ({ ...current, payment_method: value }))}>
                    <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                      <SelectItem value="mobile_money">Mobile money</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Paid by</FieldLabel>
                  <Select value={expenseForm.staff_id} onValueChange={(value) => setExpenseForm((current) => ({ ...current, staff_id: value }))}>
                    <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not assigned</SelectItem>
                      {staff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>{member.first_name} {member.last_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter className="border-t border-border/60 bg-muted/10 px-6 py-4">
              <Button variant="ghost" onClick={() => setExpenseDialogOpen(false)}>Cancel</Button>
              <Button className="bg-gradient-to-b from-primary to-primary/90 shadow-sm" onClick={handleExpenseSubmit} disabled={addExpense.isPending || updateExpense.isPending}>
                {addExpense.isPending || updateExpense.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {expenseForm.id ? "Save changes" : "Save expense"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={loanDialogOpen} onOpenChange={setLoanDialogOpen}>
          <DialogContent className="relative max-w-lg overflow-hidden rounded-2xl border-border/60 p-0 shadow-xl">
            <AccentStripe />
            <div className="border-b border-border/60 px-6 py-5 pt-6">
              <DialogTitle className="font-serif text-base font-bold uppercase tracking-wider">
                {loanForm.id ? "Edit staff loan" : "Issue staff loan"}
              </DialogTitle>
            </div>
            <div className="grid gap-4 px-6 py-5">
              <div className="space-y-1.5">
                <FieldLabel required>Staff member</FieldLabel>
                <Select value={loanForm.staff_id} onValueChange={(value) => setLoanForm((current) => ({ ...current, staff_id: value }))}>
                  <SelectTrigger className={triggerCls}><SelectValue placeholder="Select staff member" /></SelectTrigger>
                  <SelectContent>{staff.map((member) => <SelectItem key={member.id} value={member.id}>{member.first_name} {member.last_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="loan-amount" label="Loan amount" required type="number" value={loanForm.total_amount} onChange={(e) => setLoanForm((current) => ({ ...current, total_amount: e.target.value }))} />
                <Field id="loan-deduction" label="Monthly deduction" type="number" value={loanForm.monthly_deduction} onChange={(e) => setLoanForm((current) => ({ ...current, monthly_deduction: e.target.value }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="loan-date" label="Issued date" required type="date" value={loanForm.issued_date} onChange={(e) => setLoanForm((current) => ({ ...current, issued_date: e.target.value }))} />
                <div className="space-y-1.5">
                  <FieldLabel>Status</FieldLabel>
                  <Select value={loanForm.status} onValueChange={(value: StaffLoan["status"]) => setLoanForm((current) => ({ ...current, status: value }))}>
                    <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="repaid">Repaid</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Reason</FieldLabel>
                <Textarea className="rounded-xl border-border/60 bg-background/60 shadow-sm" value={loanForm.reason} onChange={(e) => setLoanForm((current) => ({ ...current, reason: e.target.value }))} />
              </div>
            </div>
            <DialogFooter className="border-t border-border/60 bg-muted/10 px-6 py-4">
              <Button variant="ghost" onClick={() => setLoanDialogOpen(false)}>Cancel</Button>
              <Button className="bg-gradient-to-b from-primary to-primary/90 shadow-sm" onClick={handleLoanSubmit} disabled={issueLoan.isPending || updateLoan.isPending}>
                {issueLoan.isPending || updateLoan.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {loanForm.id ? "Save loan" : "Issue loan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={salaryDialogOpen} onOpenChange={setSalaryDialogOpen}>
          <DialogContent className="relative max-w-xl overflow-hidden rounded-2xl border-border/60 p-0 shadow-xl">
            <AccentStripe />
            <div className="border-b border-border/60 px-6 py-5 pt-6">
              <DialogTitle className="font-serif text-base font-bold uppercase tracking-wider">
                {salaryForm.id ? "Edit salary payment" : "Process salary"}
              </DialogTitle>
            </div>
            <div className="grid gap-4 px-6 py-5">
              <div className="space-y-1.5">
                <FieldLabel required>Staff member</FieldLabel>
                <Select value={salaryForm.staff_id} onValueChange={handleSalaryStaffChange}>
                  <SelectTrigger className={triggerCls}><SelectValue placeholder="Select staff member" /></SelectTrigger>
                  <SelectContent>{staff.map((member) => <SelectItem key={member.id} value={member.id}>{member.first_name} {member.last_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="salary-month" label="Payment month" required type="date" value={salaryForm.payment_month} onChange={(e) => setSalaryForm((current) => ({ ...current, payment_month: e.target.value }))} />
                <Field id="salary-date" label="Payment date" required type="date" value={salaryForm.payment_date} onChange={(e) => setSalaryForm((current) => ({ ...current, payment_date: e.target.value }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldLabel>Base salary</FieldLabel>
                  <Input readOnly value={salaryForm.base_salary} className="h-9 rounded-xl border-border/60 bg-muted/30 font-mono text-sm tabular-nums shadow-sm" />
                </div>
                <Field id="salary-bonus" label="Bonus" type="number" value={salaryForm.bonus_amount} onChange={(e) => setSalaryForm((current) => ({ ...current, bonus_amount: e.target.value }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="salary-loan" label="Loan deduction" type="number" value={salaryForm.loan_deduction} onChange={(e) => setSalaryForm((current) => ({ ...current, loan_deduction: e.target.value }))} />
                <Field id="salary-other" label="Other deductions" type="number" value={salaryForm.other_deductions} onChange={(e) => setSalaryForm((current) => ({ ...current, other_deductions: e.target.value }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldLabel>Payment method</FieldLabel>
                  <Select value={salaryForm.payment_method} onValueChange={(value) => setSalaryForm((current) => ({ ...current, payment_method: value }))}>
                    <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                      <SelectItem value="mobile_money">Mobile money</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Status</FieldLabel>
                  <Select value={salaryForm.status} onValueChange={(value: StaffPayment["status"]) => setSalaryForm((current) => ({ ...current, status: value }))}>
                    <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Notes</FieldLabel>
                <Textarea className="rounded-xl border-border/60 bg-background/60 shadow-sm" value={salaryForm.notes} onChange={(e) => setSalaryForm((current) => ({ ...current, notes: e.target.value }))} />
              </div>
              <div className="relative overflow-hidden rounded-2xl bg-[hsl(222_47%_11%)] p-5 text-white shadow-lg">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500/70 to-transparent" />
                <p className="section-label text-white/30">Pay slip preview</p>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between text-white/70">
                    <span>Gross</span>
                    <span className="font-mono tabular-nums">{formatCurrency(salaryGross)}</span>
                  </div>
                  <div className="flex justify-between text-rose-300">
                    <span>Loan deduction</span>
                    <span className="font-mono tabular-nums">-{formatCurrency(Number(salaryForm.loan_deduction || 0))}</span>
                  </div>
                  <div className="flex justify-between text-rose-300">
                    <span>Other deductions</span>
                    <span className="font-mono tabular-nums">-{formatCurrency(Number(salaryForm.other_deductions || 0))}</span>
                  </div>
                  <Separator className="bg-white/10" />
                  <div className="flex justify-between text-lg font-bold text-emerald-400">
                    <span>Net payable</span>
                    <span className="font-mono tabular-nums">{formatCurrency(salaryNet)}</span>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="border-t border-border/60 bg-muted/10 px-6 py-4">
              <Button variant="ghost" onClick={() => setSalaryDialogOpen(false)}>Cancel</Button>
              <Button className="bg-gradient-to-b from-primary to-primary/90 shadow-sm" onClick={handleSalarySubmit} disabled={processSalary.isPending || updateSalary.isPending}>
                {processSalary.isPending || updateSalary.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {salaryForm.id ? "Save payment" : "Confirm payment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={damageDialogOpen} onOpenChange={setDamageDialogOpen}>
          <DialogContent className="relative max-w-lg overflow-hidden rounded-2xl border-border/60 p-0 shadow-xl">
            <AccentStripe />
            <div className="border-b border-border/60 px-6 py-5 pt-6">
              <DialogTitle className="font-serif text-base font-bold uppercase tracking-wider">
                {damageForm.id ? "Edit damage record" : "Report damage"}
              </DialogTitle>
            </div>
            <div className="grid gap-4 px-6 py-5">
              <Field id="damage-item" label="Item name" required value={damageForm.item_name} onChange={(e) => setDamageForm((current) => ({ ...current, item_name: e.target.value }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="damage-cost" label="Damage cost" required type="number" value={damageForm.damage_cost} onChange={(e) => setDamageForm((current) => ({ ...current, damage_cost: e.target.value }))} />
                <Field id="damage-date" label="Reported date" type="date" value={damageForm.reported_at} onChange={(e) => setDamageForm((current) => ({ ...current, reported_at: e.target.value }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="damage-location" label="Location" value={damageForm.location} onChange={(e) => setDamageForm((current) => ({ ...current, location: e.target.value }))} />
                <div className="space-y-1.5">
                  <FieldLabel>Status</FieldLabel>
                  <Select value={damageForm.status} onValueChange={(value: Damage["status"]) => setDamageForm((current) => ({ ...current, status: value }))}>
                    <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="repaired">Repaired</SelectItem>
                      <SelectItem value="written_off">Written off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Charge to staff</FieldLabel>
                <Select value={damageForm.charged_to_staff_id} onValueChange={(value) => setDamageForm((current) => ({ ...current, charged_to_staff_id: value }))}>
                  <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Hotel cost</SelectItem>
                    {staff.map((member) => <SelectItem key={member.id} value={member.id}>Staff · {member.first_name} {member.last_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Description</FieldLabel>
                <Textarea className="rounded-xl border-border/60 bg-background/60 shadow-sm" value={damageForm.description} onChange={(e) => setDamageForm((current) => ({ ...current, description: e.target.value }))} />
              </div>
            </div>
            <DialogFooter className="border-t border-border/60 bg-muted/10 px-6 py-4">
              <Button variant="ghost" onClick={() => setDamageDialogOpen(false)}>Cancel</Button>
              <Button className="bg-gradient-to-b from-primary to-primary/90 shadow-sm" onClick={handleDamageSubmit} disabled={reportDamage.isPending || updateDamage.isPending}>
                {reportDamage.isPending || updateDamage.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {damageForm.id ? "Save damage" : "Log damage"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={Boolean(deleteState)} onOpenChange={(open) => !open && setDeleteState(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-serif">Delete finance record</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the selected record. Payroll deletion also reverses any loan deductions linked to that payment.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteConfirm} disabled={loadingDelete}>
                {loadingDelete ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MoreHorizontal className="mr-2 h-4 w-4" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}
