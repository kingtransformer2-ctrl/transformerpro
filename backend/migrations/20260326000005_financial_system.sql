-- Migration for Professional Financial Budgeting (Expenses, Staff Loans, Damages)
-- Created: 2026-03-26

-- 1. Create Expense Categories
CREATE TABLE IF NOT EXISTS public.hotel_expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Expenses Table
CREATE TABLE IF NOT EXISTS public.hotel_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES public.hotel_expense_categories(id) ON DELETE SET NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    payment_method public.hotel_payment_method NOT NULL DEFAULT 'cash',
    reference_number TEXT, -- Invoice/Receipt number
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL, -- Who paid
    shift_id UUID, -- Link to shift for cash drawer tracking
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create Staff Loans & Advances Table
CREATE TABLE IF NOT EXISTS public.hotel_staff_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.hotel_staff(id) ON DELETE CASCADE,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    balance_amount NUMERIC NOT NULL DEFAULT 0,
    monthly_deduction NUMERIC NOT NULL DEFAULT 0, -- 0 means deduct everything next salary
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'repaid', 'cancelled')),
    reason TEXT,
    issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create Staff Payments Table (Salaries + Bonuses - Loan Deductions)
CREATE TABLE IF NOT EXISTS public.hotel_staff_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.hotel_staff(id) ON DELETE CASCADE,
    base_salary NUMERIC NOT NULL DEFAULT 0,
    bonus_amount NUMERIC DEFAULT 0,
    loan_deduction NUMERIC DEFAULT 0,
    other_deductions NUMERIC DEFAULT 0,
    net_amount NUMERIC NOT NULL DEFAULT 0,
    payment_month DATE NOT NULL, -- First day of the month
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method public.hotel_payment_method NOT NULL DEFAULT 'cash',
    status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Create Damages Table
CREATE TABLE IF NOT EXISTS public.hotel_damages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_name TEXT NOT NULL,
    location TEXT, -- Room number, Kitchen, Bar
    damage_cost NUMERIC NOT NULL DEFAULT 0,
    charged_to_staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL, -- If staff is paying for it
    charged_to_guest_id UUID REFERENCES public.hotel_guests(id) ON DELETE SET NULL, -- If guest is paying for it
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'repaired', 'written_off')),
    reported_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Enable RLS






-- 7. RLS Policies
DO $$ 
BEGIN
    -- Common policy for all financial tables
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hotel_expenses' AND policyname = 'Authenticated users can manage financials') THEN
        
        
        
        
        
    END IF;
END $$;

-- 8. Function to automatically create an expense when a loan is issued
CREATE OR REPLACE FUNCTION public.log_loan_as_expense()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.hotel_expenses (category_id, amount, description, expense_date, reference_number)
    VALUES (
        (SELECT id FROM public.hotel_expense_categories WHERE name = 'Staff Loan/Advance' LIMIT 1),
        NEW.total_amount,
        'Staff Loan Issued to ' || (SELECT first_name || ' ' || last_name FROM public.hotel_staff WHERE id = NEW.staff_id),
        NEW.issued_date,
        'LOAN-' || NEW.id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Trigger for loan logging
DROP TRIGGER IF EXISTS trigger_log_loan_as_expense ON public.hotel_staff_loans;
CREATE TRIGGER trigger_log_loan_as_expense
    AFTER INSERT ON public.hotel_staff_loans
    FOR EACH ROW
    EXECUTE FUNCTION public.log_loan_as_expense();

-- 10. Seed some categories
INSERT INTO public.hotel_expense_categories (name, description) VALUES 
('Inventory Purchase', 'Buying stock for kitchen or bar'),
('Utilities', 'Electricity, Water, Internet'),
('Staff Loan/Advance', 'Money given to staff before payday'),
('Maintenance', 'Repairs and cleaning supplies'),
('Marketing', 'Advertising and promotions'),
('Other', 'Miscellaneous costs')
ON CONFLICT (name) DO NOTHING;
