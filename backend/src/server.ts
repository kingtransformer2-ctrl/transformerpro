import './loadEnv.ts';
console.log('DEBUG DATABASE_URL:', process.env.DATABASE_URL);
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Pool } from 'pg';
import { executeQuery, executeInsert, executeUpdate, executeDelete, executeUpsert } from './queryBuilder.ts';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});
const app = express();
app.use(cors());
app.use(express.json());

async function relayDebugEvent(payload: unknown) {
  try {
    await fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    return false;
  }
}



const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const ROLE_PRIORITY = [
  'admin',
  'owner',
  'manager',
  'accountant',
  'cashier',
  'waiter_admin',
  'waiter',
  'chef',
  'barman',
  'receptionist',
  'housekeeping',
  'security',
  'maintenance',
  'user',
] as const;

const normalizeRole = (role: unknown) => {
  if (typeof role !== 'string') return 'user';
  const normalized = role.trim().toLowerCase();
  return normalized || 'user';
};

const resolvePrimaryRole = (roles: unknown[]) => {
  const normalizedRoles = Array.from(
    new Set(
      roles
        .filter((role): role is string => typeof role === 'string')
        .map((role) => normalizeRole(role))
        .filter(Boolean)
    )
  );

  if (normalizedRoles.length === 0) {
    return 'user';
  }

  return [...normalizedRoles].sort((left, right) => {
    const leftPriority = ROLE_PRIORITY.indexOf(left as (typeof ROLE_PRIORITY)[number]);
    const rightPriority = ROLE_PRIORITY.indexOf(right as (typeof ROLE_PRIORITY)[number]);
    const normalizedLeftPriority = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
    const normalizedRightPriority = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;

    if (normalizedLeftPriority !== normalizedRightPriority) {
      return normalizedLeftPriority - normalizedRightPriority;
    }

    return left.localeCompare(right);
  })[0];
};

const getUserPrimaryRole = async (userId: string) => {
  const roleResult = await pool.query(
    'SELECT role FROM user_roles WHERE user_id = $1',
    [userId]
  );
  return resolvePrimaryRole(roleResult.rows.map((row) => row.role));
};

const buildAuthUser = (user: { id: string; email: string; created_at?: string }, role: string) => ({
  id: user.id,
  email: user.email,
  created_at: user.created_at,
  user_metadata: { role },
  app_metadata: { role },
});

type AuthTokenPayload = {
  userId: string;
  email: string;
  role?: string;
};

type AuthenticatedRequest = express.Request & {
  user: AuthTokenPayload;
};

// Auth middleware
const authenticateToken = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    (req as AuthenticatedRequest).user = user as AuthTokenPayload;
    next();
  });
};

// Auth endpoints
app.post('/api/auth/signup', async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, password, options } = req.body;
    const requestedRole = normalizeRole(options?.data?.role);
    const hashedPassword = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    const result = await client.query(
      'INSERT INTO app_users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, hashedPassword]
    );

    const user = result.rows[0];

    await client.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
      [user.id, requestedRole]
    );

    await client.query('COMMIT');

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: requestedRole },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ data: { user: buildAuthUser(user, requestedRole), token }, error: null });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Signup error:', err);
    if (err?.code === '23505') {
      return res.status(409).json({ data: null, error: { message: 'User already registered' } });
    }
    res.status(500).json({ data: null, error: { message: err.message } });
  } finally {
    client.release();
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM app_users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ data: null, error: { message: 'Invalid login credentials' } });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ data: null, error: { message: 'Invalid login credentials' } });
    }

    const role = await getUserPrimaryRole(user.id);

    const token = jwt.sign({ userId: user.id, email: user.email, role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      data: { user: buildAuthUser({ id: user.id, email: user.email, created_at: user.created_at }, role), token },
      error: null
    });
  } catch (err: any) {
    console.error('Signin error:', err);
    res.status(500).json({ data: null, error: { message: err.message } });
  }
});

app.post('/api/auth/signout', (req, res) => {
  res.json({ data: { success: true }, error: null });
});

app.get('/api/auth/session', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await pool.query('SELECT id, email, created_at FROM app_users WHERE id = $1', [req.user.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'User not found' } });
    }
    const role = await getUserPrimaryRole(req.user.userId);
    res.json({ data: { user: buildAuthUser(result.rows[0], role) }, error: null });
  } catch (err: any) {
    console.error('Session error:', err);
    res.status(500).json({ data: null, error: { message: err.message } });
  }
});

// Expose a unified query endpoint for the frontend mock client
app.post('/api/query', async (req, res) => {
  try {
    const { table, action, query, data } = req.body;
    
    // Helper to hash pins in data
    const hashPinIfNeeded = async (item: any) => {
      if (item.pin && typeof item.pin === 'string' && !item.pin.startsWith('$2a$') && !item.pin.startsWith('$2b$') && !item.pin.startsWith('$2y$')) {
        return { ...item, pin: await bcrypt.hash(item.pin, 10) };
      }
      return item;
    };
    
    let processedData = data;
    if (table === 'hotel_staff') {
      if (Array.isArray(processedData)) {
        processedData = await Promise.all(processedData.map(hashPinIfNeeded));
      } else if (processedData) {
        processedData = await hashPinIfNeeded(processedData);
      }
    }
    
    let result;
    switch (action) {
      case 'select':
        result = await executeQuery(table, query);
        break;
      case 'insert':
        result = await executeInsert(table, processedData);
        break;
      case 'upsert':
        result = await executeUpsert(table, processedData, req.body.options || {});
        break;
      case 'update':
        result = await executeUpdate(table, processedData, query?.eq || {}, query?.in || {});
        break;
      case 'delete':
        result = await executeDelete(table, query?.eq || {});
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }
    
    res.json({ data: result, error: null });
  } catch (err: any) {
    console.error('API Error:', err);
    res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
  }
});

// RPC endpoint
app.post('/api/rpc/:functionName', async (req, res) => {
  console.log('[RPC] Incoming request:', req.params.functionName, req.body);
  try {
    const { functionName } = req.params;
    const args = req.body;

    switch (functionName) {
      // Every RPC call added to a frontend hook MUST have a matching case here in the same commit.
      // Run npm run check:rpc-contracts before merging.

      case 'open_hotel_staff_shift': {
        const { p_staff_id, p_staff_role, p_shift_label, p_opening_cash, p_opening_notes } = args;
        if (!p_staff_id) {
          return res.status(400).json({ data: null, error: { message: 'p_staff_id is required' } });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const existingResult = await client.query(
            `SELECT * FROM public.hotel_staff_shifts
             WHERE staff_id = $1 AND closed_at IS NULL
             ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
            [p_staff_id]
          );

          if (existingResult.rows.length > 0) {
            const existing = existingResult.rows[0];
            if (!['ACTIVE', 'PENDING'].includes(String(existing.status).toUpperCase())) {
              const updated = await client.query(
                `UPDATE public.hotel_staff_shifts SET status = 'ACTIVE', updated_at = NOW()
                 WHERE id = $1 RETURNING *`,
                [existing.id]
              );
              await client.query('COMMIT');
              return res.json({ data: updated.rows[0], error: null });
            }
            await client.query('COMMIT');
            return res.json({ data: existing, error: null });
          }

          const normalizedRole = p_staff_role || 'receptionist';
          const normalizedLabel = (p_shift_label || 'general').toString().trim() || 'general';
          const openingCash = Number(p_opening_cash || 0);
          const openingNotes = p_opening_notes && String(p_opening_notes).trim() !== '' ? String(p_opening_notes).trim() : null;

          const insertResult = await client.query(
            `INSERT INTO public.hotel_staff_shifts (
              staff_id, staff_role, shift_label, status,
              opening_cash, opening_notes, opened_at, started_at
            ) VALUES ($1, $2, $3, 'ACTIVE', $4, $5, NOW(), NOW())
            RETURNING *`,
            [p_staff_id, normalizedRole, normalizedLabel, openingCash, openingNotes]
          );

          await client.query('COMMIT');
          return res.json({ data: insertResult.rows[0], error: null });
        } catch (err: any) {
          await client.query('ROLLBACK');
          if (err?.code === '23505' || err?.message?.includes('already has an open shift')) {
            const fallbackResult = await pool.query(
              `SELECT * FROM public.hotel_staff_shifts
               WHERE staff_id = $1 AND closed_at IS NULL
               ORDER BY opened_at DESC LIMIT 1`,
              [p_staff_id]
            );
            if (fallbackResult.rows.length > 0) {
              return res.json({ data: fallbackResult.rows[0], error: null });
            }
          }
          console.error('open_hotel_staff_shift error:', err);
          res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        } finally {
          client.release();
        }
        return;
      }

      case 'close_hotel_staff_shift': {
        const { p_shift_id, p_closing_cash, p_closing_notes, p_force_close } = args;
        if (!p_shift_id) {
          return res.status(400).json({ data: null, error: { message: 'p_shift_id is required' } });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const shiftResult = await client.query(
            `SELECT * FROM public.hotel_staff_shifts WHERE id = $1 FOR UPDATE`,
            [p_shift_id]
          );

          if (shiftResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ data: null, error: { message: 'Shift not found' } });
          }

          const shift = shiftResult.rows[0];

          if (shift.closed_at !== null && !p_force_close) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'Shift is already closed' } });
          }

          const [txRes, ordersRes, orderItemsRes, logsRes, stockMovesRes] = await Promise.all([
            client.query(
              `SELECT type, amount FROM public.hotel_shift_transactions WHERE shift_id = $1`,
              [p_shift_id]
            ),
            client.query(
              `SELECT id, status, total_amount, order_number, table_number, room_id, created_at,
                      (SELECT payment_status FROM public.hotel_invoices WHERE hotel_invoices.id = hotel_orders.invoice_id LIMIT 1) as invoice_payment_status
               FROM public.hotel_orders WHERE shift_id = $1`,
              [p_shift_id]
            ),
            client.query(
              `SELECT quantity, name, category, unit_price FROM public.hotel_order_items WHERE shift_id = $1`,
              [p_shift_id]
            ),
            client.query(
              `SELECT action_type, description, amount FROM public.hotel_shift_logs WHERE shift_id = $1`,
              [p_shift_id]
            ),
            client.query(
              `SELECT quantity, item_id, service_item_id, movement_type FROM public.hotel_stock_movements WHERE shift_id = $1`,
              [p_shift_id]
            ),
          ]);

          const transactions = txRes.rows || [];
          const orders = ordersRes.rows || [];
          const orderItems = orderItemsRes.rows || [];
          const logs = logsRes.rows || [];
          const stockMoves = stockMovesRes.rows || [];

          const totalSales = transactions
            .filter((t: any) => !['refund', 'void', 'handover'].includes(String(t.type || '').toLowerCase()))
            .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
          const cashSales = transactions
            .filter((t: any) => String(t.type || '').toLowerCase() === 'cash')
            .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
          const refundsVoids = transactions
            .filter((t: any) => { const tt = String(t.type || '').toLowerCase(); return tt === 'refund' || tt === 'void'; })
            .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
          const handovers = transactions
            .filter((t: any) => String(t.type || '').toLowerCase() === 'handover')
            .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
          const momoSales = transactions
            .filter((t: any) => String(t.type || '').toLowerCase() === 'momo')
            .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
          const cardSales = transactions
            .filter((t: any) => ['card', 'upi', 'bank_transfer'].includes(String(t.type || '').toLowerCase()))
            .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
          const roomCharges = transactions
            .filter((t: any) => String(t.type || '').toLowerCase() === 'room_charge')
            .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

          const openingCash = Number(shift.opening_cash || 0);
          const closingCash = Number(p_closing_cash ?? 0);
          const expectedCash = openingCash + cashSales + refundsVoids + handovers;
          const difference = closingCash - expectedCash;

          const totalOrders = orders.length;
          const completedOrders = orders.filter((o: any) => String(o.status || '').toLowerCase() === 'settled').length;
          const cancelledOrders = orders.filter((o: any) => String(o.status || '').toLowerCase() === 'cancelled');
          const pendingOrders = orders.filter((o: any) =>
            ['pending', 'preparing', 'ready', 'served', 'awaiting_approval', 'pending_handover'].includes(String(o.status || '').toLowerCase())
          );
          const unpaidOrders = orders.filter((o: any) => {
            const s = String(o.status || '').toLowerCase();
            return (s === 'billed' || s === 'awaiting_approval' || s === 'pending_handover') &&
              (!o.invoice_payment_status || String(o.invoice_payment_status).toLowerCase() !== 'paid');
          });
          const roomOrders = orders.filter((o: any) => !!o.room_id);
          const tableOrders = orders.filter((o: any) => !!o.table_number);

          const totalItemsCount = orderItems.reduce((sum: number, i: any) => sum + Number(i.quantity || 0), 0);

          const categorySales: Record<string, { qty: number; total: number }> = {};
          orderItems.forEach((item: any) => {
            const cat = item.category || 'uncategorized';
            if (!categorySales[cat]) categorySales[cat] = { qty: 0, total: 0 };
            categorySales[cat].qty += Number(item.quantity || 0);
            categorySales[cat].total += Number(item.quantity || 0) * Number(item.unit_price || 0);
          });

          const stationSales: Record<string, { qty: number; total: number }> = {
            kitchen: { qty: 0, total: 0 },
            bar: { qty: 0, total: 0 },
            inventory: { qty: 0, total: 0 },
            other: { qty: 0, total: 0 },
          };
          (orderItems || []).forEach((item: any) => {
            const cat = String(item.category || '').toLowerCase();
            let station: keyof typeof stationSales = 'other';
            if (cat.includes('food') || cat.includes('meal') || cat.includes('kitchen') || cat.includes('snack')) {
              station = 'kitchen';
            } else if (cat.includes('drink') || cat.includes('beverage') || cat.includes('bar') || cat.includes('wine') || cat.includes('beer')) {
              station = 'bar';
            } else if (cat.includes('inventory') || cat.includes('retail') || cat.includes('merch')) {
              station = 'inventory';
            }
            stationSales[station].qty += Number(item.quantity || 0);
            stationSales[station].total += (Number(item.quantity || 0) * Number(item.unit_price || 0));
          });

          const activityCounts: Record<string, number> = {};
          logs.forEach((log: any) => {
            activityCounts[log.action_type] = (activityCounts[log.action_type] || 0) + 1;
          });

          const inventoryMoves: Record<string, { name: string; qty: number }> = {};
          stockMoves.forEach((move: any) => {
            const itemId = move.service_item_id || move.item_id || 'unknown';
            if (!inventoryMoves[itemId]) inventoryMoves[itemId] = { name: 'Unknown Item', qty: 0 };
            if (String(move.movement_type || '').toLowerCase() === 'out') {
              inventoryMoves[itemId].qty += Number(move.quantity || 0);
            }
          });

          const summary = {
            financial: {
              opening_cash: openingCash,
              total_sales: totalSales,
              cash_sales: cashSales,
              momo_sales: momoSales,
              card_sales: cardSales,
              room_charges: roomCharges,
              handovers: handovers,
              expected_cash: expectedCash,
            },
            orders: {
              total_orders: totalOrders,
              completed_orders: completedOrders,
              cancelled_orders: cancelledOrders.length,
              pending_orders: pendingOrders.length,
              room_service_orders: roomOrders.length,
              table_orders: tableOrders.length,
              cancelled_details: cancelledOrders.map((o: any) => ({
                order_number: o.order_number,
                reason: o.cancel_reason,
                amount: o.total_amount,
              })),
              unpaid_details: unpaidOrders.map((o: any) => ({
                order_number: o.order_number,
                amount: o.total_amount,
                status: o.status,
              })),
            },
            stations: stationSales,
            categories: categorySales,
            hotel_activity: {
              rooms_booked: activityCounts.booking_created || activityCounts.reservation_created || 0,
              check_ins: activityCounts.check_in || 0,
              check_outs: activityCounts.check_out || 0,
              service_orders: activityCounts.order_created || 0,
              payments_processed: activityCounts.payment_approved || activityCounts.direct_payment || 0,
            },
            issues: [],
            inventory: {
              total_items_sold: stockMoves
                .filter((m: any) => String(m.movement_type || '').toLowerCase() === 'out')
                .reduce((sum: number, m: any) => sum + Number(m.quantity || 0), 0),
              top_items: Object.values(inventoryMoves).sort((a, b) => b.qty - a.qty).slice(0, 5),
            },
          };

          const billedSales = orders
            .filter((o: any) => ['settled', 'billed', 'paid'].includes(String(o.status || '').toLowerCase()))
            .reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0);

          const closingNotesVal = p_closing_notes && String(p_closing_notes).trim() !== '' ? String(p_closing_notes).trim() : null;

          const updateResult = await client.query(
            `UPDATE public.hotel_staff_shifts SET
               closed_at = NOW(),
               ended_at = NOW(),
               closing_cash = $1,
               closing_notes = $2,
               expected_cash = $3,
               difference = $4,
               status = 'CLOSED',
               summary = $5::jsonb,
               total_sales = $6,
               billed_sales = $7,
               total_orders = $8,
               total_items = $9,
               closing_report = $10
             WHERE id = $11
             RETURNING *`,
            [
              closingCash,
              closingNotesVal,
              expectedCash,
              difference,
              JSON.stringify(summary),
              totalSales,
              billedSales,
              totalOrders,
              totalItemsCount,
              `Shift closed. Cash difference: ${difference >= 0 ? '+' : ''}${difference.toFixed(2)}`,
              p_shift_id,
            ]
          );

          await client.query('COMMIT');
          return res.json({ data: updateResult.rows[0], error: null });
        } catch (err: any) {
          await client.query('ROLLBACK');
          console.error('close_hotel_staff_shift error:', err);
          res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        } finally {
          client.release();
        }
        return;
      }

      case 'check_in_reservation_order': {
        const { p_order_id, p_assigned_waiter_id } = args;
        if (!p_order_id) {
          return res.status(400).json({ data: null, error: { message: 'p_order_id is required' } });
        }
        if (!p_assigned_waiter_id) {
          return res.status(400).json({ data: null, error: { message: 'p_assigned_waiter_id is required' } });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const reservationResult = await client.query(
            `SELECT
               id,
               order_number,
               order_type,
               status,
               payment_status,
               table_id,
               table_number,
               party_size,
               notes,
               assigned_waiter_id,
               waiter_id,
               staff_id,
               checked_in_at,
               session_id
             FROM public.hotel_orders
             WHERE id = $1
             FOR UPDATE`,
            [p_order_id]
          );

          if (reservationResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ data: null, error: { message: 'Reservation order not found' } });
          }

          const reservation = reservationResult.rows[0];

          if (reservation.order_type !== 'reservation') {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'Only reservation orders can be checked in here' } });
          }

          if (reservation.checked_in_at) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'This reservation has already been checked in' } });
          }

          if (['cancelled', 'paid', 'settled'].includes(String(reservation.status || '').toLowerCase())) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'This reservation can no longer be checked in' } });
          }

          if (!reservation.table_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'This reservation is missing its table assignment' } });
          }

          const waiterResult = await client.query(
            `SELECT
               s.id,
               s.first_name,
               s.last_name,
               s.role,
               s.is_active,
               shift.id AS shift_id
             FROM public.hotel_staff s
             LEFT JOIN LATERAL (
               SELECT id
               FROM public.hotel_staff_shifts
               WHERE staff_id = s.id AND closed_at IS NULL
               ORDER BY opened_at DESC
               LIMIT 1
             ) shift ON TRUE
             WHERE s.id = $1`,
            [p_assigned_waiter_id]
          );

          if (waiterResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'Assigned waiter was not found' } });
          }

          const waiter = waiterResult.rows[0];

          if (!waiter.is_active) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'Assigned waiter must be active' } });
          }

          if (!['waiter', 'waiter_admin'].includes(String(waiter.role || '').toLowerCase())) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'Assigned waiter must have waiter permissions' } });
          }

          if (!waiter.shift_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'The selected waiter must open a shift before starting this reservation' } });
          }

          const tableResult = await client.query(
            `SELECT id, table_number
             FROM public.hotel_tables
             WHERE id = $1
             FOR UPDATE`,
            [reservation.table_id]
          );

          if (tableResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'Reservation table record was not found' } });
          }

          const table = tableResult.rows[0];
          const targetGuestCount = Math.max(Number(reservation.party_size || 0), 1);
          let session = null as any;

          if (reservation.session_id) {
            const existingReservationSession = await client.query(
              `SELECT *
               FROM public.hotel_table_sessions
               WHERE id = $1
               FOR UPDATE`,
              [reservation.session_id]
            );

            if (existingReservationSession.rows.length > 0) {
              session = existingReservationSession.rows[0];

              if (session.table_id !== reservation.table_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ data: null, error: { message: 'Reservation session does not match the reserved table' } });
              }

              if (['closed', 'cancelled'].includes(String(session.status || '').toLowerCase())) {
                session = null;
              }
            }
          }

          if (!session) {
            const existingTableSession = await client.query(
              `SELECT *
               FROM public.hotel_table_sessions
               WHERE table_id = $1
                 AND status IN ('active', 'partially_paid')
               ORDER BY opened_at DESC
               LIMIT 1
               FOR UPDATE`,
              [reservation.table_id]
            );

            if (existingTableSession.rows.length > 0) {
              session = existingTableSession.rows[0];
            }
          }

          if (session) {
            const conflictingOrdersResult = await client.query(
              `SELECT COUNT(*) AS cnt
               FROM public.hotel_orders
               WHERE session_id = $1
                 AND id <> $2
                 AND COALESCE(status, 'pending') NOT IN ('cancelled', 'settled', 'paid')`,
              [session.id, reservation.id]
            );

            if (Number(conflictingOrdersResult.rows[0]?.cnt || 0) > 0) {
              await client.query('ROLLBACK');
              return res.status(400).json({ data: null, error: { message: 'This table already has another active service session' } });
            }

            if (!reservation.session_id || session.id !== reservation.session_id) {
              const sessionPaymentsResult = await client.query(
                `SELECT COUNT(*) AS cnt
                 FROM public.hotel_payments
                 WHERE session_id = $1
                   AND COALESCE(status, 'posted') NOT IN ('void', 'refunded')`,
                [session.id]
              );

              if (Number(sessionPaymentsResult.rows[0]?.cnt || 0) > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ data: null, error: { message: 'This table already has recorded payments on an open session' } });
              }
            }

            const updatedSessionResult = await client.query(
              `UPDATE public.hotel_table_sessions
               SET
                 guest_count = GREATEST(COALESCE(guest_count, 1), $2),
                 table_number = COALESCE($3, table_number),
                 opened_by = $4,
                 opened_shift_id = $5,
                 notes = COALESCE($6, notes),
                 updated_at = NOW()
               WHERE id = $1
               RETURNING *`,
              [
                session.id,
                targetGuestCount,
                table.table_number || reservation.table_number || null,
                waiter.id,
                waiter.shift_id,
                reservation.notes || `Reservation check-in for ${reservation.order_number || reservation.id}`,
              ]
            );

            session = updatedSessionResult.rows[0];
          } else {
            const newSessionResult = await client.query(
              `INSERT INTO public.hotel_table_sessions (
                 table_id,
                 table_number,
                 guest_count,
                 opened_by,
                 opened_shift_id,
                 notes,
                 status,
                 payment_status,
                 opened_at,
                 updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, 'active', 'pending', NOW(), NOW())
               RETURNING *`,
              [
                reservation.table_id,
                table.table_number || reservation.table_number || null,
                targetGuestCount,
                waiter.id,
                waiter.shift_id,
                reservation.notes || `Reservation check-in for ${reservation.order_number || reservation.id}`,
              ]
            );

            session = newSessionResult.rows[0];
          }

          const seatCountResult = await client.query(
            `SELECT COUNT(*) AS seat_count, COALESCE(MAX(seat_no), 0) AS max_seat_no
             FROM public.hotel_table_session_seats
             WHERE session_id = $1`,
            [session.id]
          );

          const currentSeatCount = Number(seatCountResult.rows[0]?.seat_count || 0);
          const maxSeatNo = Number(seatCountResult.rows[0]?.max_seat_no || 0);

          for (let offset = 0; offset < Math.max(targetGuestCount - currentSeatCount, 0); offset += 1) {
            await client.query(
              `INSERT INTO public.hotel_table_session_seats (
                 session_id,
                 seat_no,
                 status,
                 payment_status,
                 created_at,
                 updated_at
               ) VALUES ($1, $2, 'active', 'pending', NOW(), NOW())
               ON CONFLICT (session_id, seat_no) DO NOTHING`,
              [session.id, maxSeatNo + offset + 1]
            );
          }

          const checkedInAt = new Date().toISOString();
          const previousWaiterId =
            reservation.assigned_waiter_id ||
            reservation.waiter_id ||
            reservation.staff_id ||
            null;
          const waiterChanged = !!previousWaiterId && previousWaiterId !== waiter.id;
          const orderUpdateResult = await client.query(
            `UPDATE public.hotel_orders
             SET
               session_id = $2,
               assigned_waiter_id = $3,
               waiter_id = $3,
               staff_id = $3,
               shift_id = $4,
               checked_in_at = $5,
               transferred_from_staff_id = CASE
                 WHEN $6 IS NOT NULL AND $6 <> $3 THEN $6
                 ELSE transferred_from_staff_id
               END,
               transferred_at = CASE
                 WHEN $6 IS NOT NULL AND $6 <> $3 THEN $5
                 ELSE transferred_at
               END,
               transfer_context = CASE
                 WHEN $6 IS NOT NULL AND $6 <> $3 THEN 'reservation_check_in_reassignment'
                 ELSE transfer_context
               END,
               updated_at = $5
             WHERE id = $1
             RETURNING id, order_number, table_id, table_number, session_id, assigned_waiter_id, shift_id, checked_in_at`,
            [reservation.id, session.id, waiter.id, waiter.shift_id, checkedInAt, previousWaiterId]
          );

          await client.query(
            `UPDATE public.hotel_tables
             SET status = 'occupied', cleaning_started_at = NULL, updated_at = NOW()
             WHERE id = $1`,
            [reservation.table_id]
          );

          await client.query('COMMIT');

          const checkedInOrder = orderUpdateResult.rows[0];
          return res.json({
            data: {
              order_id: checkedInOrder.id,
              order_number: checkedInOrder.order_number,
              table_id: checkedInOrder.table_id,
              table_number: checkedInOrder.table_number || table.table_number || null,
              session_id: checkedInOrder.session_id,
              assigned_waiter_id: checkedInOrder.assigned_waiter_id,
              assigned_shift_id: checkedInOrder.shift_id,
              checked_in_at: checkedInOrder.checked_in_at,
              guest_count: Number(session.guest_count || targetGuestCount),
              reassigned_from_waiter_id: waiterChanged ? previousWaiterId : null,
            },
            error: null,
          });
        } catch (err: any) {
          await client.query('ROLLBACK');
          console.error('check_in_reservation_order error:', err);
          res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        } finally {
          client.release();
        }
        return;
      }

      case 'get_hotel_table_session_summary': {
        const { p_session_id } = args;
        if (!p_session_id) {
          return res.status(400).json({ data: null, error: { message: 'p_session_id is required' } });
        }

        try {
          const sessionResult = await pool.query(
            `SELECT s.*, t.table_number AS t_table_number, t.id AS t_table_id
             FROM public.hotel_table_sessions s
             LEFT JOIN public.hotel_tables t ON t.id = s.table_id
             WHERE s.id = $1`,
            [p_session_id]
          );

          if (sessionResult.rows.length === 0) {
            return res.json({ data: null, error: null });
          }

          const session = sessionResult.rows[0];
          const tableId = session.table_id || session.t_table_id;
          const tableNumber = session.table_number || session.t_table_number;

          const hotelInfoResult = await pool.query(
            `SELECT tax_rate, tax_inclusive FROM public.hotel_info LIMIT 1`
          );
          const taxRate = Number(hotelInfoResult.rows[0]?.tax_rate ?? 18);

          const [seatsResult, groupsResult, ordersResult, paymentsResult] = await Promise.all([
            pool.query(
              `SELECT
                 sseat.id, sseat.seat_no, sseat.guest_name, sseat.status, sseat.payment_status,
                 COALESCE((
                   SELECT SUM(oi.total_price)
                   FROM public.hotel_order_items oi
                   JOIN public.hotel_orders o ON o.id = oi.order_id
                   WHERE o.session_id = $1 AND oi.seat_id = sseat.id AND oi.status <> 'cancelled'
                 ), 0) AS item_total,
                 COALESCE((
                   SELECT SUM(p.amount)
                   FROM public.hotel_payments p
                   WHERE p.seat_id = sseat.id AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
                 ), 0) + COALESCE((
                   SELECT SUM(p.amount)
                   FROM public.hotel_table_payment_group_seats pgs
                   JOIN public.hotel_payments p ON p.payment_group_id = pgs.payment_group_id
                   WHERE pgs.seat_id = sseat.id AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
                 ), 0) AS total_paid,
                 grp.id AS payment_group_id,
                 grp.group_name AS payment_group_name
               FROM public.hotel_table_session_seats sseat
               LEFT JOIN LATERAL (
                 SELECT g.id, g.group_name
                 FROM public.hotel_table_payment_group_seats pgs
                 JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
                 WHERE pgs.seat_id = sseat.id AND g.session_id = $1 AND g.status = 'active'
                 LIMIT 1
               ) grp ON TRUE
               WHERE sseat.session_id = $1
               ORDER BY sseat.seat_no`,
              [p_session_id]
            ),
            pool.query(
              `SELECT
                 g.id AS payment_group_id, g.group_name, g.status, g.payment_status,
                 g.total_amount, g.paid_amount,
                 COALESCE(g.total_amount - g.paid_amount, 0) AS outstanding_amount,
                 ARRAY_AGG(sseat.id ORDER BY sseat.seat_no) AS seat_ids,
                 ARRAY_AGG(sseat.seat_no ORDER BY sseat.seat_no) AS seat_numbers
               FROM public.hotel_table_payment_groups g
               LEFT JOIN public.hotel_table_payment_group_seats pgs ON pgs.payment_group_id = g.id
               LEFT JOIN public.hotel_table_session_seats sseat ON sseat.id = pgs.seat_id
               WHERE g.session_id = $1
               GROUP BY g.id, g.group_name, g.status, g.payment_status, g.total_amount, g.paid_amount
               ORDER BY g.group_name`,
              [p_session_id]
            ),
            pool.query(
              `SELECT id, deposit_amount, checked_in_at, total_amount
               FROM public.hotel_orders
               WHERE session_id = $1`,
              [p_session_id]
            ),
            pool.query(
              `SELECT SUM(amount) AS total_paid
               FROM public.hotel_payments
               WHERE session_id = $1 AND COALESCE(status, 'posted') NOT IN ('void', 'refunded')`,
              [p_session_id]
            ),
          ]);

          const seats = (seatsResult.rows || []).map((seat: any) => {
            const itemTotal = Number(seat.item_total || 0);
            const totalPaid = Math.min(itemTotal, Number(seat.total_paid || 0));
            const outstanding = Math.max(itemTotal - totalPaid, 0);
            return {
              seat_id: seat.id,
              seat_no: Number(seat.seat_no || 0),
              guest_name: seat.guest_name || null,
              status: seat.status,
              payment_status:
                itemTotal <= 0 ? 'paid' : outstanding <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'pending',
              item_total: Number(itemTotal.toFixed(2)),
              total_paid: Number(totalPaid.toFixed(2)),
              outstanding_amount: Number(outstanding.toFixed(2)),
              payment_group_id: seat.payment_group_id || null,
              payment_group_name: seat.payment_group_name || null,
            };
          });

          const groups = (groupsResult.rows || []).map((grp: any) => ({
            payment_group_id: grp.payment_group_id,
            group_name: grp.group_name,
            status: grp.status,
            payment_status: grp.payment_status,
            total_amount: Number(grp.total_amount || 0),
            paid_amount: Number(grp.paid_amount || 0),
            outstanding_amount: Number(Math.max(Number(grp.outstanding_amount || 0), 0)),
            seat_ids: grp.seat_ids || [],
            seat_numbers: (grp.seat_numbers || []).map((n: any) => Number(n || 0)),
          }));

          const orders = ordersResult.rows || [];
          const depositCreditTotal = orders.reduce((sum: number, order: any) => {
            const deposit = Number(order.deposit_amount || 0);
            if (deposit > 0 && order.checked_in_at !== null && order.checked_in_at !== undefined) {
              return sum + deposit;
            }
            return sum;
          }, 0);

          const subtotal = Number(session.subtotal || orders.reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0));
          const taxAmount = Number(session.tax_amount || 0);
          const totalAmount = Number(session.total_amount || subtotal + taxAmount);
          const totalPaid = Number(paymentsResult.rows[0]?.total_paid || 0);
          const outstandingAmount = Math.max(totalAmount - depositCreditTotal - totalPaid, 0);

          const allPaid = seats.length > 0 && seats.every((seat: any) => seat.payment_status === 'paid');
          const anyPaid = seats.some((seat: any) => ['partial', 'paid'].includes(seat.payment_status));

          const result = {
            session_id: session.id,
            table_id: tableId || null,
            table_number: tableNumber || null,
            guest_count: Number(session.guest_count || 0),
            status: allPaid ? 'closed' : anyPaid ? 'partially_paid' : (session.status || 'active'),
            payment_status: allPaid ? 'paid' : anyPaid ? 'partial' : 'pending',
            opened_at: session.opened_at,
            opened_by: session.opened_by || null,
            opened_shift_id: session.opened_shift_id || null,
            subtotal: Number(subtotal.toFixed(2)),
            tax_amount: Number(taxAmount.toFixed(2)),
            tax_rate: Number(session.tax_rate || taxRate),
            deposit_credit_total: Number(depositCreditTotal.toFixed(2)),
            total_amount: Number(totalAmount.toFixed(2)),
            total_paid: Number(totalPaid.toFixed(2)),
            outstanding_amount: Number(outstandingAmount.toFixed(2)),
            seats,
            groups,
          };

          return res.json({ data: result, error: null });
        } catch (err: any) {
          console.error('get_hotel_table_session_summary error:', err);
          res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        }
        return;
      }

      case 'record_hotel_table_payment': {
        const {
          p_session_id, p_payment_method, p_staff_id, p_shift_id,
          p_amount, p_seat_id, p_payment_group_id, p_receipt_no, p_notes, p_idempotency_key
        } = args;

        if (!p_session_id) {
          return res.status(400).json({ data: null, error: { message: 'p_session_id is required' } });
        }
        if (!p_payment_method || String(p_payment_method).trim() === '') {
          return res.status(400).json({ data: null, error: { message: 'p_payment_method is required' } });
        }
        if (p_seat_id && p_payment_group_id) {
          return res.status(400).json({ data: null, error: { message: 'Choose either seat payment or group payment, not both' } });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const insertedPaymentIds: string[] = [];

          if (p_payment_group_id) {
            const groupSessionResult = await client.query(
              `SELECT session_id FROM public.hotel_table_payment_groups WHERE id = $1`,
              [p_payment_group_id]
            );
            if (groupSessionResult.rows.length === 0 || groupSessionResult.rows[0].session_id !== p_session_id) {
              await client.query('ROLLBACK');
              return res.status(400).json({ data: null, error: { message: 'Payment group does not belong to this session' } });
            }

            const groupDueResult = await client.query(
              `SELECT GREATEST(total_amount - paid_amount, 0) AS outstanding FROM public.hotel_table_payment_groups WHERE id = $1`,
              [p_payment_group_id]
            );
            const groupDue = Number(groupDueResult.rows[0]?.outstanding || 0);
            const targetAmount = p_amount !== null && p_amount !== undefined ? Number(p_amount) : groupDue;
            if (targetAmount <= 0 || targetAmount > groupDue + 0.001) {
              await client.query('ROLLBACK');
              return res.status(400).json({ data: null, error: { message: 'Payment amount must be between 0 and the outstanding group balance' } });
            }

            const payResult = await client.query(
              `INSERT INTO public.hotel_payments (
                 invoice_id, session_id, payment_group_id, amount, payment_method,
                 shift_id, staff_id, status, receipt_no, notes
               ) VALUES (NULL, $1, $2, $3, $4, $5, $6, 'posted', $7, COALESCE($8, 'Grouped table payment'))
               RETURNING id`,
              [p_session_id, p_payment_group_id, targetAmount, p_payment_method,
               p_shift_id || null, p_staff_id || null, p_receipt_no || null, p_notes || null]
            );
            insertedPaymentIds.push(payResult.rows[0].id);
          } else if (p_seat_id) {
            const seatSessionResult = await client.query(
              `SELECT session_id FROM public.hotel_table_session_seats WHERE id = $1`,
              [p_seat_id]
            );
            if (seatSessionResult.rows.length === 0 || seatSessionResult.rows[0].session_id !== p_session_id) {
              await client.query('ROLLBACK');
              return res.status(400).json({ data: null, error: { message: 'Seat does not belong to this session' } });
            }

            const inGroupResult = await client.query(
              `SELECT EXISTS (
                 SELECT 1 FROM public.hotel_table_payment_group_seats pgs
                 JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
                 WHERE pgs.seat_id = $1 AND g.session_id = $2 AND g.status = 'active'
               ) AS in_group`,
              [p_seat_id, p_session_id]
            );
            if (inGroupResult.rows[0]?.in_group) {
              await client.query('ROLLBACK');
              return res.status(400).json({ data: null, error: { message: 'This seat belongs to an active payment group. Please pay the group instead.' } });
            }

            const seatDueResult = await client.query(
              `SELECT GREATEST(
                 COALESCE((
                   SELECT SUM(oi.total_price) FROM public.hotel_order_items oi
                   JOIN public.hotel_orders o ON o.id = oi.order_id
                   WHERE o.session_id = $1 AND oi.seat_id = $2 AND oi.status <> 'cancelled'
                 ), 0) - COALESCE((
                   SELECT SUM(p.amount) FROM public.hotel_payments p
                   WHERE p.seat_id = $2 AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
                 ), 0),
                 0
               ) AS outstanding`,
              [p_session_id, p_seat_id]
            );
            const seatDue = Number(seatDueResult.rows[0]?.outstanding || 0);
            const targetAmount = p_amount !== null && p_amount !== undefined ? Number(p_amount) : seatDue;
            if (targetAmount <= 0 || targetAmount > seatDue + 0.001) {
              await client.query('ROLLBACK');
              return res.status(400).json({ data: null, error: { message: 'Payment amount must be between 0 and the outstanding seat balance' } });
            }

            const payResult = await client.query(
              `INSERT INTO public.hotel_payments (
                 invoice_id, session_id, seat_id, amount, payment_method,
                 shift_id, staff_id, status, receipt_no, notes
               ) VALUES (NULL, $1, $2, $3, $4, $5, $6, 'posted', $7, COALESCE($8, 'Seat payment'))
               RETURNING id`,
              [p_session_id, p_seat_id, targetAmount, p_payment_method,
               p_shift_id || null, p_staff_id || null, p_receipt_no || null, p_notes || null]
            );
            insertedPaymentIds.push(payResult.rows[0].id);
          } else {
            const activeGroupsResult = await client.query(
              `SELECT g.id, GREATEST(g.total_amount - g.paid_amount, 0) AS outstanding_amount
               FROM public.hotel_table_payment_groups g
               WHERE g.session_id = $1 AND g.status = 'active' AND GREATEST(g.total_amount - g.paid_amount, 0) > 0
               ORDER BY g.group_name`,
              [p_session_id]
            );

            for (const grp of activeGroupsResult.rows) {
              const payResult = await client.query(
                `INSERT INTO public.hotel_payments (
                   invoice_id, session_id, payment_group_id, amount, payment_method,
                   shift_id, staff_id, status, receipt_no, notes
                 ) VALUES (NULL, $1, $2, $3, $4, $5, $6, 'posted', $7, COALESCE($8, 'Full table settlement'))
                 RETURNING id`,
                [p_session_id, grp.id, Number(grp.outstanding_amount), p_payment_method,
                 p_shift_id || null, p_staff_id || null, p_receipt_no || null, p_notes || null]
              );
              insertedPaymentIds.push(payResult.rows[0].id);
            }

            const ungroupedSeatsResult = await client.query(
              `SELECT s.id, GREATEST(
                 COALESCE((
                   SELECT SUM(oi.total_price) FROM public.hotel_order_items oi
                   JOIN public.hotel_orders o ON o.id = oi.order_id
                   WHERE o.session_id = $1 AND oi.seat_id = s.id AND oi.status <> 'cancelled'
                 ), 0) - COALESCE((
                   SELECT SUM(p.amount) FROM public.hotel_payments p
                   WHERE p.seat_id = s.id AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
                 ), 0),
                 0
               ) AS outstanding_amount
               FROM public.hotel_table_session_seats s
               WHERE s.session_id = $1 AND NOT EXISTS (
                 SELECT 1 FROM public.hotel_table_payment_group_seats pgs
                 JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
                 WHERE pgs.seat_id = s.id AND g.session_id = $1 AND g.status = 'active'
               )
               ORDER BY s.seat_no`,
              [p_session_id]
            );

            for (const seat of ungroupedSeatsResult.rows) {
              const outstanding = Number(seat.outstanding_amount || 0);
              if (outstanding <= 0) continue;
              const payResult = await client.query(
                `INSERT INTO public.hotel_payments (
                   invoice_id, session_id, seat_id, amount, payment_method,
                   shift_id, staff_id, status, receipt_no, notes
                 ) VALUES (NULL, $1, $2, $3, $4, $5, $6, 'posted', $7, COALESCE($8, 'Full table settlement'))
                 RETURNING id`,
                [p_session_id, seat.id, outstanding, p_payment_method,
                 p_shift_id || null, p_staff_id || null, p_receipt_no || null, p_notes || null]
              );
              insertedPaymentIds.push(payResult.rows[0].id);
            }

            if (insertedPaymentIds.length === 0) {
              await client.query('ROLLBACK');
              return res.status(400).json({ data: null, error: { message: 'This table session has no outstanding balance' } });
            }
          }

          await client.query(`SELECT public.refresh_hotel_table_session_state($1)`, [p_session_id]);

          const finalSessionResult = await client.query(
            `SELECT s.status, s.payment_status, s.table_id, COALESCE(s.table_number, t.table_number) AS table_number
             FROM public.hotel_table_sessions s
             LEFT JOIN public.hotel_tables t ON t.id = s.table_id
             WHERE s.id = $1`,
            [p_session_id]
          );
          const finalSession = finalSessionResult.rows[0] || {};
          const sessionFullyPaid = String(finalSession.payment_status || '').toLowerCase() === 'paid';

          await client.query('COMMIT');

          return res.json({
            data: {
              session_id: p_session_id,
              payment_ids: insertedPaymentIds,
              session_status: finalSession.status,
              session_payment_status: finalSession.payment_status,
              session_fully_paid: sessionFullyPaid,
              table_id: finalSession.table_id || null,
              table_number: finalSession.table_number || null,
            },
            error: null,
          });
        } catch (err: any) {
          await client.query('ROLLBACK');
          console.error('record_hotel_table_payment error:', err);
          res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        } finally {
          client.release();
        }
        return;
      }

      case 'upsert_hotel_table_payment_group': {
        const { p_session_id, p_group_name, p_seat_ids, p_created_by } = args;
        if (!p_session_id) {
          return res.status(400).json({ data: null, error: { message: 'p_session_id is required' } });
        }
        if (!Array.isArray(p_seat_ids) || p_seat_ids.length === 0) {
          return res.status(400).json({ data: null, error: { message: 'At least one seat is required to build a payment group' } });
        }
        if (!p_group_name || String(p_group_name).trim() === '') {
          return res.status(400).json({ data: null, error: { message: 'p_group_name is required' } });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const invalidSeatCountResult = await client.query(
            `SELECT COUNT(*) AS cnt FROM public.hotel_table_session_seats s
             WHERE s.id = ANY ($1::uuid[]) AND s.session_id <> $2`,
            [p_seat_ids, p_session_id]
          );
          if (Number(invalidSeatCountResult.rows[0]?.cnt || 0) > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'All seats in a payment group must belong to the same table session' } });
          }

          const paidSeatCountResult = await client.query(
            `SELECT COUNT(*) AS cnt FROM public.hotel_table_session_seats s
             WHERE s.id = ANY ($1::uuid[]) AND s.payment_status = 'paid'`,
            [p_seat_ids]
          );
          if (Number(paidSeatCountResult.rows[0]?.cnt || 0) > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: 'Paid seats cannot be moved into a new payment group' } });
          }

          const groupInsertResult = await client.query(
            `INSERT INTO public.hotel_table_payment_groups (session_id, group_name, created_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (session_id, group_name) DO UPDATE SET
               status = 'active',
               created_by = COALESCE(EXCLUDED.created_by, public.hotel_table_payment_groups.created_by),
               updated_at = NOW()
             RETURNING *`,
            [p_session_id, String(p_group_name).trim(), p_created_by || null]
          );
          const vGroup = groupInsertResult.rows[0];

          await client.query(
            `DELETE FROM public.hotel_table_payment_group_seats existing
             USING public.hotel_table_payment_groups g
             WHERE existing.payment_group_id = g.id
               AND g.session_id = $1
               AND g.id <> $2
               AND existing.seat_id = ANY ($3::uuid[])`,
            [p_session_id, vGroup.id, p_seat_ids]
          );

          await client.query(
            `DELETE FROM public.hotel_table_payment_group_seats WHERE payment_group_id = $1`,
            [vGroup.id]
          );

          await client.query(
            `INSERT INTO public.hotel_table_payment_group_seats (payment_group_id, seat_id)
             SELECT $1, s.id FROM public.hotel_table_session_seats s WHERE s.id = ANY ($2::uuid[])`,
            [vGroup.id, p_seat_ids]
          );

          await client.query(
            `UPDATE public.hotel_table_session_seats SET status = 'merged', updated_at = NOW()
             WHERE id = ANY ($1::uuid[])`,
            [p_seat_ids]
          );

          await client.query(
            `UPDATE public.hotel_table_session_seats SET status = 'active', updated_at = NOW()
             WHERE session_id = $1
               AND id NOT IN (
                 SELECT pgs.seat_id FROM public.hotel_table_payment_group_seats pgs
                 JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
                 WHERE g.session_id = $1 AND g.status = 'active'
               )
               AND status = 'merged' AND payment_status <> 'paid'`,
            [p_session_id]
          );

          await client.query(`SELECT public.refresh_hotel_table_session_state($1)`, [p_session_id]);

          const finalGroupResult = await client.query(
            `SELECT * FROM public.hotel_table_payment_groups WHERE id = $1`,
            [vGroup.id]
          );

          await client.query('COMMIT');
          return res.json({ data: finalGroupResult.rows[0], error: null });
        } catch (err: any) {
          await client.query('ROLLBACK');
          console.error('upsert_hotel_table_payment_group error:', err);
          res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        } finally {
          client.release();
        }
        return;
      }

      case 'safe_update_user_role': {
        const { target_user_id, new_role, reason } = args;
        if (!target_user_id) {
          return res.status(400).json({ data: null, error: { message: 'target_user_id is required' } });
        }
        if (!new_role || String(new_role).trim() === '') {
          return res.status(400).json({ data: null, error: { message: 'new_role is required' } });
        }
        const normalizedRole = String(new_role).trim();

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const permCheck = await client.query(
            `SELECT role FROM public.role_permissions WHERE role = $1`,
            [normalizedRole]
          );
          if (permCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ data: null, error: { message: `Role ${normalizedRole} is not registered in role_permissions` } });
          }

          const upsertResult = await client.query(
            `INSERT INTO public.user_roles (user_id, role)
             VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET
               role = EXCLUDED.role,
               updated_at = NOW()
             RETURNING *`,
            [target_user_id, normalizedRole]
          );

          await client.query(
            `INSERT INTO public.hotel_shift_logs (
               staff_id, action, entity_type, entity_id, details, created_at
             ) VALUES (
               NULL, 'role_updated', 'user_role', $1,
               jsonb_build_object('new_role', $2, 'reason', $3), NOW()
             )`,
            [target_user_id, normalizedRole, reason || 'Role updated via RPC']
          );

          await client.query('COMMIT');
          return res.json({ data: upsertResult.rows[0], error: null });
        } catch (err: any) {
          await client.query('ROLLBACK');
          console.error('safe_update_user_role error:', err);
          res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        } finally {
          client.release();
        }
        return;
      }

      case 'safe_remove_user_role': {
        const { target_user_id, target_role, reason } = args;
        if (!target_user_id) {
          return res.status(400).json({ data: null, error: { message: 'target_user_id is required' } });
        }
        if (!target_role || String(target_role).trim() === '') {
          return res.status(400).json({ data: null, error: { message: 'target_role is required' } });
        }
        const normalizedTargetRole = String(target_role).trim();

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const currentResult = await client.query(
            `SELECT * FROM public.user_roles WHERE user_id = $1 FOR UPDATE`,
            [target_user_id]
          );

          if (currentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ data: null, error: { message: 'User has no role record' } });
          }

          const current = currentResult.rows[0];
          if (String(current.role || '').toLowerCase() !== normalizedTargetRole.toLowerCase()) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              data: null,
              error: {
                message: `User's current role (${current.role}) does not match requested target_role (${normalizedTargetRole})`
              }
            });
          }

          const fallbackRole = 'user';
          const updateResult = await client.query(
            `UPDATE public.user_roles SET role = $1, updated_at = NOW()
             WHERE user_id = $2 RETURNING *`,
            [fallbackRole, target_user_id]
          );

          await client.query(
            `INSERT INTO public.hotel_shift_logs (
               staff_id, action, entity_type, entity_id, details, created_at
             ) VALUES (
               NULL, 'role_removed', 'user_role', $1,
               jsonb_build_object('removed_role', $2, 'reverted_to', $3, 'reason', $4), NOW()
             )`,
            [target_user_id, normalizedTargetRole, fallbackRole, reason || 'Role removed via RPC']
          );

          await client.query('COMMIT');
          return res.json({ data: updateResult.rows[0], error: null });
        } catch (err: any) {
          await client.query('ROLLBACK');
          console.error('safe_remove_user_role error:', err);
          res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        } finally {
          client.release();
        }
        return;
      }

      case 'place_order': {
        const { p_created_by, p_table_or_channel, p_items } = args;
        if (!p_created_by || !p_table_or_channel || !Array.isArray(p_items)) {
          return res.status(400).json({ data: null, error: { message: 'created_by, table_or_channel, and items are required' } });
        }

        const result = await pool.query('SELECT public.place_order($1, $2, $3) AS result', [
          p_created_by,
          p_table_or_channel,
          JSON.stringify(p_items),
        ]);
        const payload = result.rows[0]?.result;
        if (payload && typeof payload === 'string') {
          return res.json({ data: JSON.parse(payload), error: null });
        }
        return res.json({ data: payload || null, error: null });
      }

      case 'record_purchase': {
        const { p_purchased_by, p_items, p_supplier_name, p_purchase_date } = args;
        if (!p_purchased_by || !Array.isArray(p_items)) {
          return res.status(400).json({ data: null, error: { message: 'purchased_by and items are required' } });
        }

        const result = await pool.query('SELECT public.record_purchase($1, $2, $3, $4) AS purchase_id', [
          p_purchased_by,
          JSON.stringify(p_items),
          p_supplier_name || null,
          p_purchase_date || new Date().toISOString().split('T')[0],
        ]);
        const purchaseId = result.rows[0]?.purchase_id;
        return res.json({ data: { purchase_id: purchaseId }, error: null });
      }

      case 'create_transfer': {
        const { p_requested_by, p_from_store_id, p_to_store_id, p_items, p_approved_by } = args;
        if (!p_requested_by || !p_from_store_id || !p_to_store_id || !Array.isArray(p_items)) {
          return res.status(400).json({ data: null, error: { message: 'requested_by, from_store_id, to_store_id, and items are required' } });
        }

        const result = await pool.query('SELECT public.create_transfer($1, $2, $3, $4, $5) AS transfer_id', [
          p_requested_by,
          p_from_store_id,
          p_to_store_id,
          JSON.stringify(p_items),
          p_approved_by || null,
        ]);
        const transferId = result.rows[0]?.transfer_id;
        return res.json({ data: { transfer_id: transferId }, error: null });
      }

      case 'record_wastage': {
        const { p_created_by, p_store_id, p_ingredient_id, p_quantity, p_reason } = args;
        if (!p_created_by || !p_store_id || !p_ingredient_id || !p_quantity || !p_reason) {
          return res.status(400).json({ data: null, error: { message: 'created_by, store_id, ingredient_id, quantity, and reason are required' } });
        }

        const result = await pool.query('SELECT public.record_wastage($1, $2, $3, $4, $5) AS wastage_id', [
          p_created_by,
          p_store_id,
          p_ingredient_id,
          p_quantity,
          p_reason,
        ]);
        const wastageId = result.rows[0]?.wastage_id;
        return res.json({ data: { wastage_id: wastageId }, error: null });
      }

      case 'get_stock_balance': {
        const { p_store_id, p_ingredient_id } = args;
        if (!p_store_id || !p_ingredient_id) {
          return res.status(400).json({ data: null, error: { message: 'store_id and ingredient_id are required' } });
        }

        const balanceResult = await pool.query(
          'SELECT qty_on_hand FROM public.stock_balances WHERE store_id = $1 AND ingredient_id = $2',
          [p_store_id, p_ingredient_id]
        );
        return res.json({ data: { qty_on_hand: balanceResult.rows[0]?.qty_on_hand || 0 }, error: null });
      }

      case 'list_stock_ledger': {
        const { p_store_id, p_ingredient_id, p_transaction_type, p_limit } = args;
        const limits = [p_limit, 200].filter(Boolean) as number[];
        const result = await pool.query(
          `SELECT * FROM public.stock_ledger
           WHERE ($1::uuid IS NULL OR store_id = $1)
             AND ($2::uuid IS NULL OR ingredient_id = $2)
             AND ($3::text IS NULL OR transaction_type = $3)
           ORDER BY created_at DESC
           LIMIT $4`,
          [p_store_id || null, p_ingredient_id || null, p_transaction_type || null, Math.min(...limits)]
        );
        return res.json({ data: result.rows, error: null });
      }

      case 'record_hotel_inventory_movement': {
        const {
          p_ingredient_id,
          p_movement_type,
          p_quantity,
          p_reason,
          p_location_code,
          p_from_location_code,
          p_to_location_code,
          p_movement_scope,
          p_notes,
          p_unit_cost,
          p_reference_id,
          p_shift_id,
          p_created_by,
          p_service_item_id,
          p_order_item_id,
          p_station,
        } = args;

        if (!p_ingredient_id || !p_movement_type || !p_quantity || !p_reason) {
          return res.status(400).json({ data: null, error: { message: 'ingredient_id, movement_type, quantity, and reason are required' } });
        }

        // IMPORTANT: this must call the real Postgres function, not
        // reimplement the logic here. The Postgres function is the one
        // that correctly updates hotel_inventory_item_locations (per
        // main_store/kitchen/bar row) via restore_hotel_inventory_location_stock,
        // consume_hotel_inventory_location_stock, and the inline transfer
        // block, then keeps hotel_ingredients.stock_quantity in sync via
        // sync_hotel_ingredient_stock_totals(). A prior version of this
        // handler only wrote to hotel_ingredients.stock_quantity directly
        // and never touched hotel_inventory_item_locations at all, which
        // is why transfers logged correctly but location stock never moved.
        try {
          const result = await pool.query(
            `SELECT * FROM public.record_hotel_inventory_movement(
               p_ingredient_id      := $1,
               p_movement_type      := $2,
               p_quantity           := $3,
               p_reason             := $4,
               p_notes              := $5,
               p_unit_cost          := $6,
               p_reference_id       := $7,
               p_shift_id           := $8,
               p_created_by         := $9,
               p_location_code      := $10,
               p_from_location_code := $11,
               p_to_location_code   := $12,
               p_movement_scope     := $13,
               p_service_item_id    := $14,
               p_order_item_id      := $15,
               p_station            := $16
             )`,
            [
              p_ingredient_id,
              p_movement_type,
              Number(p_quantity),
              p_reason,
              p_notes ?? null,
              p_unit_cost !== undefined && p_unit_cost !== null ? Number(p_unit_cost) : null,
              p_reference_id ?? null,
              p_shift_id ?? null,
              p_created_by ?? null,
              p_location_code ?? null,
              p_from_location_code ?? null,
              p_to_location_code ?? null,
              p_movement_scope || 'manual',
              p_service_item_id ?? null,
              p_order_item_id ?? null,
              p_station ?? null,
            ]
          );

          return res.json({ data: result.rows[0], error: null });
        } catch (err: any) {
          console.error('record_hotel_inventory_movement error:', err);
          return res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
        }
      }

      case 'deduct_hotel_inventory_for_order': {
        const { p_order_id, p_items } = args;
        if (!p_order_id || !Array.isArray(p_items)) {
          return res.status(400).json({ data: null, error: { message: 'order_id and items are required' } });
        }

        const result = await pool.query('SELECT public.deduct_hotel_inventory_for_order($1, $2) AS result', [
          p_order_id,
          JSON.stringify(p_items),
        ]);
        const payload = result.rows[0]?.result;
        if (payload && typeof payload === 'string') {
          return res.json({ data: JSON.parse(payload), error: null });
        }
        return res.json({ data: payload || null, error: null });
      }

      case 'process_hotel_staff_payment': {
        const {
          p_staff_id,
          p_base_salary,
          p_bonus_amount,
          p_loan_deduction,
          p_other_deductions,
          p_payment_month,
          p_payment_date,
          p_payment_method,
          p_status,
          p_notes,
        } = args;

        if (!p_staff_id || !p_payment_month) {
          return res.status(400).json({ data: null, error: { message: 'staff_id and payment_month are required' } });
        }

        const result = await pool.query(
          `SELECT public.process_hotel_staff_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS payment_id`,
          [
            p_staff_id,
            Number(p_base_salary || 0),
            Number(p_bonus_amount || 0),
            Number(p_loan_deduction || 0),
            Number(p_other_deductions || 0),
            p_payment_month,
            p_payment_date || new Date().toISOString().split('T')[0],
            p_payment_method || 'cash',
            p_status || 'paid',
            p_notes || null,
          ]
        );

        return res.json({ data: { payment_id: result.rows[0]?.payment_id || null }, error: null });
      }

      case 'update_hotel_staff_payment': {
        const {
          p_payment_id,
          p_staff_id,
          p_base_salary,
          p_bonus_amount,
          p_loan_deduction,
          p_other_deductions,
          p_payment_month,
          p_payment_date,
          p_payment_method,
          p_status,
          p_notes,
        } = args;

        if (!p_payment_id || !p_staff_id || !p_payment_month) {
          return res.status(400).json({ data: null, error: { message: 'payment_id, staff_id, and payment_month are required' } });
        }

        const result = await pool.query(
          `SELECT public.update_hotel_staff_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS payment_id`,
          [
            p_payment_id,
            p_staff_id,
            Number(p_base_salary || 0),
            Number(p_bonus_amount || 0),
            Number(p_loan_deduction || 0),
            Number(p_other_deductions || 0),
            p_payment_month,
            p_payment_date || new Date().toISOString().split('T')[0],
            p_payment_method || 'cash',
            p_status || 'paid',
            p_notes || null,
          ]
        );

        return res.json({ data: { payment_id: result.rows[0]?.payment_id || null }, error: null });
      }

      case 'delete_hotel_staff_payment': {
        const { p_payment_id } = args;
        if (!p_payment_id) {
          return res.status(400).json({ data: null, error: { message: 'payment_id is required' } });
        }

        const result = await pool.query(
          `SELECT public.delete_hotel_staff_payment($1) AS deleted`,
          [p_payment_id]
        );

        return res.json({ data: { deleted: Boolean(result.rows[0]?.deleted) }, error: null });
      }

      case 'verify_staff_pin': {
        const { staff_pin } = args;
        console.log('[verify_staff_pin] Received request with args:', args);
        if (!staff_pin || typeof staff_pin !== 'string') {
          console.log('[verify_staff_pin] Error: staff_pin is missing or not a string');
          return res.status(400).json({ data: null, error: { message: 'staff_pin is required' } });
        }

        // Get all active staff with non-null pins
        const result = await pool.query(
          `SELECT id, first_name, last_name, email, phone, role, pin, allowed_hotel_routes, is_active, pin_failed_attempts, pin_locked_until
           FROM public.hotel_staff
           WHERE is_active = true AND pin IS NOT NULL`,
          []
        );
        console.log('[verify_staff_pin] Found active staff count:', result.rows.length);

        const staffRows = result.rows as unknown as Array<Record<string, any>>;
        let matchedStaff: Record<string, any> | null = null;
        for (const staff of staffRows) {
          console.log(`[verify_staff_pin] Checking staff: ${staff.first_name} ${staff.last_name} (${staff.role}) id=${staff.id}`);
          console.log(`  Staff pin (len=${staff.pin.length}):`, staff.pin);
          console.log(`  Input pin (len=${staff_pin.length}):`, staff_pin);
          
          let isMatch = false;
          if (staff.pin.startsWith('$2a$') || staff.pin.startsWith('$2b$') || staff.pin.startsWith('$2y$')) {
            console.log(`  Checking bcrypt...`);
            try {
              isMatch = await bcrypt.compare(staff_pin, staff.pin);
              console.log(`  bcrypt.compare result:`, isMatch);
            } catch (err) {
              console.error(`  bcrypt error:`, err);
            }
          } else {
            console.log(`  Checking plaintext: '${staff.pin}' === '${staff_pin}' →`, staff.pin === staff_pin);
            isMatch = staff.pin === staff_pin;
          }

          if (isMatch) {
            console.log(`[verify_staff_pin] Found match!`);
            matchedStaff = staff;
            break;
          }
        }

        if (!matchedStaff) {
          console.log('[verify_staff_pin] No staff matched PIN');
          return res.json({ data: { success: false, error: 'Invalid PIN' }, error: null });
        }

        // Check if staff is locked
        if (matchedStaff.pin_locked_until) {
          const lockUntil = new Date(matchedStaff.pin_locked_until);
          if (lockUntil > new Date()) {
            console.log(`[verify_staff_pin] Staff ${matchedStaff.id} locked until ${lockUntil}`);
            return res.json({ 
              data: { success: false, error: 'Account is temporarily locked. Please try again in 15 minutes.' }, 
              error: null 
            });
          }
        }

        // Reset failed attempts
        await pool.query(
          `UPDATE public.hotel_staff SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`,
          [matchedStaff.id]
        );

        console.log(`[verify_staff_pin] Success for staff ${matchedStaff.id}`);
        return res.json({
          data: {
            success: true,
            staff_id: matchedStaff.id,
            first_name: matchedStaff.first_name,
            last_name: matchedStaff.last_name,
            email: matchedStaff.email,
            phone: matchedStaff.phone,
            role: matchedStaff.role,
            allowed_hotel_routes: matchedStaff.allowed_hotel_routes || [],
          },
          error: null,
        });
      }

      case 'verify_waiter_pos_pin': {
        const { staff_pin, expected_staff_id, waiter_only } = args;
        if (!staff_pin || typeof staff_pin !== 'string') {
          return res.status(400).json({ data: null, error: { message: 'staff_pin is required' } });
        }

        // Build query based on expected_staff_id
        let query, params;
        if (expected_staff_id) {
          query = `SELECT id, first_name, last_name, email, phone, role, pin, allowed_hotel_routes, is_active, pin_failed_attempts, pin_locked_until
                   FROM public.hotel_staff
                   WHERE id = $1 AND is_active = true AND pin IS NOT NULL`;
          params = [expected_staff_id];
        } else {
          query = `SELECT id, first_name, last_name, email, phone, role, pin, allowed_hotel_routes, is_active, pin_failed_attempts, pin_locked_until
                   FROM public.hotel_staff
                   WHERE is_active = true AND pin IS NOT NULL`;
          params = [];
        }

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
          console.log('[verify_waiter_pos_pin] No staff found for query');
          return res.json({ data: { success: false, error: 'Invalid PIN' }, error: null });
        }

        const rows = result.rows as unknown as Array<Record<string, any>>;
        let matchedStaff: Record<string, any> | null = null;
        for (const staff of rows) {
          // Check waiter_only constraint if needed
          if (waiter_only && staff.role !== 'waiter' && staff.role !== 'waiter_admin') {
            continue;
          }

          let isMatch = false;
          if (staff.pin.startsWith('$2a$') || staff.pin.startsWith('$2b$') || staff.pin.startsWith('$2y$')) {
            isMatch = await bcrypt.compare(staff_pin, staff.pin);
          } else {
            isMatch = staff.pin === staff_pin;
          }

          if (isMatch) {
            matchedStaff = staff;
            break;
          }
        }

        if (!matchedStaff) {
          // If we had a staff but failed PIN, increment failed attempts
          if (rows.length === 1 && expected_staff_id) {
            const staff = rows[0];
            await pool.query(
              `UPDATE public.hotel_staff 
               SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
                   pin_locked_until = CASE WHEN COALESCE(pin_failed_attempts, 0) + 1 >= 5 
                     THEN NOW() + interval '15 minutes' 
                     ELSE pin_locked_until 
                   END
               WHERE id = $1`,
              [staff.id]
            );
          }
          console.log('[verify_waiter_pos_pin] No staff matched PIN (or role constraint failed)');
          return res.json({ data: { success: false, error: 'Invalid PIN' }, error: null });
        }

        // Check if staff is locked
        if (matchedStaff.pin_locked_until) {
          const lockUntil = new Date(matchedStaff.pin_locked_until);
          if (lockUntil > new Date()) {
            console.log(`[verify_waiter_pos_pin] Staff ${matchedStaff.id} locked until ${lockUntil}`);
            return res.json({ 
              data: { success: false, error: 'Account is temporarily locked. Please try again in 15 minutes.' }, 
              error: null 
            });
          }
        }

        // Reset failed attempts
        await pool.query(
          `UPDATE public.hotel_staff SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`,
          [matchedStaff.id]
        );

        console.log(`[verify_waiter_pos_pin] Success for staff ${matchedStaff.id} (${matchedStaff.email})`);
        return res.json({
          data: {
            success: true,
            staff_id: matchedStaff.id,
            first_name: matchedStaff.first_name,
            last_name: matchedStaff.last_name,
            email: matchedStaff.email,
            phone: matchedStaff.phone,
            role: matchedStaff.role,
            allowed_hotel_routes: matchedStaff.allowed_hotel_routes || [],
          },
          error: null,
        });
      }

      case 'sync_legacy_stock_to_hotel': {
        const { p_ingredient_id, p_store_name } = args;
        if (!p_ingredient_id) {
          return res.status(400).json({ data: null, error: { message: 'ingredient_id is required' } });
        }

        const syncResult = await pool.query('SELECT public.sync_legacy_stock_to_hotel($1, $2) AS result', [
          p_ingredient_id,
          p_store_name || 'MAIN',
        ]);
        const payload = syncResult.rows[0]?.result;
        if (payload && typeof payload === 'string') {
          return res.json({ data: JSON.parse(payload), error: null });
        }
        return res.json({ data: payload || null, error: null });
      }

      case 'record_daily_opening_stock': {
        const { p_ingredient_id, p_location_code, p_snapshot_date } = args;

        if (!p_ingredient_id || !p_location_code) {
          return res.status(400).json({ data: null, error: { message: 'ingredient_id and location_code are required' } });
        }

        const ingredientResult = await pool.query(
          'SELECT stock_quantity FROM public.hotel_ingredients WHERE id = $1',
          [p_ingredient_id]
        );

        if (ingredientResult.rows.length === 0) {
          return res.status(404).json({ data: null, error: { message: 'Ingredient not found' } });
        }

        const snapshotDate = p_snapshot_date || new Date().toISOString().split('T')[0];
        const snapshotResult = await pool.query(
          `INSERT INTO public.hotel_inventory_daily_snapshots (
            ingredient_id, location_code, snapshot_date, opening_quantity
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (ingredient_id, location_code, snapshot_date) 
          DO UPDATE SET opening_quantity = EXCLUDED.opening_quantity, updated_at = NOW()
          RETURNING *`,
          [p_ingredient_id, p_location_code, snapshotDate, ingredientResult.rows[0].stock_quantity]
        );

        return res.json({ data: snapshotResult.rows[0], error: null });
      }

      default:
        res.status(404).json({ data: null, error: { message: `RPC function ${functionName} not implemented` } });
    }
  } catch (err: any) {
    console.error('RPC Error:', err);
    res.status(500).json({ data: null, error: { message: err.message, details: err.stack } });
  }
});

// Implement actual specific REST routes for each table (fulfilling the 1:1 mapping requirement)
const tables = [
  'user_roles', 'role_permissions', 'customers', 'hotel_expenses', 'hotel_damages', 
  'hotel_invoices', 'hotel_orders', 'hotel_staff_payments', 'hotel_ingredient_movements', 
  'hotel_tables', 'hotel_table_sessions', 'hotel_order_items', 'hotel_invoice_items', 
  'hotel_payments', 'hotel_info', 'hotel_staff_shifts', 'hotel_shift_logs', 
  'hotel_shift_transactions', 'hotel_stock_movements', 'hotel_table_session_seats', 
  'hotel_staff', 'hotel_service_menu', 'products', 'sale_items', 'sales',
  'ingredients', 'stores', 'stock_balances', 'stock_ledger', 'menu_items', 'recipes', 
  'purchases', 'purchase_items', 'transfers', 'transfer_items', 'orders', 'order_items', 
  'wastage_log'
];

for (const table of tables) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      // Reconstruct query object from req.query if needed
      const query = { select: req.query.select || '*', eq: {}, in: {}, gte: {}, lte: {} };
      // Parse other params
      for (const key in req.query) {
        if (key.startsWith('eq_')) query.eq[key.replace('eq_', '')] = req.query[key];
        if (key.startsWith('in_')) query.in[key.replace('in_', '')] = (req.query[key] as string).split(',');
        if (key.startsWith('gte_')) query.gte[key.replace('gte_', '')] = req.query[key];
        if (key.startsWith('lte_')) query.lte[key.replace('lte_', '')] = req.query[key];
      }
      
      const result = await executeQuery(table, query);
      res.json({ data: result, error: null });
    } catch (err: any) {
      res.status(500).json({ data: null, error: { message: err.message } });
    }
  });

  if (table === 'hotel_staff') {
    // Special handling for hotel_staff to hash PIN
    router.post('/', async (req, res) => {
      try {
        let data = req.body;
        if (data.pin && typeof data.pin === 'string' && !data.pin.startsWith('$2a$') && !data.pin.startsWith('$2b$') && !data.pin.startsWith('$2y$')) {
          data = { ...data, pin: await bcrypt.hash(data.pin, 10) };
        }
        const result = await executeInsert(table, data);
        res.json({ data: result, error: null });
      } catch (err: any) {
        res.status(500).json({ data: null, error: { message: err.message } });
      }
    });

    router.patch('/:id', async (req, res) => {
      try {
        let data = req.body;
        if (data.pin && typeof data.pin === 'string' && !data.pin.startsWith('$2a$') && !data.pin.startsWith('$2b$') && !data.pin.startsWith('$2y$')) {
          data = { ...data, pin: await bcrypt.hash(data.pin, 10) };
        }
        const result = await executeUpdate(table, data, { id: req.params.id });
        res.json({ data: result, error: null });
      } catch (err: any) {
        res.status(500).json({ data: null, error: { message: err.message } });
      }
    });
  } else {
    // Normal handling for other tables
    router.post('/', async (req, res) => {
      try {
        const result = await executeInsert(table, req.body);
        res.json({ data: result, error: null });
      } catch (err: any) {
        res.status(500).json({ data: null, error: { message: err.message } });
      }
    });

    router.patch('/:id', async (req, res) => {
      try {
        const result = await executeUpdate(table, req.body, { id: req.params.id });
        res.json({ data: result, error: null });
      } catch (err: any) {
        res.status(500).json({ data: null, error: { message: err.message } });
      }
    });
  }

  router.delete('/:id', async (req, res) => {
    try {
      const result = await executeDelete(table, { id: req.params.id });
      res.json({ data: result, error: null });
    } catch (err: any) {
      res.status(500).json({ data: null, error: { message: err.message } });
    }
  });

  app.use(`/api/${table}`, router);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Node.js + PostgreSQL backend listening on port ${PORT}`);
});
