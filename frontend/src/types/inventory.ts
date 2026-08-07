export interface Product {
  id: string;
  name: string;
  barcode?: string;
  description?: string;
  purchase_price: number;
  selling_price: number;
  stock_quantity: number;
  min_stock_threshold: number;
  category?: string;
  expiry_date?: string;
  image_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Sale {
  id: string;
  sale_number: string;
  customer_name?: string;
  customer_phone?: string;
  customer_id?: string;
  total_amount: number;
  discount: number;
  tax_amount?: number;
  final_amount: number;
  payment_method: string;
  sale_date: string;
  notes?: string;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  batch_id?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
  product?: Product;
}

export interface StockMovement {
  id: string;
  product_id: string;
  movement_type: 'in' | 'out' | 'adjustment';
  quantity: number;
  reason: string;
  reference_id?: string;
  notes?: string;
  created_at: string;
  product?: Product;
}

export interface CartItem {
  product: Product;
  quantity: number;
  unit_price: number;
}

export interface ProductBatch {
  id: string;
  product_id: string;
  batch_number: string;
  purchase_price: number;
  selling_price: number;
  quantity: number;
  received_date: string;
  expiry_date?: string;
  supplier?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  product?: Product;
}

export interface DashboardStats {
  totalProducts: number;
  totalSales: number;
  totalRevenue: number;
  lowStockProducts: number;
  todaySales: number;
  todayRevenue: number;
}