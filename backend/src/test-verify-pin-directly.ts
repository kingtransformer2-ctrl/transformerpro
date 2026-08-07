import './loadEnv.ts';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function testVerifyPin(pin: string) {
  console.log('Testing pin:', pin);
  // Get all active staff with non-null pins
  const result = await pool.query(
    'SELECT id, first_name, last_name, email, phone, role, pin, allowed_hotel_routes, is_active, pin_failed_attempts, pin_locked_until FROM public.hotel_staff WHERE is_active = true AND pin IS NOT NULL'
  );
  console.log('Found staff count:', result.rows.length);
  let matchedStaff = null;
  for (const staff of result.rows) {
    console.log('Checking staff:', staff.email, 'stored pin:', staff.pin);
    let isMatch = false;
    if (staff.pin.startsWith('$2a$') || staff.pin.startsWith('$2b$') || staff.pin.startsWith('$2y$')) {
      isMatch = await bcrypt.compare(pin, staff.pin);
    } else {
      isMatch = staff.pin === pin;
    }
    console.log('Match result:', isMatch);
    if (isMatch) {
      matchedStaff = staff;
      break;
    }
  }
  if (matchedStaff) {
    console.log('Success! Found staff:', matchedStaff.email);
  } else {
    console.log('No match found');
  }
}

testVerifyPin('000001').finally(() => pool.end());
