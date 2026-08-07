-- Finance integrity and reporting fixes
-- Created: 2026-07-24

BEGIN;

CREATE TABLE IF NOT EXISTS public.hotel_staff_loan_repayments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.hotel_staff_payments(id) ON DELETE CASCADE,
    loan_id UUID NOT NULL REFERENCES public.hotel_staff_loans(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (payment_id, loan_id)
);

CREATE INDEX IF NOT EXISTS idx_hotel_staff_loan_repayments_payment_id
    ON public.hotel_staff_loan_repayments(payment_id);

CREATE INDEX IF NOT EXISTS idx_hotel_staff_loan_repayments_loan_id
    ON public.hotel_staff_loan_repayments(loan_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_staff_payments_staff_month
    ON public.hotel_staff_payments(staff_id, payment_month);

CREATE OR REPLACE FUNCTION public.sync_staff_loan_expense()
RETURNS TRIGGER AS $$
DECLARE
    v_category_id UUID;
    v_description TEXT;
BEGIN
    SELECT id
      INTO v_category_id
      FROM public.hotel_expense_categories
     WHERE name = 'Staff Loan/Advance'
     LIMIT 1;

    IF v_category_id IS NULL THEN
        INSERT INTO public.hotel_expense_categories (name, description)
        VALUES ('Staff Loan/Advance', 'Money given to staff before payday')
        ON CONFLICT (name) DO UPDATE
            SET description = EXCLUDED.description
        RETURNING id INTO v_category_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.hotel_expenses
         WHERE reference_number = 'LOAN-' || OLD.id;
        RETURN OLD;
    END IF;

    v_description := 'Staff Loan Issued to ' || COALESCE(
        (
            SELECT trim(concat_ws(' ', first_name, last_name))
              FROM public.hotel_staff
             WHERE id = NEW.staff_id
             LIMIT 1
        ),
        'Unknown Staff'
    );

    UPDATE public.hotel_expenses
       SET category_id = v_category_id,
           amount = NEW.total_amount,
           description = v_description,
           expense_date = NEW.issued_date,
           staff_id = NEW.staff_id
     WHERE reference_number = 'LOAN-' || NEW.id;

    IF NOT FOUND THEN
        INSERT INTO public.hotel_expenses (
            category_id,
            amount,
            description,
            expense_date,
            reference_number,
            staff_id
        )
        VALUES (
            v_category_id,
            NEW.total_amount,
            v_description,
            NEW.issued_date,
            'LOAN-' || NEW.id,
            NEW.staff_id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_loan_as_expense ON public.hotel_staff_loans;
DROP TRIGGER IF EXISTS trigger_sync_staff_loan_expense ON public.hotel_staff_loans;

CREATE TRIGGER trigger_sync_staff_loan_expense
    AFTER INSERT OR UPDATE OR DELETE ON public.hotel_staff_loans
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_staff_loan_expense();

CREATE OR REPLACE FUNCTION public.apply_staff_payment_loan_allocations(
    p_payment_id UUID,
    p_staff_id UUID,
    p_requested_deduction NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
    v_remaining NUMERIC := GREATEST(COALESCE(p_requested_deduction, 0), 0);
    v_applied NUMERIC := 0;
    v_loan RECORD;
    v_deduction NUMERIC;
BEGIN
    IF v_remaining <= 0 THEN
        RETURN 0;
    END IF;

    FOR v_loan IN
        SELECT id, balance_amount
          FROM public.hotel_staff_loans
         WHERE staff_id = p_staff_id
           AND status = 'active'
           AND balance_amount > 0
         ORDER BY issued_date ASC, created_at ASC
    LOOP
        EXIT WHEN v_remaining <= 0;

        v_deduction := LEAST(v_loan.balance_amount, v_remaining);

        UPDATE public.hotel_staff_loans
           SET balance_amount = balance_amount - v_deduction,
               status = CASE
                   WHEN balance_amount - v_deduction <= 0 THEN 'repaid'
                   ELSE 'active'
               END,
               updated_at = now()
         WHERE id = v_loan.id;

        INSERT INTO public.hotel_staff_loan_repayments (payment_id, loan_id, amount)
        VALUES (p_payment_id, v_loan.id, v_deduction);

        v_remaining := v_remaining - v_deduction;
        v_applied := v_applied + v_deduction;
    END LOOP;

    RETURN v_applied;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.reverse_staff_payment_loan_allocations(
    p_payment_id UUID
)
RETURNS NUMERIC AS $$
DECLARE
    v_allocation RECORD;
    v_reversed NUMERIC := 0;
BEGIN
    FOR v_allocation IN
        SELECT loan_id, amount
          FROM public.hotel_staff_loan_repayments
         WHERE payment_id = p_payment_id
         ORDER BY created_at DESC, id DESC
    LOOP
        UPDATE public.hotel_staff_loans
           SET balance_amount = balance_amount + v_allocation.amount,
               status = 'active',
               updated_at = now()
         WHERE id = v_allocation.loan_id;

        v_reversed := v_reversed + v_allocation.amount;
    END LOOP;

    DELETE FROM public.hotel_staff_loan_repayments
     WHERE payment_id = p_payment_id;

    RETURN v_reversed;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.process_hotel_staff_payment(
    p_staff_id UUID,
    p_base_salary NUMERIC,
    p_bonus_amount NUMERIC,
    p_loan_deduction NUMERIC,
    p_other_deductions NUMERIC,
    p_payment_month DATE,
    p_payment_date DATE,
    p_payment_method public.hotel_payment_method,
    p_status TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_payment_id UUID;
    v_applied_deduction NUMERIC;
    v_net_amount NUMERIC;
BEGIN
    INSERT INTO public.hotel_staff_payments (
        staff_id,
        base_salary,
        bonus_amount,
        loan_deduction,
        other_deductions,
        net_amount,
        payment_month,
        payment_date,
        payment_method,
        status,
        notes
    )
    VALUES (
        p_staff_id,
        COALESCE(p_base_salary, 0),
        COALESCE(p_bonus_amount, 0),
        0,
        COALESCE(p_other_deductions, 0),
        0,
        p_payment_month,
        COALESCE(p_payment_date, CURRENT_DATE),
        COALESCE(p_payment_method, 'cash'),
        COALESCE(p_status, 'paid'),
        NULLIF(trim(COALESCE(p_notes, '')), '')
    )
    RETURNING id INTO v_payment_id;

    v_applied_deduction := public.apply_staff_payment_loan_allocations(
        v_payment_id,
        p_staff_id,
        COALESCE(p_loan_deduction, 0)
    );

    v_net_amount := COALESCE(p_base_salary, 0)
        + COALESCE(p_bonus_amount, 0)
        - COALESCE(p_other_deductions, 0)
        - COALESCE(v_applied_deduction, 0);

    UPDATE public.hotel_staff_payments
       SET loan_deduction = COALESCE(v_applied_deduction, 0),
           net_amount = v_net_amount
     WHERE id = v_payment_id;

    RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_hotel_staff_payment(
    p_payment_id UUID,
    p_staff_id UUID,
    p_base_salary NUMERIC,
    p_bonus_amount NUMERIC,
    p_loan_deduction NUMERIC,
    p_other_deductions NUMERIC,
    p_payment_month DATE,
    p_payment_date DATE,
    p_payment_method public.hotel_payment_method,
    p_status TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_payment RECORD;
    v_applied_deduction NUMERIC;
    v_net_amount NUMERIC;
BEGIN
    SELECT *
      INTO v_payment
      FROM public.hotel_staff_payments
     WHERE id = p_payment_id
     LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff payment % not found', p_payment_id;
    END IF;

    PERFORM public.reverse_staff_payment_loan_allocations(p_payment_id);

    UPDATE public.hotel_staff_payments
       SET staff_id = p_staff_id,
           base_salary = COALESCE(p_base_salary, 0),
           bonus_amount = COALESCE(p_bonus_amount, 0),
           loan_deduction = 0,
           other_deductions = COALESCE(p_other_deductions, 0),
           net_amount = 0,
           payment_month = p_payment_month,
           payment_date = COALESCE(p_payment_date, CURRENT_DATE),
           payment_method = COALESCE(p_payment_method, 'cash'),
           status = COALESCE(p_status, 'paid'),
           notes = NULLIF(trim(COALESCE(p_notes, '')), '')
     WHERE id = p_payment_id;

    v_applied_deduction := public.apply_staff_payment_loan_allocations(
        p_payment_id,
        p_staff_id,
        COALESCE(p_loan_deduction, 0)
    );

    v_net_amount := COALESCE(p_base_salary, 0)
        + COALESCE(p_bonus_amount, 0)
        - COALESCE(p_other_deductions, 0)
        - COALESCE(v_applied_deduction, 0);

    UPDATE public.hotel_staff_payments
       SET loan_deduction = COALESCE(v_applied_deduction, 0),
           net_amount = v_net_amount
     WHERE id = p_payment_id;

    RETURN p_payment_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.delete_hotel_staff_payment(
    p_payment_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    PERFORM public.reverse_staff_payment_loan_allocations(p_payment_id);

    DELETE FROM public.hotel_staff_payments
     WHERE id = p_payment_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMIT;
