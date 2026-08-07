-- Fix RLS policies for settings and company_profile tables

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view settings" ON public.settings;
DROP POLICY IF EXISTS "Users can insert settings" ON public.settings;
DROP POLICY IF EXISTS "Users can update settings" ON public.settings;
DROP POLICY IF EXISTS "Users can delete settings" ON public.settings;

DROP POLICY IF EXISTS "Users can view company profile" ON public.company_profile;
DROP POLICY IF EXISTS "Users can insert company profile" ON public.company_profile;
DROP POLICY IF EXISTS "Users can update company profile" ON public.company_profile;
DROP POLICY IF EXISTS "Users can delete company profile" ON public.company_profile;

-- Create proper RLS policies for settings table




-- Create proper RLS policies for company_profile table



