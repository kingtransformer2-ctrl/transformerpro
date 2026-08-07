import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient, canUseRealtime, canUseApiClientSync, safeApiClientCall } from '@/integrations/supabase/client';
import { HotelOrder } from '@/types/hotel';
import { isLocalOnlyMode } from '@/lib/offline-utils';
import { getLocalData } from '@/lib/localDataService';

export function useRestaurantDashboard() {
  const queryClient = useQueryClient();

  // Set up real-time subscription for dashboard data
  useEffect(() => {
    // NOTE: Real-time websocket subscriptions not yet implemented on the
    // Node/Express backend. Using polling as a temporary fallback.
    if (isLocalOnlyMode() || !canUseRealtime()) return;

    const pollInterval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-dashboard'] });
    }, 20000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ['restaurant-dashboard'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch data for the restaurant dashboard - limit to last 30 days to keep performance high
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateLimit = thirtyDaysAgo.toISOString();

      const [orders, items, staffRows, unavailableRows, menuItems] = canUseApiClientSync()
        ? await Promise.all([
            safeApiClientCall<(HotelOrder & { waiter?: any })[]>(
              apiClient.from('hotel_orders')
                .select('*, waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name, role)')
                .gte('created_at', dateLimit) as any
            ),
            safeApiClientCall<any[]>(
              apiClient.from('hotel_order_items')
                .select('*')
                .gte('created_at', dateLimit) as any
            ),
            safeApiClientCall<any[]>(apiClient.from('hotel_staff').select('*') as any),
            safeApiClientCall<any[]>(
              apiClient.from('hotel_service_menu').select('id').eq('is_available', false) as any
            ),
            safeApiClientCall<any[]>(apiClient.from('hotel_service_menu').select('*') as any),
          ])
        : await Promise.all([
            getLocalData<(HotelOrder & { waiter?: any })>('hotel_orders'),
            getLocalData<any>('hotel_order_items'),
            getLocalData<any>('hotel_staff'),
            getLocalData<any>('hotel_service_menu'),
            getLocalData<any>('hotel_service_menu'),
          ]);

      const resolvedOrders = (orders || []) as (HotelOrder & { waiter?: any })[];
      const resolvedItems = (items || []) as any[];
      const resolvedMenuItems = (menuItems || []) as any[];
      const resolvedUnavailableItems = (unavailableRows || []).filter((item: any) => item?.is_available === false);

      // Create a map for quick order lookup by ID
      const orderMap = new Map(resolvedOrders.map(o => [o.id, o]));

      let totalOrders = resolvedOrders.length;
      let todayOrders = 0;
      let totalRevenue = 0;
      let nonCancelledCount = 0;
      
      const ordersByStatus = {
        pending: 0,
        preparing: 0,
        ready: 0,
        served: 0,
        cancelled: 0,
        settled: 0,
      };

      const ordersByHour: Record<number, number> = {};
      for (let i = 0; i < 24; i++) ordersByHour[i] = 0;

      const waiterStats: Record<string, { id: string, name: string, count: number, revenue: number, orders: any[] }> = {};

      // Process orders in a single pass
      resolvedOrders.forEach(o => {
        if (o.created_at?.startsWith(today)) {
          todayOrders++;
          const hour = new Date(o.created_at || '').getHours();
          ordersByHour[hour] = (ordersByHour[hour] || 0) + 1;
        }

        const status = o.status as keyof typeof ordersByStatus;
        if (ordersByStatus[status] !== undefined) {
          ordersByStatus[status]++;
        }

        if (o.status === 'settled' || o.status === 'paid') {
          totalRevenue += Number(o.total_amount || 0);
        }

        if (o.status !== 'cancelled') {
          nonCancelledCount++;

          const waiterId = o.waiter_id || 'unknown';
          if (!waiterStats[waiterId]) {
            const waiterName = o.waiter ? `${o.waiter.first_name} ${o.waiter.last_name}` : 'Walk-in/System';
            waiterStats[waiterId] = { id: waiterId, name: waiterName, count: 0, revenue: 0, orders: [] };
          }
          waiterStats[waiterId].count++;
          if (o.status === 'settled' || o.status === 'paid') {
            waiterStats[waiterId].revenue += Number(o.total_amount || 0);
          }
          waiterStats[waiterId].orders.push(o);
        }
      });

      const avgOrderValue = nonCancelledCount > 0 ? totalRevenue / nonCancelledCount : 0;

      // Sales by category and top items in a single pass over items
      const revenueByCategory: Record<string, number> = {};
      const itemCounts: Record<string, { name: string, quantity: number, revenue: number }> = {};
      const stationStats = {
        kitchen: { count: 0, revenue: 0 },
        bar: { count: 0, revenue: 0 }
      };
      const kitchenOrderIds = new Set<string>();
      const barOrderIds = new Set<string>();

      resolvedItems.forEach(item => {
        const order = orderMap.get(item.order_id);
        if (order && order.status !== 'cancelled') {
          // Category revenue
          const category = item.item_type || 'other';
          revenueByCategory[category] = (revenueByCategory[category] || 0) + Number(item.total_price || 0);

          // Top items
          if (!itemCounts[item.name]) {
            itemCounts[item.name] = { name: item.name, quantity: 0, revenue: 0 };
          }
          itemCounts[item.name].quantity += Number(item.quantity || 0);
          itemCounts[item.name].revenue += Number(item.total_price || 0);

          // Station stats
          const station = item.station === 'bar' ? 'bar' : 'kitchen';
          stationStats[station].revenue += Number(item.total_price || 0);
          if (station === 'kitchen') kitchenOrderIds.add(item.order_id);
          else barOrderIds.add(item.order_id);
        }
      });

      stationStats.kitchen.count = kitchenOrderIds.size;
      stationStats.bar.count = barOrderIds.size;

      const busyHoursData = Object.entries(ordersByHour).map(([hour, count]) => ({
        hour: `${hour}:00`,
        count
      }));

      const topItems = Object.values(itemCounts)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);

      // Revenue by day for last 7 days
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - i);
        return date.toISOString().split('T')[0];
      }).reverse();

      const revenueByDay = last7Days.map(date => {
        const dayRevenue = resolvedOrders
          .filter(o => o.created_at?.startsWith(date) && (o.status === 'settled' || o.status === 'paid'))
          .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
        return { date, revenue: dayRevenue };
      });

      const recentOrders = resolvedOrders
        .sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime())
        .slice(0, 5);

      return {
        totalOrders,
        todayOrders,
        totalRevenue,
        avgOrderValue,
        ordersByStatus,
        topItems,
        revenueByDay,
        revenueByCategory: Object.entries(revenueByCategory).map(([name, value]) => ({ name, value })),
        busyHours: busyHoursData,
        recentOrders,
        stationStats,
        waiterStats: Object.values(waiterStats).sort((a, b) => b.revenue - a.revenue),
        totalStaff: staffRows?.length || 0,
        unavailableItems: resolvedUnavailableItems.length,
        occupiedTables: resolvedOrders.filter(o => o.status !== 'settled' && o.status !== 'cancelled' && o.table_number).length,
      };
    },
    staleTime: 1000 * 60 * 1, // 1 minute
  });
}
