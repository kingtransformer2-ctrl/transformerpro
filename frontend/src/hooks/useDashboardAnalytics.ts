import { useState, useEffect } from "react";
import { apiClient, safeApiClientCall } from "@/integrations/supabase/client";
import { startOfDay, endOfDay, subDays, format } from "date-fns";

export interface SalesChartData {
  date: string;
  revenue: number;
  sales: number;
}

export interface TopProduct {
  id: string;
  name: string;
  totalQuantity: number;
  totalRevenue: number;
  category: string | null;
}

export interface LowStockProduct {
  id: string;
  name: string;
  stock: number;
  threshold: number;
  category: string | null;
}

export function useDashboardAnalytics(days: number = 7) {
  const [salesChartData, setSalesChartData] = useState<SalesChartData[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, [days]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchSalesChartData(),
        fetchTopProducts(),
        fetchLowStockProducts()
      ]);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSalesChartData = async () => {
    const startDate = startOfDay(subDays(new Date(), days - 1));
    const endDate = endOfDay(new Date());

    const data = await safeApiClientCall(
      apiClient
        .from('sales')
        .select('final_amount, sale_date')
        .gte('sale_date', startDate.toISOString())
        .lte('sale_date', endDate.toISOString())
    );

    if (!data) {
      setSalesChartData([]);
      return;
    }

    const chartDataMap = new Map<string, { revenue: number; sales: number }>();
    
    // Initialize map with all days in range to ensure zero-filled data
    for (let i = 0; i < days; i++) {
      const date = subDays(new Date(), days - 1 - i);
      const dateStr = format(date, 'MMM dd');
      chartDataMap.set(dateStr, { revenue: 0, sales: 0 });
    }

    data.forEach(sale => {
      const dateStr = format(new Date(sale.sale_date), 'MMM dd');
      const existing = chartDataMap.get(dateStr);
      if (existing) {
        existing.revenue += Number(sale.final_amount);
        existing.sales += 1;
      }
    });

    const chartData: SalesChartData[] = Array.from(chartDataMap.entries()).map(([date, stats]) => ({
      date,
      revenue: stats.revenue,
      sales: stats.sales
    }));

    setSalesChartData(chartData);
  };

  const fetchTopProducts = async () => {
    // Only look at sales from the last 30 days for "Top Products" to keep it relevant and fast
    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    
    const saleItems = await safeApiClientCall(
      apiClient
        .from('sale_items')
        .select(`
          product_id,
          quantity,
          total_price,
          products (
            id,
            name,
            category
          )
        `)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(2000)
    );

    if (saleItems) {
      const productMap = new Map<string, TopProduct>();

      saleItems.forEach((item: any) => {
        const product = item.products;
        if (product) {
          const existing = productMap.get(product.id);
          if (existing) {
            existing.totalQuantity += item.quantity;
            existing.totalRevenue += Number(item.total_price);
          } else {
            productMap.set(product.id, {
              id: product.id,
              name: product.name,
              totalQuantity: item.quantity,
              totalRevenue: Number(item.total_price),
              category: product.category
            });
          }
        }
      });

      const topProductsList = Array.from(productMap.values())
        .sort((a, b) => b.totalQuantity - a.totalQuantity)
        .slice(0, 10);

      setTopProducts(topProductsList);
    }
  };

  const fetchLowStockProducts = async () => {
    const products = await safeApiClientCall(
      apiClient
        .from('products_with_calculated_stock')
        .select('id, name, calculated_stock, min_stock_threshold, category')
        .order('calculated_stock', { ascending: true })
        .limit(10)
    );

    if (products) {
      const lowStock = products.filter((p: any) => 
        (p.calculated_stock || 0) <= (p.min_stock_threshold || 10)
      ).map(p => ({
        id: p.id!,
        name: p.name!,
        stock: p.calculated_stock || 0,
        threshold: p.min_stock_threshold || 10,
        category: p.category
      }));

      setLowStockProducts(lowStock);
    }
  };

  return {
    salesChartData,
    topProducts,
    lowStockProducts,
    loading,
    refreshAnalytics: fetchAnalytics
  };
}
