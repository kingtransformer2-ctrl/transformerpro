import './loadEnv.ts';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkTriggers() {
  try {
    console.log('Checking triggers on hotel_staff...');
    const triggerResult = await pool.query(`
      SELECT tgname, tgtype, pg_get_triggerdef(t.oid) 
      FROM pg_trigger t 
      JOIN pg_class c ON t.tgrelid = c.oid 
      WHERE c.relname = 'hotel_staff'
    `);
    console.log('Triggers on hotel_staff:', triggerResult.rows);

    console.log('\nChecking hotel_staff table schema...');
    const schemaResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'hotel_staff'
    `);
    console.log('hotel_staff columns:', schemaResult.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkTriggers();
