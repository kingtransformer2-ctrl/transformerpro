DO $$
BEGIN
  -- Hotel Staff Shifts
  DROP POLICY IF EXISTS "Authenticated users can manage shifts" ON public.hotel_staff_shifts;
  
  -- Hotel Shift Logs
  DROP POLICY IF EXISTS "Authenticated users can manage shift logs" ON public.hotel_shift_logs;
  
  -- Hotel Shift Transactions
  DROP POLICY IF EXISTS "Authenticated users can manage shift transactions" ON public.hotel_shift_transactions;
  
END $$;
