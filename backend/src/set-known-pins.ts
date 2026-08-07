import './loadEnv.ts';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function setKnownPins() {
  console.log('Disabling pin hash trigger...');
  try {
    await pool.query('ALTER TABLE hotel_staff DISABLE TRIGGER trigger_hash_hotel_staff_pin');
    console.log('Setting pins to known plaintext values...');
    // Update admin@admin.com (manager) → pin 000001
    await pool.query("UPDATE hotel_staff SET pin = '000001' WHERE email = 'admin@admin.com'");
    // Update admin@system.com (admin) → pin 000002
    await pool.query("UPDATE hotel_staff SET pin = '000002' WHERE email = 'admin@system.com'");
    // Update waiter@admin.com (waiter_admin) → pin 000003
    await pool.query("UPDATE hotel_staff SET pin = '000003' WHERE email = 'waiter@admin.com'");
    console.log('Pins set! Re-enabling trigger...');
    await pool.query('ALTER TABLE hotel_staff ENABLE TRIGGER trigger_hash_hotel_staff_pin');
    console.log('Done! Verifying pins are now plaintext...');
    const verify = await pool.query(`SELECT email, pin FROM hotel_staff WHERE email IN ('admin@admin.com', 'admin@system.com', 'waiter@admin.com')`);
    console.log('Verify result:', verify.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

setKnownPins();
