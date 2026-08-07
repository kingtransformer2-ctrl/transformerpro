import { endOfDay, parseISO, startOfDay } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
}

export interface Expense {
  id: string;
  category_id: string | null;
  amount: number;
  description: string;
  payment_method: string;
  reference_number: string | null;
  expense_date: string;
  staff_id: string | null;
  shift_id: string | null;
  created_at: string;
  category?: ExpenseCategory | null;
  staff?: { first_name: string; last_name: string } | null;
}

export interface StaffLoan {
  id: string;
  staff_id: string;
  total_amount: number;
  balance_amount: number;
  monthly_deduction: number;
  status: 'active' | 'repaid' | 'cancelled';
  reason: string | null;
  issued_date: string;
  created_at: string;
  updated_at: string;
  staff?: { first_name: string; last_name: string } | null;
}

export interface StaffPayment {
  id: string;
  staff_id: string;
  base_salary: number;
  bonus_amount: number;
  loan_deduction: number;
  other_deductions: number;
  net_amount: number;
  payment_month: string;
  payment_date: string;
  payment_method: string;
  status: 'pending' | 'paid';
  notes: string | null;
  created_at: string;
  staff?: { first_name: string; last_name: string } | null;
}

export interface Damage {
  id: string;
  item_name: string;
  location: string | null;
  damage_cost: number;
  charged_to_staff_id: string | null;
  charged_to_guest_id: string | null;
  description: string | null;
  status: 'pending' | 'repaired' | 'written_off';
  reported_at: string;
  shift_id?: string | null;
  staff_id?: string | null;
  staff?: { first_name: string; last_name: string } | null;
  guest?: { first_name: string; last_name: string } | null;
}

export interface FinancialReport {
  revenue: number;
  guestRevenue: number;
  restaurantRevenue: number;
  operatingExpenses: number;
  staffAdvancesIssued: number;
  damagesExpense: number;
  recoverableDamages: number;
  payrollPaid: number;
  pendingPayroll: number;
  stockPurchases: number;
  stockConsumption: number;
  estimatedInventoryValue: number;
  activeLoanReceivables: number;
  totalAssets: number;
  totalLiabilities: number;
  ownerEquity: number;
  estimatedCashPosition: number;
  netProfit: number;
}

type ExpenseInput = Omit<Expense, 'id' | 'created_at' | 'category' | 'staff'>;
type DamageInput = Omit<Damage, 'id' | 'reported_at' | 'staff' | 'guest'>;

export type LoanMutationInput = {
  id?: string;
  staff_id: string;
  total_amount: number;
  monthly_deduction: number;
  reason: string | null;
  issued_date: string;
  status?: StaffLoan['status'];
  current_total_amount?: number;
  current_balance_amount?: number;
};

export type SalaryMutationInput = {
  id?: string;
  staff_id: string;
  base_salary: number;
  bonus_amount: number;
  loan_deduction: number;
  other_deductions: number;
  payment_month: string;
  payment_date: string;
  payment_method: string;
  status: StaffPayment['status'];
  notes: string | null;
};

const getErrorMessage = (error: any, fallback: string) =>
  error?.message || error?.details || fallback;

const toNumber = (value: unknown) => Number(value || 0);

const buildRange = (startDate: string, endDate: string) => ({
  startTimestamp: startOfDay(parseISO(startDate)).toISOString(),
  endTimestamp: endOfDay(parseISO(endDate)).toISOString(),
  startDate,
  endDate,
});

async function fetchPaymentById(id: string) {
  const { data, error } = await apiClient
    .from('hotel_staff_payments')
    .select('*, staff:hotel_staff(first_name, last_name)')
    .eq('id', id)
    .single();

  if (error) {
    throw error;
  }

  return data as StaffPayment;
}

export function useExpenses() {
  return useQuery({
    queryKey: ['hotel-expenses'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_expenses')
        .select('*, category:hotel_expense_categories(*), staff:hotel_staff(first_name, last_name)')
        .order('expense_date', { ascending: false });

      if (error) throw error;
      return data as Expense[];
    },
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ['hotel-expense-categories'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_expense_categories')
        .select('*')
        .order('name');

      if (error) throw error;
      return data as ExpenseCategory[];
    },
  });
}

export function useAddExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (expense: ExpenseInput) => {
      const { data, error } = await apiClient
        .from('hotel_expenses')
        .insert([expense])
        .select('*, category:hotel_expense_categories(*), staff:hotel_staff(first_name, last_name)')
        .single();

      if (error) throw error;
      return data as Expense;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Expense recorded successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to record expense')),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...expense }: ExpenseInput & { id: string }) => {
      const { data, error } = await apiClient
        .from('hotel_expenses')
        .update(expense)
        .eq('id', id)
        .select('*, category:hotel_expense_categories(*), staff:hotel_staff(first_name, last_name)')
        .single();

      if (error) throw error;
      return data as Expense;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Expense updated successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to update expense')),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.from('hotel_expenses').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Expense deleted successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to delete expense')),
  });
}

export function useStaffLoans() {
  return useQuery({
    queryKey: ['hotel-staff-loans'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_staff_loans')
        .select('*, staff:hotel_staff(first_name, last_name)')
        .order('issued_date', { ascending: false });

      if (error) throw error;
      return data as StaffLoan[];
    },
  });
}

export function useIssueLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (loan: Omit<LoanMutationInput, 'id' | 'status' | 'current_total_amount' | 'current_balance_amount'>) => {
      const { data, error } = await apiClient
        .from('hotel_staff_loans')
        .insert([{ ...loan, balance_amount: loan.total_amount, status: 'active' }])
        .select('*, staff:hotel_staff(first_name, last_name)')
        .single();

      if (error) throw error;
      return data as StaffLoan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-loans'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Loan issued successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to issue loan')),
  });
}

export function useUpdateLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (loan: LoanMutationInput & { id: string; current_total_amount: number; current_balance_amount: number }) => {
      const repaidAmount = Math.max(0, toNumber(loan.current_total_amount) - toNumber(loan.current_balance_amount));
      if (loan.total_amount < repaidAmount) {
        throw new Error(`Loan amount cannot be less than already recovered amount (${repaidAmount.toFixed(2)}).`);
      }

      if (loan.status === 'cancelled' && repaidAmount > 0) {
        throw new Error('Only untouched loans can be cancelled. This loan already has repayments.');
      }

      const newBalance = loan.status === 'cancelled'
        ? 0
        : Math.max(loan.total_amount - repaidAmount, 0);

      const nextStatus: StaffLoan['status'] = loan.status === 'cancelled'
        ? 'cancelled'
        : newBalance <= 0
          ? 'repaid'
          : 'active';

      const { data, error } = await apiClient
        .from('hotel_staff_loans')
        .update({
          staff_id: loan.staff_id,
          total_amount: loan.total_amount,
          balance_amount: newBalance,
          monthly_deduction: loan.monthly_deduction,
          reason: loan.reason,
          issued_date: loan.issued_date,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', loan.id)
        .select('*, staff:hotel_staff(first_name, last_name)')
        .single();

      if (error) throw error;
      return data as StaffLoan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-loans'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Loan updated successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to update loan')),
  });
}

export function useDeleteLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (loan: StaffLoan) => {
      if (toNumber(loan.balance_amount) !== toNumber(loan.total_amount)) {
        throw new Error('This loan already has repayments. Edit it instead of deleting it.');
      }

      const { error } = await apiClient.from('hotel_staff_loans').delete().eq('id', loan.id);
      if (error) throw error;
      return loan.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-loans'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Loan deleted successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to delete loan')),
  });
}

export function useDamages() {
  return useQuery({
    queryKey: ['hotel-damages'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_damages')
        .select('*, staff:hotel_staff(first_name, last_name), guest:hotel_guests(first_name, last_name)')
        .order('reported_at', { ascending: false });

      if (error) throw error;
      return data as Damage[];
    },
  });
}

export function useReportDamage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (damage: DamageInput) => {
      const { data, error } = await apiClient
        .from('hotel_damages')
        .insert([damage])
        .select('*, staff:hotel_staff(first_name, last_name), guest:hotel_guests(first_name, last_name)')
        .single();

      if (error) throw error;
      return data as Damage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-damages'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Damage reported successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to report damage')),
  });
}

export function useUpdateDamage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...damage }: DamageInput & { id: string }) => {
      const { data, error } = await apiClient
        .from('hotel_damages')
        .update(damage)
        .eq('id', id)
        .select('*, staff:hotel_staff(first_name, last_name), guest:hotel_guests(first_name, last_name)')
        .single();

      if (error) throw error;
      return data as Damage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-damages'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Damage updated successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to update damage')),
  });
}

export function useDeleteDamage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.from('hotel_damages').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-damages'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Damage deleted successfully');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to delete damage')),
  });
}

export function useStaffPayments() {
  return useQuery({
    queryKey: ['hotel-staff-payments'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_staff_payments')
        .select('*, staff:hotel_staff(first_name, last_name)')
        .order('payment_date', { ascending: false });

      if (error) throw error;
      return data as StaffPayment[];
    },
  });
}

export function useFinancialReport(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['hotel-financial-report', startDate, endDate],
    queryFn: async () => {
      const range = buildRange(startDate, endDate);

      const [invoices, restaurantOrders, expenses, damages, payroll, stockMovements, staffLoans] = await Promise.all([
        apiClient
          .from('hotel_invoices')
          .select('total_amount')
          .eq('payment_status', 'paid')
          .gte('created_at', range.startTimestamp)
          .lte('created_at', range.endTimestamp),
        apiClient
          .from('hotel_orders')
          .select('total_amount')
          .is('invoice_id', null)
          .in('status', ['settled', 'paid'])
          .gte('created_at', range.startTimestamp)
          .lte('created_at', range.endTimestamp),
        apiClient
          .from('hotel_expenses')
          .select('amount, category:hotel_expense_categories(name)')
          .gte('expense_date', range.startDate)
          .lte('expense_date', range.endDate),
        apiClient
          .from('hotel_damages')
          .select('damage_cost, status, charged_to_staff_id, charged_to_guest_id')
          .gte('reported_at', range.startTimestamp)
          .lte('reported_at', range.endTimestamp),
        apiClient
          .from('hotel_staff_payments')
          .select('net_amount, status')
          .gte('payment_date', range.startDate)
          .lte('payment_date', range.endDate),
        apiClient
          .from('hotel_ingredient_movements')
          .select('movement_type, total_cost')
          .gte('created_at', range.startTimestamp)
          .lte('created_at', range.endTimestamp),
        apiClient
          .from('hotel_staff_loans')
          .select('balance_amount, status')
          .lte('issued_date', range.endDate),
      ]);

      const invoiceRows = (invoices.data || []) as Array<{ total_amount: number }>;
      const orderRows = (restaurantOrders.data || []) as Array<{ total_amount: number }>;
      const expenseRows = (expenses.data || []) as Array<{ amount: number; category?: { name?: string } | null }>;
      const damageRows = (damages.data || []) as Array<{
        damage_cost: number;
        status: Damage['status'];
        charged_to_staff_id: string | null;
        charged_to_guest_id: string | null;
      }>;
      const payrollRows = (payroll.data || []) as Array<{ net_amount: number; status: StaffPayment['status'] }>;
      const stockRows = (stockMovements.data || []) as Array<{ movement_type: string; total_cost: number | null }>;
      const loanRows = (staffLoans.data || []) as Array<{ balance_amount: number; status: StaffLoan['status'] }>;

      const guestRevenue = invoiceRows.reduce((sum, row) => sum + toNumber(row.total_amount), 0);
      const restaurantRevenue = orderRows.reduce((sum, row) => sum + toNumber(row.total_amount), 0);
      const revenue = guestRevenue + restaurantRevenue;

      const staffAdvancesIssued = expenseRows
        .filter((row) => row.category?.name === 'Staff Loan/Advance')
        .reduce((sum, row) => sum + toNumber(row.amount), 0);

      const operatingExpenses = expenseRows
        .filter((row) => row.category?.name !== 'Staff Loan/Advance')
        .reduce((sum, row) => sum + toNumber(row.amount), 0);

      const recoverableDamages = damageRows
        .filter((row) => (row.charged_to_staff_id || row.charged_to_guest_id) && row.status !== 'written_off')
        .reduce((sum, row) => sum + toNumber(row.damage_cost), 0);

      const damagesExpense = damageRows
        .filter((row) => (!row.charged_to_staff_id && !row.charged_to_guest_id) || row.status === 'written_off')
        .reduce((sum, row) => sum + toNumber(row.damage_cost), 0);

      const payrollPaid = payrollRows
        .filter((row) => row.status === 'paid')
        .reduce((sum, row) => sum + toNumber(row.net_amount), 0);

      const pendingPayroll = payrollRows
        .filter((row) => row.status === 'pending')
        .reduce((sum, row) => sum + toNumber(row.net_amount), 0);

      const stockPurchases = stockRows
        .filter((row) => row.movement_type === 'in')
        .reduce((sum, row) => sum + toNumber(row.total_cost), 0);

      const stockConsumption = stockRows
        .filter((row) => row.movement_type === 'out')
        .reduce((sum, row) => sum + toNumber(row.total_cost), 0);

      const estimatedInventoryValue = Math.max(stockPurchases - stockConsumption, 0);
      const activeLoanReceivables = loanRows
        .filter((row) => row.status === 'active')
        .reduce((sum, row) => sum + toNumber(row.balance_amount), 0);

      const netProfit = revenue - (operatingExpenses + damagesExpense + payrollPaid + stockConsumption);
      const estimatedCashPosition = revenue - (operatingExpenses + payrollPaid + staffAdvancesIssued + stockPurchases);
      const totalAssets = estimatedCashPosition + activeLoanReceivables + recoverableDamages + estimatedInventoryValue;
      const totalLiabilities = pendingPayroll;
      const ownerEquity = totalAssets - totalLiabilities;

      return {
        revenue,
        guestRevenue,
        restaurantRevenue,
        operatingExpenses,
        staffAdvancesIssued,
        damagesExpense,
        recoverableDamages,
        payrollPaid,
        pendingPayroll,
        stockPurchases,
        stockConsumption,
        estimatedInventoryValue,
        activeLoanReceivables,
        totalAssets,
        totalLiabilities,
        ownerEquity,
        estimatedCashPosition,
        netProfit,
      } satisfies FinancialReport;
    },
  });
}

export function useProcessSalary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payment: SalaryMutationInput) => {
      const { data, error } = await apiClient.rpc('process_hotel_staff_payment', {
        p_staff_id: payment.staff_id,
        p_base_salary: payment.base_salary,
        p_bonus_amount: payment.bonus_amount,
        p_loan_deduction: payment.loan_deduction,
        p_other_deductions: payment.other_deductions,
        p_payment_month: payment.payment_month,
        p_payment_date: payment.payment_date,
        p_payment_method: payment.payment_method,
        p_status: payment.status,
        p_notes: payment.notes,
      });

      if (error) throw error;
      if (!data?.payment_id) throw new Error('Payment could not be created.');

      return fetchPaymentById(data.payment_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-payments'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-loans'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Salary payment processed');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to process salary payment')),
  });
}

export function useUpdateSalary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payment: SalaryMutationInput & { id: string }) => {
      const { data, error } = await apiClient.rpc('update_hotel_staff_payment', {
        p_payment_id: payment.id,
        p_staff_id: payment.staff_id,
        p_base_salary: payment.base_salary,
        p_bonus_amount: payment.bonus_amount,
        p_loan_deduction: payment.loan_deduction,
        p_other_deductions: payment.other_deductions,
        p_payment_month: payment.payment_month,
        p_payment_date: payment.payment_date,
        p_payment_method: payment.payment_method,
        p_status: payment.status,
        p_notes: payment.notes,
      });

      if (error) throw error;
      if (!data?.payment_id) throw new Error('Payment could not be updated.');

      return fetchPaymentById(data.payment_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-payments'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-loans'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Salary payment updated');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to update salary payment')),
  });
}

export function useDeleteSalary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await apiClient.rpc('delete_hotel_staff_payment', {
        p_payment_id: id,
      });

      if (error) throw error;
      if (!data?.deleted) throw new Error('Payment could not be deleted.');
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-payments'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-staff-loans'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-financial-report'] });
      toast.success('Salary payment deleted');
    },
    onError: (error: any) => toast.error(getErrorMessage(error, 'Failed to delete salary payment')),
  });
}
