-- Seed the admin user for our app
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
SET search_path = public, extensions;
DO $$
DECLARE
    v_email CONSTANT text := 'admin@admin.com';
    v_password CONSTANT text := '123456';
    v_user_id uuid;
BEGIN
    -- Ensure the manager role exists
    INSERT INTO public.role_permissions (role, pos_routes, hotel_routes, is_system, description)
    VALUES (
        'manager',
        ARRAY['/settings', '/reports', '/stock', '/products', '/loans', '/', '/pos', '/sales', '/customers', '/scanner', '/notifications'],
        ARRAY[
            '/hotel/settings',
            '/hotel/staff',
            '/hotel/attendance',
            '/hotel/shifts',
            '/hotel/shift-report',
            '/hotel/reports',
            '/hotel/billing',
            '/hotel/finance',
            '/hotel/service-menu',
            '/hotel/restaurant-dashboard',
            '/hotel',
            '/hotel/pos',
            '/hotel/rooms',
            '/hotel/tables',
            '/hotel/bookings',
            '/hotel/new-booking',
            '/hotel/check-in-out',
            '/hotel/guests',
            '/hotel/housekeeping'
        ],
        true,
        'Management and operational access'
    )
    ON CONFLICT (role) DO NOTHING;

    -- Create or update the admin user
    SELECT id
    INTO v_user_id
    FROM public.app_users
    WHERE lower(email) = lower(v_email)
    LIMIT 1;

    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid();

        INSERT INTO public.app_users (id, email, password_hash)
        VALUES (
            v_user_id,
            v_email,
            crypt(v_password, gen_salt('bf', 10))
        );
    ELSE
        UPDATE public.app_users
        SET password_hash = crypt(v_password, gen_salt('bf', 10)),
            updated_at = NOW()
        WHERE id = v_user_id;
    END IF;

    -- Assign the manager role
    INSERT INTO public.user_roles (user_id, role)
VALUES (v_user_id, 'manager')
ON CONFLICT (user_id, role) DO UPDATE
SET updated_at = NOW();

    -- Update or create the profile
    UPDATE public.profiles
    SET email = v_email,
        first_name = 'Hotel',
        last_name = 'Manager',
        updated_at = NOW()
    WHERE user_id = v_user_id;

    IF NOT FOUND THEN
        INSERT INTO public.profiles (user_id, email, first_name, last_name)
        VALUES (v_user_id, v_email, 'Hotel', 'Manager');
    END IF;
END
$$;
