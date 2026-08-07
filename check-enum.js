const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query("SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'staff_role') ORDER BY enumlabel")
  .then(r => {
    console.log('Current staff_role values:');
    r.rows.forEach(row => console.log(' -', row.enumlabel));
    pool.end();
  })
  .catch(e => console.error(e));