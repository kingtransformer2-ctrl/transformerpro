import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Bell, AlertTriangle, CheckCircle, Info, TrendingDown, Package, Calendar } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { useSales } from "@/hooks/useSales";
import { Product } from "@/types/inventory";
import { format, isAfter, subDays } from "date-fns";

interface Notification {
  id: string;
  type: 'warning' | 'info' | 'success' | 'error';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  action?: string;
}

export default function Notifications() {
  const { products } = useProducts();
  const { sales } = useSales();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'warning'>('all');

  useEffect(() => {
    generateNotifications();
  }, [products, sales]);

  const generateNotifications = () => {
    const notifs: Notification[] = [];

    // Low stock notifications
    const lowStockProducts = products.filter(
      (product) => product.stock_quantity <= product.min_stock_threshold
    );

    lowStockProducts.forEach((product) => {
      notifs.push({
        id: `low-stock-${product.id}`,
        type: 'warning',
        title: 'Low Stock Alert',
        message: `${product.name} is running low (${product.stock_quantity} remaining)`,
        timestamp: new Date(),
        read: false,
        action: 'Reorder'
      });
    });

    // Out of stock notifications
    const outOfStockProducts = products.filter(
      (product) => product.stock_quantity === 0
    );

    outOfStockProducts.forEach((product) => {
      notifs.push({
        id: `out-of-stock-${product.id}`,
        type: 'error',
        title: 'Out of Stock',
        message: `${product.name} is completely out of stock`,
        timestamp: new Date(),
        read: false,
        action: 'Restock'
      });
    });

    // Expiry notifications (products expiring within 7 days)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const expiringProducts = products.filter((product) => {
      if (!product.expiry_date) return false;
      const expiryDate = new Date(product.expiry_date);
      return expiryDate <= sevenDaysFromNow && expiryDate >= new Date();
    });

    expiringProducts.forEach((product) => {
      notifs.push({
        id: `expiring-${product.id}`,
        type: 'warning',
        title: 'Product Expiring Soon',
        message: `${product.name} expires on ${format(new Date(product.expiry_date!), 'MMM dd, yyyy')}`,
        timestamp: new Date(),
        read: false,
        action: 'Review'
      });
    });

    // Recent sales summary
    const todaysSales = sales.filter((sale) => {
      const today = new Date();
      const saleDate = new Date(sale.sale_date);
      return saleDate.toDateString() === today.toDateString();
    });

    if (todaysSales.length > 0) {
      const todaysRevenue = todaysSales.reduce((sum, sale) => sum + sale.final_amount, 0);
      notifs.push({
        id: 'daily-sales',
        type: 'success',
        title: 'Daily Sales Update',
        message: `Today: ${todaysSales.length} sales, $${todaysRevenue.toFixed(2)} revenue`,
        timestamp: new Date(),
        read: false
      });
    }

    // System notifications
    notifs.push({
      id: 'system-1',
      type: 'info',
      title: 'System Update',
      message: 'Inventory management system is running smoothly',
      timestamp: subDays(new Date(), 1),
      read: true
    });

    setNotifications(notifs);
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => 
      prev.map(notif => 
        notif.id === id ? { ...notif, read: true } : notif
      )
    );
  };

  const markAllAsRead = () => {
    setNotifications(prev => 
      prev.map(notif => ({ ...notif, read: true }))
    );
  };

  const getFilteredNotifications = () => {
    switch (filter) {
      case 'unread':
        return notifications.filter(n => !n.read);
      case 'warning':
        return notifications.filter(n => n.type === 'warning' || n.type === 'error');
      default:
        return notifications;
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      case 'error':
        return <AlertTriangle className="h-5 w-5 text-red-500" />;
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      default:
        return <Info className="h-5 w-5 text-blue-500" />;
    }
  };

  const getBadgeVariant = (type: string) => {
    switch (type) {
      case 'warning':
        return 'secondary';
      case 'error':
        return 'destructive';
      case 'success':
        return 'default';
      default:
        return 'outline';
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const filteredNotifications = getFilteredNotifications();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Notifications</h1>
            <p className="text-muted-foreground">
              {unreadCount > 0 && `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Button 
              variant="outline" 
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
            >
              Mark All Read
            </Button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex space-x-2">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
            size="sm"
          >
            All ({notifications.length})
          </Button>
          <Button
            variant={filter === 'unread' ? 'default' : 'outline'}
            onClick={() => setFilter('unread')}
            size="sm"
          >
            Unread ({unreadCount})
          </Button>
          <Button
            variant={filter === 'warning' ? 'default' : 'outline'}
            onClick={() => setFilter('warning')}
            size="sm"
          >
            Alerts ({notifications.filter(n => n.type === 'warning' || n.type === 'error').length})
          </Button>
        </div>

        {/* Notifications List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="h-5 w-5 mr-2" />
              Recent Notifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredNotifications.length === 0 ? (
              <div className="text-center py-8">
                <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <div className="text-lg font-medium text-muted-foreground mb-2">
                  No notifications
                </div>
                <div className="text-sm text-muted-foreground">
                  {filter === 'unread' ? 'All notifications have been read' : 'You\'re all caught up!'}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredNotifications.map((notification, index) => (
                  <div key={notification.id}>
                    <div 
                      className={`flex items-start space-x-4 p-4 rounded-lg cursor-pointer transition-colors ${
                        !notification.read 
                          ? 'bg-muted/50 hover:bg-muted' 
                          : 'hover:bg-muted/30'
                      }`}
                      onClick={() => markAsRead(notification.id)}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {getNotificationIcon(notification.type)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="font-medium text-foreground">
                            {notification.title}
                          </h4>
                          <div className="flex items-center space-x-2">
                            {!notification.read && (
                              <Badge variant="default" className="text-xs">
                                New
                              </Badge>
                            )}
                            <Badge variant={getBadgeVariant(notification.type)} className="text-xs">
                              {notification.type}
                            </Badge>
                          </div>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-2">
                          {notification.message}
                        </p>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {format(notification.timestamp, 'MMM dd, yyyy HH:mm')}
                          </span>
                          
                          {notification.action && (
                            <Button variant="outline" size="sm">
                              {notification.action}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {index < filteredNotifications.length - 1 && <Separator />}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Critical Alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {notifications.filter(n => n.type === 'error').length}
              </div>
              <p className="text-xs text-muted-foreground">
                Require immediate attention
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Warnings</CardTitle>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500">
                {notifications.filter(n => n.type === 'warning').length}
              </div>
              <p className="text-xs text-muted-foreground">
                Need attention soon
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">System Updates</CardTitle>
              <Info className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {notifications.filter(n => n.type === 'info' || n.type === 'success').length}
              </div>
              <p className="text-xs text-muted-foreground">
                General information
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}