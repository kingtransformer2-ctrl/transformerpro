import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

type QueryOptions = {
  select?: string;
  eq?: Record<string, any>;
  in?: Record<string, any[]>;
  gte?: Record<string, any>;
  lte?: Record<string, any>;
  gt?: Record<string, any>;
  lt?: Record<string, any>;
  is?: Record<string, any>;
  order?: Record<string, { ascending?: boolean }>;
  limit?: number;
  single?: boolean;
};

type ParsedRelation = {
  alias: string;
  table: string;
  innerSelect: string;
  parsedInnerSelect: ParsedSelect;
};

type ParsedSelect = {
  columns: string[];
  relations: ParsedRelation[];
};

type ForeignKeyRow = {
  child_table: string;
  child_column: string;
  parent_table: string;
  parent_column: string;
};

let foreignKeyCache: ForeignKeyRow[] | null = null;

const singularize = (value: string) => value.replace(/s$/, '');

const splitTopLevel = (input: string) => {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of input) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;

    if (char === ',' && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
};

const parseRelationToken = (token: string): ParsedRelation | null => {
  // The optional (?:![A-Za-z_][A-Za-z0-9_]*)? accepts (and discards) Supabase-style
  // explicit FK hints like "waiter:hotel_staff!hotel_orders_waiter_id_fkey(...)".
  // We don't need the constraint name — resolveRelation() discovers the FK itself
  // by introspecting pg_constraint.
  const withAliasMatch = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)(?:![A-Za-z_][A-Za-z0-9_]*)?\s*\(([\s\S]*)\)$/);
  if (withAliasMatch) {
    const [, alias, table, innerSelect] = withAliasMatch;
    return {
      alias,
      table,
      innerSelect,
      parsedInnerSelect: parseSelectSpec(innerSelect),
    };
  }

  const withoutAliasMatch = token.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:![A-Za-z_][A-Za-z0-9_]*)?\s*\(([\s\S]*)\)$/);
  if (withoutAliasMatch) {
    const [, table, innerSelect] = withoutAliasMatch;
    return {
      alias: table,
      table,
      innerSelect,
      parsedInnerSelect: parseSelectSpec(innerSelect),
    };
  }

  return null;
};

function parseSelectSpec(select?: string): ParsedSelect {
  if (!select || select.trim() === '' || select.trim() === '*') {
    return { columns: ['*'], relations: [] };
  }

  const columns: string[] = [];
  const relations: ParsedRelation[] = [];

  for (const token of splitTopLevel(select)) {
    const relation = parseRelationToken(token);
    if (relation) {
      relations.push(relation);
      continue;
    }

    if (!token) continue;

    const columnAliasMatch = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (columnAliasMatch) {
      const [, alias, expr] = columnAliasMatch;
      const openParens = (expr.match(/\(/g) || []).length;
      const closeParens = (expr.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        throw new Error(`Invalid select token "${token}" in select: "${select}" (unbalanced parentheses)`);
      }
      columns.push(`${expr} AS ${alias}`);
      continue;
    }

    if (token.includes(':')) {
      throw new Error(`Invalid select token "${token}" in select: "${select}"`);
    }

    columns.push(token);
  }

  return {
    columns: columns.length > 0 ? columns : ['*'],
    relations,
  };
}

async function getForeignKeys() {
  if (foreignKeyCache) {
    return foreignKeyCache;
  }

  const result = await pool.query<ForeignKeyRow>(`
    SELECT
      child.relname AS child_table,
      child_att.attname AS child_column,
      parent.relname AS parent_table,
      parent_att.attname AS parent_column
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN unnest(c.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN unnest(c.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = ck.ord
    JOIN pg_attribute child_att
      ON child_att.attrelid = c.conrelid
     AND child_att.attnum = ck.attnum
    JOIN pg_attribute parent_att
      ON parent_att.attrelid = c.confrelid
     AND parent_att.attnum = pk.attnum
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE c.contype = 'f'
      AND child_ns.nspname = 'public'
      AND parent_ns.nspname = 'public'
  `);

  foreignKeyCache = result.rows;
  return foreignKeyCache;
}

async function resolveRelation(
  parentTable: string,
  relationTable: string,
  alias: string
) {
  const foreignKeys = await getForeignKeys();

  const outgoing = foreignKeys.filter(
    (fk) => fk.child_table === parentTable && fk.parent_table === relationTable
  );
  const incoming = foreignKeys.filter(
    (fk) => fk.child_table === relationTable && fk.parent_table === parentTable
  );

  const aliasKey = alias.toLowerCase();
  const relationKey = singularize(relationTable.replace(/^hotel_/, '').replace(/^public\./, ''));
  const parentKey = singularize(parentTable.replace(/^hotel_/, '').replace(/^public\./, ''));

  const scoreFk = (column: string) => {
    const normalized = column.toLowerCase();
    let score = 0;
    if (normalized.includes(aliasKey)) score += 3;
    if (normalized.includes(relationKey)) score += 2;
    if (normalized.includes(parentKey)) score += 1;
    return score;
  };

  if (outgoing.length > 0) {
    const selected = [...outgoing].sort((a, b) => scoreFk(b.child_column) - scoreFk(a.child_column))[0];
    return {
      type: 'single' as const,
      localKey: selected.child_column,
      remoteKey: selected.parent_column,
    };
  }

  if (incoming.length > 0) {
    const selected = [...incoming].sort((a, b) => scoreFk(b.child_column) - scoreFk(a.child_column))[0];
    return {
      type: 'many' as const,
      localKey: selected.parent_column,
      remoteKey: selected.child_column,
    };
  }

  const fallbackSingleKeys = [
    `${alias}_id`,
    `${relationKey}_id`,
  ];

  for (const key of fallbackSingleKeys) {
    return {
      type: 'single' as const,
      localKey: key,
      remoteKey: 'id',
    };
  }

  return null;
}

function buildSql(table: string, query: QueryOptions, parsedSelect: ParsedSelect) {
  const {
    eq = {},
    in: in_ = {},
    gte = {},
    lte = {},
    gt = {},
    lt = {},
    is = {},
    order = {},
    limit,
  } = query;

  let sql = `SELECT ${parsedSelect.columns.join(', ')} FROM ${table}`;
  const values: any[] = [];
  const conditions: string[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(eq)) {
    conditions.push(`${key} = $${paramIndex++}`);
    values.push(value);
  }

  for (const [key, value] of Object.entries(in_)) {
    const list = value as any[];
    if (list.length === 0) {
      conditions.push('1 = 0');
      continue;
    }
    const placeholders = list.map(() => `$${paramIndex++}`).join(', ');
    conditions.push(`${key} IN (${placeholders})`);
    values.push(...list);
  }

  for (const [key, value] of Object.entries(gte)) {
    conditions.push(`${key} >= $${paramIndex++}`);
    values.push(value);
  }

  for (const [key, value] of Object.entries(lte)) {
    conditions.push(`${key} <= $${paramIndex++}`);
    values.push(value);
  }

  for (const [key, value] of Object.entries(gt)) {
    conditions.push(`${key} > $${paramIndex++}`);
    values.push(value);
  }

  for (const [key, value] of Object.entries(lt)) {
    conditions.push(`${key} < $${paramIndex++}`);
    values.push(value);
  }

  for (const [key, value] of Object.entries(is)) {
    if (value === null) {
      conditions.push(`${key} IS NULL`);
    } else {
      conditions.push(`${key} IS NOT NULL`);
    }
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  const orderEntries = Object.entries(order);
  if (orderEntries.length > 0) {
    const orderClauses = orderEntries.map(([key, value]) => {
      const ascending = value.ascending !== false;
      return `${key} ${ascending ? 'ASC' : 'DESC'}`;
    });
    sql += ` ORDER BY ${orderClauses.join(', ')}`;
  }

  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    sql += ` LIMIT ${Math.floor(limit)}`;
  }

  return { sql, values };
}

async function attachRelations(
  table: string,
  rows: any[],
  relations: ParsedRelation[]
) {
  if (rows.length === 0 || relations.length === 0) {
    return rows;
  }

  for (const relation of relations) {
    const mapping = await resolveRelation(table, relation.table, relation.alias);

    if (!mapping) {
      for (const row of rows) {
        row[relation.alias] = null;
      }
      continue;
    }

    if (mapping.type === 'single') {
      const relationIds = Array.from(
        new Set(rows.map((row) => row[mapping.localKey]).filter((value) => value != null))
      );

      if (relationIds.length === 0) {
        for (const row of rows) {
          row[relation.alias] = null;
        }
        continue;
      }

      const relatedRows = await runSelectQuery(
        relation.table,
        {
          select: relation.innerSelect,
          in: { [mapping.remoteKey]: relationIds },
        },
        relation.parsedInnerSelect
      );

      const relatedByKey = new Map(relatedRows.map((row: any) => [row[mapping.remoteKey], row]));
      for (const row of rows) {
        row[relation.alias] = relatedByKey.get(row[mapping.localKey]) || null;
      }
      continue;
    }

    const parentIds = Array.from(
      new Set(rows.map((row) => row[mapping.localKey]).filter((value) => value != null))
    );

    if (parentIds.length === 0) {
      for (const row of rows) {
        row[relation.alias] = [];
      }
      continue;
    }

    const relatedRows = await runSelectQuery(
      relation.table,
      {
        select: relation.innerSelect,
        in: { [mapping.remoteKey]: parentIds },
      },
      relation.parsedInnerSelect
    );

    const grouped = new Map<any, any[]>();
    for (const relatedRow of relatedRows) {
      const key = relatedRow[mapping.remoteKey];
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(relatedRow);
    }

    for (const row of rows) {
      row[relation.alias] = grouped.get(row[mapping.localKey]) || [];
    }
  }

  return rows;
}

async function runSelectQuery(
  table: string,
  query: QueryOptions,
  parsedSelect?: ParsedSelect
) {
  const finalParsedSelect = parsedSelect || parseSelectSpec(query.select);
  const { sql, values } = buildSql(table, query, finalParsedSelect);
  
  console.log(`[queryBuilder] SQL: ${sql}`, { table, values: values.map(v => typeof v === 'string' && v.length > 50 ? v.substring(0, 50) + '...' : v) });
  
  try {
    const { rows } = await pool.query(sql, values);
    await attachRelations(table, rows, finalParsedSelect.relations);
    return rows;
  } catch (err: any) {
    console.error(`[queryBuilder] SQL Error on ${table}:`, { sql, values, error: err.message });
    throw err;
  }
}

function sanitizeMutationRow(
  table: string,
  row: Record<string, any>,
  action: 'insert' | 'update' | 'upsert'
) {
  const sanitizedEntries = Object.entries(row).flatMap(([key, rawValue]) => {
    if (rawValue === undefined) {
      return [];
    }

    if (table === 'hotel_tables' && key === 'status') {
      const normalizedStatus =
        typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : rawValue;
      const allowedStatuses = new Set(['free', 'reserved', 'occupied', 'cleaning']);

      if (!normalizedStatus || !allowedStatuses.has(String(normalizedStatus))) {
        // For any action (insert, update, upsert), default to 'free'
        // if the status value is invalid/empty/null to prevent PostgreSQL
        // enum errors (invalid input value for enum hotel_table_status)
        return [];
      }

      return [['status', normalizedStatus]];
    }

    return [[key, rawValue]];
  });

  return Object.fromEntries(sanitizedEntries);
}

export async function executeQuery(table: string, query: any) {
  const parsedSelect = parseSelectSpec(query?.select || '*');
  const rows = await runSelectQuery(table, query || {}, parsedSelect);

  if (query?.single) {
    return rows.length > 0 ? rows[0] : null;
  }

  return rows;
}

export async function executeInsert(table: string, data: any | any[]) {
  const isArray = Array.isArray(data);
  const rows = (isArray ? data : [data]).map((row) => sanitizeMutationRow(table, row, 'insert'));
  if (rows.length === 0) return [];

  const keys = Object.keys(rows[0]);
  const placeholders = rows.map((_, i) => 
    '(' + keys.map((_, j) => `$${i * keys.length + j + 1}`).join(', ') + ')'
  ).join(', ');

  const values = rows.flatMap(row => keys.map(k => row[k]));
  
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES ${placeholders} RETURNING *`;
  const res = await pool.query(sql, values);
  return isArray ? res.rows : res.rows[0];
}

export async function executeUpdate(table: string, data: any, eq: Record<string, any>, in_: Record<string, any[]> = {}) {
  const sanitizedData = sanitizeMutationRow(table, data || {}, 'update');
  
  // Extra defensive sanitization for hotel_tables status
  if (table === 'hotel_tables') {
    const statusVal = (sanitizedData.status || '').toString().trim().toLowerCase();
    if (!['free','reserved','occupied','cleaning'].includes(statusVal)) {
      // Strip status entirely if empty/invalid - let DB use its default
      delete sanitizedData.status;
    } else {
      sanitizedData.status = statusVal;
    }
  }
  
  const keys = Object.keys(sanitizedData);
  if (keys.length === 0) {
    return [];
  }
  const setSql = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map(k => sanitizedData[k]);
  
  let conditions: string[] = [];
  let paramIndex = keys.length + 1;
  
  for (const [k, v] of Object.entries(eq)) {
    conditions.push(`${k} = $${paramIndex++}`);
    values.push(v);
  }

  for (const [k, v] of Object.entries(in_)) {
    if (v.length > 0) {
      const placeholders = v.map(() => `$${paramIndex++}`).join(', ');
      conditions.push(`${k} IN (${placeholders})`);
      values.push(...v);
    }
  }

  if (conditions.length === 0) {
    throw new Error(`Refusing to update ${table} without filters`);
  }

  const sql = `UPDATE ${table} SET ${setSql} WHERE ${conditions.join(' AND ')} RETURNING *`;
  const res = await pool.query(sql, values);
  return res.rows;
}

export async function executeUpsert(
  table: string,
  data: any | any[],
  options: { onConflict?: string | string[] } = {}
) {
  const isArray = Array.isArray(data);
  const rows = (isArray ? data : [data]).map((row) => sanitizeMutationRow(table, row, 'upsert'));

  if (rows.length === 0) {
    return [];
  }

  const keys = Object.keys(rows[0]);
  const placeholders = rows
    .map((_, rowIndex) => `(${keys.map((_, keyIndex) => `$${rowIndex * keys.length + keyIndex + 1}`).join(', ')})`)
    .join(', ');
  const values = rows.flatMap((row) => keys.map((key) => row[key]));

  const conflictColumns = Array.isArray(options.onConflict)
    ? options.onConflict
    : typeof options.onConflict === 'string'
      ? options.onConflict.split(',').map((value) => value.trim()).filter(Boolean)
      : [];

  if (conflictColumns.length === 0) {
    return executeInsert(table, data);
  }

  const updateColumns = keys.filter((key) => !conflictColumns.includes(key));
  const conflictClause = `ON CONFLICT (${conflictColumns.join(', ')})`;
  const updateClause = updateColumns.length > 0
    ? `DO UPDATE SET ${updateColumns.map((key) => `${key} = EXCLUDED.${key}`).join(', ')}`
    : 'DO NOTHING';

  const sql = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES ${placeholders}
    ${conflictClause} ${updateClause}
    RETURNING *
  `;

  const res = await pool.query(sql, values);
  return isArray ? res.rows : res.rows[0];
}

export async function executeDelete(table: string, eq: Record<string, any>) {
  let conditions: string[] = [];
  let values: any[] = [];
  let paramIndex = 1;
  
  for (const [k, v] of Object.entries(eq)) {
    conditions.push(`${k} = $${paramIndex++}`);
    values.push(v);
  }

  const sql = `DELETE FROM ${table} WHERE ${conditions.join(' AND ')} RETURNING *`;
  const res = await pool.query(sql, values);
  return res.rows;
}
