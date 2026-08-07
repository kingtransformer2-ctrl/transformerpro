import './loadEnv.ts';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function test() {
  console.log('Connecting to DB...');
  try {
    const result = await pool.query('SELECT id, email, role, pin, is_active FROM hotel_staff');
    console.log('Found staff:', result.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

test();
