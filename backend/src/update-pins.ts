import './loadEnv.ts';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function updatePins() {
  console.log('Updating staff pins to known values...');
  try {
    // Update admin@admin.com (manager)
    await pool.query(
      "UPDATE hotel_staff SET pin = '000001' WHERE email = 'admin@admin.com'"
    );
    // Update admin@system.com (admin)
    await pool.query(
      "UPDATE hotel_staff SET pin = '000002' WHERE email = 'admin@system.com'"
    );
    // Update waiter@admin.com (waiter_admin)
    await pool.query(
      "UPDATE hotel_staff SET pin = '000003' WHERE email = 'waiter@admin.com'"
    );
    console.log('Pins updated successfully!');
    // Verify
    const result = await pool.query('SELECT email, pin FROM hotel_staff WHERE email IN (\'admin@admin.com\', \'admin@system.com\', \'waiter@admin.com\')');
    console.log('Updated pins:', result.rows);
  } catch (err) {
    console.error('Error updating pins:', err);
  } finally {
    await pool.end();
  }
}

updatePins();
