const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  // 1. Check hotel_staff data integrity
  const staff = await pool.query('SELECT id, email, role, pin, is_active, allowed_hotel_routes FROM public.hotel_staff ORDER BY email');
  console.log('=== HOTEL_STAFF ROWS ===');
  console.log('Count:', staff.rows.length);
  staff.rows.forEach(r => {
    console.log(JSON.stringify({
      id: r.id,
      email: r.email,
      role: r.role,
      pin_prefix: r.pin ? r.pin.substring(0, 4) : null,
      pin_type: r.pin ? (r.pin.startsWith('$2') ? 'hashed' : 'plaintext') : 'null',
      is_active: r.is_active,
      allowed_hotel_routes: r.allowed_hotel_routes
    }));
  });

  // 2. Check for placeholder/orphaned UUIDs in hotel_orders
  const orders = await pool.query("SELECT waiter_id, staff_id, COUNT(*) FROM public.hotel_orders WHERE waiter_id = 'a0000000-0000-4000-8000-000000000003' OR staff_id = 'a0000000-0000-4000-8000-000000000003' GROUP BY waiter_id, staff_id");
  console.log('\n=== ORPHANED HOTEL_ORDERS ===');
  console.log('Count:', orders.rows.length);
  orders.rows.forEach(r => console.log(JSON.stringify(r)));

  // 3. Check role_permissions landing_page
  const perms = await pool.query('SELECT role, landing_page, is_system FROM public.role_permissions ORDER BY role');
  console.log('\n=== ROLE_PERMISSIONS ===');
  perms.rows.forEach(r => console.log(JSON.stringify(r)));

  // 4. Check foreign keys referencing hotel_staff
  const fks = await pool.query(`
    SELECT tc.constraint_name, tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.references_table = 'hotel_staff'
  `);
  console.log('\n=== FOREIGN KEYS REFERENCING HOTEL_STAFF ===');
  fks.rows.forEach(r => console.log(JSON.stringify(r)));

  // 5. Check for broken hotel_orders references
  const broken = await pool.query(`
    SELECT COUNT(*) as cnt FROM public.hotel_orders ho
    LEFT JOIN public.hotel_staff hs ON ho.waiter_id = hs.id
    WHERE ho.waiter_id IS NOT NULL AND hs.id IS NULL
  `);
  console.log('\n=== BROKEN waiter_id REFS ===', broken.rows[0]);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });