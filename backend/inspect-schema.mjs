import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  const tables = ['hotel_table_sessions','hotel_table_session_seats','hotel_orders','hotel_order_items','hotel_payments','hotel_tables'];
  for (const t of tables) {
    const res = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default 
       FROM information_schema.columns 
       WHERE table_name = $1 
       ORDER BY ordinal_position`,
      [t]
    );
    console.log('\n=== ' + t + ' ===');
    res.rows.forEach(r => console.log(r.column_name + ' | ' + r.data_type + ' | nullable=' + r.is_nullable + ' | default=' + (r.column_default || '')));
  }
  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });