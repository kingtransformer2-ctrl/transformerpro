export type RoomType = 'single' | 'double' | 'suite' | 'deluxe' | 'presidential';
export type RoomStatus = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'cleaning' | 'dirty' | 'inspected';
export type HotelTableStatus = 'free' | 'reserved' | 'occupied' | 'cleaning';
export type TableSessionStatus = 'active' | 'partially_paid' | 'closed' | 'cancelled';
export type SeatPaymentStatus = 'pending' | 'partial' | 'paid';
export type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
export type HotelPaymentMethod = 'cash' | 'card' | 'upi' | 'bank_transfer' | 'room_charge' | 'momo' | 'split';
export type StaffRole = 'manager' | 'receptionist' | 'housekeeping' | 'security' | 'maintenance' | 'waiter' | 'barman' | 'chef' | 'cashier' | 'accountant';
export type HousekeepingStatus = 'pending' | 'in_progress' | 'completed' | 'verified';

export type OrderStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'cancelled'
  | 'billed'
  | 'paid'
  | 'settled'
  | 'awaiting_approval'
  | 'pending_handover'
  | 'confirmed';
export type OrderItemStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type OrderStation = 'kitchen' | 'bar' | 'other';

export interface HotelOrderItem {
  id: string;
  order_id: string;
  service_item_id: string | null;
  seat_id?: string | null;
  seat_no?: number | null;
  payment_group_id?: string | null;
  name: string;
  quantity: number;
  purchase_price: number;
  unit_price: number;
  total_price: number;
  notes: string | null;
  status: OrderItemStatus;
  item_type: string | null;
  station: OrderStation;
  created_at: string;
}

export type OrderType = 'dine_in' | 'reservation' | 'takeaway' | 'delivery';

export interface HotelOrder {
  id: string;
  order_number: string;
  booking_id: string | null;
  reservation_date?: string | null;
  reservation_time?: string | null;
  party_size?: number | null;
  deposit_amount?: number | null;
  deposit_paid_at?: string | null;
  assigned_waiter_id?: string | null;
  checked_in_at?: string | null;
  transferred_from_staff_id?: string | null;
  transferred_at?: string | null;
  transfer_context?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  customer_tin?: string | null;
  room_id: string | null;
  table_id: string | null;
  table_number: string | null;
  session_id?: string | null;
  seat_id?: string | null;
  waiter_id: string | null;
  staff_id: string | null;
  shift_id: string | null;
  status: OrderStatus;
  kitchen_status: OrderStatus;
  bar_status: OrderStatus;
  payment_status: 'unpaid' | 'partial' | 'paid';
  payment_received_at: string | null;
  settled_at: string | null;
  settled_by: string | null;
  payment_method: HotelPaymentMethod | null;
  payment_plan: 'full' | 'partial' | 'later' | null;
  amount_paid: number;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  notes: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  is_billed: boolean;
  invoice_id: string | null;
  order_type: OrderType;
  created_at: string;
  updated_at: string;
  items?: HotelOrderItem[];
  waiter?: { id: string; first_name: string; last_name: string; role: string } | null;
  assigned_waiter?: { id: string; first_name: string; last_name: string; role: string } | null;
  room?: { id: string; room_number: string; room_type: string } | null;
  table?: { id: string; table_number: string; name: string | null; status: HotelTableStatus } | null;
  booking?: { id: string; booking_reference: string; guest?: { first_name: string; last_name: string } | null } | null;
  session?: HotelTableSession | null;
  seat?: HotelTableSessionSeat | null;
}

export interface HotelTable {
  id: string;
  table_number: string;
  name: string | null;
  area: string | null;
  capacity: number;
  status: HotelTableStatus;
  cleaning_started_at?: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HotelTableSessionSeat {
  id: string;
  session_id: string;
  seat_no: number;
  guest_name: string | null;
  status: 'active' | 'merged' | 'closed' | 'cancelled';
  payment_status: SeatPaymentStatus;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HotelTablePaymentGroup {
  id: string;
  session_id: string;
  group_name: string;
  status: 'active' | 'closed' | 'cancelled';
  payment_status: SeatPaymentStatus;
  total_amount: number;
  paid_amount: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  seats?: HotelTableSessionSeat[];
}

export interface HotelTableSession {
  id: string;
  table_id: string;
  table_number: string | null;
  guest_count: number;
  opened_by: string | null;
  opened_shift_id: string | null;
  status: TableSessionStatus;
  payment_status: SeatPaymentStatus;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  seats?: HotelTableSessionSeat[];
  payment_groups?: HotelTablePaymentGroup[];
  table?: HotelTable | null;
}

export interface HotelInfo {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_number: string | null;
  tin_number: string | null;
  logo_url: string | null;
  tax_rate: number;
  tax_inclusive: boolean;
  cancellation_policy: string | null;
  created_at: string;
  updated_at: string;
}

export interface HotelRoom {
  id: string;
  room_number: string;
  floor: number;
  room_type: RoomType;
  status: RoomStatus;
  price_per_night: number;
  capacity: number;
  amenities: string[];
  description: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface HotelGuest {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
  id_proof_type: string | null;
  id_proof_number: string | null;
  id_proof_url: string | null;
  address: string | null;
  nationality: string;
  loyalty_points: number;
  preferences: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface HotelBooking {
  id: string;
  booking_reference: string;
  guest_id: string | null;
  room_id: string | null;
  shift_id?: string | null;
  staff_id?: string | null;
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
  status: BookingStatus;
  special_requests: string | null;
  total_amount: number;
  paid_amount: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  guest?: HotelGuest;
  room?: HotelRoom;
}

export interface HotelStaff {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  role: StaffRole;
  shift: string;
  salary: number;
  hire_date: string;
  is_active: boolean;
  pin: string | null;
  allowed_hotel_routes: string[];
  created_at: string;
  updated_at: string;
}

export interface HotelStaffAttendance {
  id: string;
  staff_id: string;
  shift_id: string | null;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  status: string;
  notes: string | null;
  worked_hours: number | null;
  is_active: boolean;
  source: string | null;
  created_at: string;
  staff?: HotelStaff;
}

export interface HotelHousekeeping {
  id: string;
  room_id: string;
  assigned_to: string | null;
  task_type: string;
  status: HousekeepingStatus;
  priority: string;
  scheduled_date: string;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  room?: HotelRoom;
  staff?: HotelStaff;
}

export interface HotelInvoice {
  id: string;
  invoice_number: string;
  booking_id: string | null;
  guest_id: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  customer_tin?: string | null;
  shift_id?: string | null;
  staff_id?: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  payment_method: HotelPaymentMethod | null;
  payment_status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  booking?: HotelBooking;
  guest?: HotelGuest;
}

export interface HotelPaymentRecord {
  id: string;
  invoice_id: string | null;
  session_id?: string | null;
  seat_id?: string | null;
  payment_group_id?: string | null;
  payment_method: string | null;
  amount: number;
  transaction_reference?: string | null;
  staff_id?: string | null;
  shift_id?: string | null;
  receipt_no?: string | null;
  status?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface HotelInvoiceItem {
  id: string;
  invoice_id: string;
  shift_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  item_type: string;
  created_at: string;
}

export interface HotelGuestFeedback {
  id: string;
  guest_id: string | null;
  booking_id: string | null;
  rating: number;
  cleanliness_rating: number;
  service_rating: number;
  amenities_rating: number;
  comments: string | null;
  created_at: string;
  guest?: HotelGuest;
}

export interface HotelPricingRule {
  id: string;
  name: string;
  room_type: RoomType | null;
  start_date: string | null;
  end_date: string | null;
  price_modifier: number;
  is_active: boolean;
  created_at: string;
}

export type ShiftStatus = 'PENDING' | 'ACTIVE' | 'CLOSED' | 'REVIEWED';

export interface HotelInventoryIngredient {
  id: string;
  name: string;
  description: string | null;
  purchase_price: number;
  stock_quantity: number;
  min_stock_threshold: number;
  reorder_quantity: number;
  unit: string;
  category: string;
  sku: string | null;
  supplier_name: string | null;
  storage_area: string | null;
  is_liquid: boolean;
  volume_per_unit: number;
  open_unit_volume: number;
  track_empties: boolean;
  empty_units_count: number;
  is_active: boolean;
  // Unit conversion fields
  bulk_unit?: string;
  bulk_to_base_quantity?: number;
  base_unit?: string;
  purchase_price_per_bulk_unit?: number;
  created_at: string;
  updated_at: string;
}

export interface HotelInventoryDailySnapshot {
  id: string;
  ingredient_id: string;
  location_code: 'main_store' | 'kitchen' | 'bar';
  snapshot_date: string;
  opening_quantity: number;
  created_at: string;
  updated_at: string;
}

export interface HotelInventoryItemLocation {
  id: string;
  ingredient_id: string;
  location_code: 'main_store' | 'kitchen' | 'bar';
  quantity: number;
  open_unit_volume: number;
  empty_units_count: number;
  min_stock_threshold: number;
  created_at: string;
  updated_at: string;
  ingredient?: HotelInventoryIngredient;
}

export interface HotelInventoryMovement {
  id: string;
  ingredient_id: string;
  movement_type: 'in' | 'out' | 'adjustment' | 'transfer';
  quantity: number;
  reason: string;
  reference_id: string | null;
  notes: string | null;
  unit_cost: number;
  total_cost: number;
  movement_scope: string;
  location_code: 'main_store' | 'kitchen' | 'bar' | null;
  from_location_code: 'main_store' | 'kitchen' | 'bar' | null;
  to_location_code: 'main_store' | 'kitchen' | 'bar' | null;
  service_item_id: string | null;
  order_item_id: string | null;
  station: 'kitchen' | 'bar' | 'other' | null;
  shift_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  ingredient?: HotelInventoryIngredient;
  shift?: HotelStaffShift;
  staff?: HotelStaff;
}

export interface HotelBarCrate {
  id: string;
  name: string;
  ingredient_id: string | null;
  capacity: number;
  full_crates_count: number;
  empty_crates_count: number;
  min_full_threshold: number;
  min_empty_threshold: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  ingredient?: HotelInventoryIngredient;
}

export interface HotelStaffShift {
  id: string;
  staff_id: string;
  staff_role: StaffRole;
  shift_label: string;
  status: ShiftStatus;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  opened_at: string;
  closed_at: string | null;
  started_at: string;
  ended_at: string | null;
  opening_notes: string | null;
  closing_notes: string | null;
  pending_orders: any | null;
  summary: any | null;
  total_sales: number | null;
  billed_sales: number | null;
  total_orders: number | null;
  total_items: number | null;
  closing_report: string | null;
  created_at: string;
  staff?: HotelStaff;
}

export interface HotelShiftLog {
  id: string;
  shift_id: string;
  staff_id: string | null;
  action_type: string;
  description: string | null;
  amount: number | null;
  reference_id: string | null;
  created_at: string;
}

export interface HotelShiftTransaction {
  id: string;
  shift_id: string;
  staff_id: string | null;
  type: 'cash' | 'momo' | 'card' | 'upi' | 'bank_transfer' | 'refund' | 'void' | 'room_charge' | 'handover' | 'split';
  amount: number;
  reference_id: string | null;
  created_at: string;
}
