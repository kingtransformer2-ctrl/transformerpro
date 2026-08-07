import fs from 'fs';
import path from 'path';

const migrationsDir = path.join(process.cwd(), 'migrations');

console.log('Cleaning migration files...');

const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.startsWith('00')); // Skip our custom migrations

for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    console.log(`Processing: ${file}`);

    // Remove ENABLE ROW LEVEL SECURITY
    content = content.replace(/ALTER TABLE.*ENABLE ROW LEVEL SECURITY;/g, '');
    content = content.replace(/ALTER TABLE.*DISABLE ROW LEVEL SECURITY;/g, '');
    
    // Remove CREATE POLICY statements
    content = content.replace(/CREATE POLICY[\s\S]*?;\s*$/gm, '');
    
    // Remove auth. references
    // Note: auth.users references will need to be handled carefully
    // For now, let's just log them
    if (content.includes('auth.users') || content.includes('auth.uid()')) {
        console.warn(`  WARNING: Found auth references in ${file}`);
    }
    
    fs.writeFileSync(filePath, content);
}

console.log('Migration files cleaned!');
