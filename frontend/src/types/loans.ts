export interface CustomerLoan {
  id: string;
  customer_id: string;
  loan_number: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  interest_rate?: number;
  due_date?: string;
  status: 'active' | 'completed' | 'overdue' | 'cancelled';
  notes?: string;
  created_at: string;
  updated_at: string;
  customer?: {
    id: string;
    name: string;
    phone?: string;
  };
}

export interface LoanItem {
  id: string;
  loan_id: string;
  product_id: string;
  batch_id?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
  product?: {
    id: string;
    name: string;
  };
}

export interface LoanPayment {
  id: string;
  loan_id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  reference_number?: string;
  notes?: string;
  created_at: string;
}