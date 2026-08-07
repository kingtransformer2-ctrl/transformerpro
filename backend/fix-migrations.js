import fs from 'fs';
import path from 'path';

const migrationsDir = path.join(process.cwd(), 'migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

let totalFixed = 0;

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // 1. Strip BOM (byte order mark) if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  // 2. Remove ALTER PUBLICATION supabase_realtime lines (Realtime not used in Node.js backend)
  content = content.replace(/^.*ALTER PUBLICATION\s+supabase_realtime.*$\n?/gim, '');

  // 3. Remove INSERT/UPDATE statements targeting auth.config (Supabase project settings, not app data)
  content = content.replace(/(INSERT INTO\s+auth\.config[\s\S]*?;)/gim, '');
  content = content.replace(/(UPDATE\s+auth\.config[\s\S]*?;)/gim, '');

  // 4. Remove any leftover CREATE POLICY statements (RLS policies, no direct Node.js equivalent)
  content = content.replace(/(CREATE POLICY[\s\S]*?;)/gim, '');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed: ${file}`);
    totalFixed++;
  }
}

console.log(`\nDone. Fixed ${totalFixed} file(s) out of ${files.length}.`);