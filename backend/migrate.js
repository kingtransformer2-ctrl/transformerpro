import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set in backend/.env');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function runMigrations() {
    console.log('Running migrations...');
    
    const client = await pool.connect();
    
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                run_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);
        
        const migrationsDir = path.join(__dirname, 'migrations');
        if (!fs.existsSync(migrationsDir)) {
          throw new Error('Migrations directory not found: ' + migrationsDir);
        }
        const files = fs.readdirSync(migrationsDir)
            .filter((f) => f.endsWith('.sql'))
            .sort();
        
        for (const file of files) {
            const result = await client.query(
                'SELECT * FROM migrations WHERE name = $1',
                [file]
            );
            
            if (result.rows.length === 0) {
    console.log(`Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await client.query('SET session_replication_role = replica;');
    try {
        await client.query(sql);
    } finally {
        await client.query('SET session_replication_role = DEFAULT;');
    }
    await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [file]
    );
    console.log(`Applied migration: ${file}`);
}
else {
                console.log(`Skipping already applied migration: ${file}`);
            }
        }
        
        console.log('All migrations completed successfully!');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        client.release();
        pool.end();
    }
}

runMigrations();
