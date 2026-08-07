import { useState } from 'react';
import { useStaffShifts, useReviewShift } from '@/hooks/useHotelShifts';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Layout } from '@/components/layout/Layout';

export default function HotelShifts() {
  const { data: shifts = [], isLoading } = useStaffShifts();
  const reviewShift = useReviewShift();
  const { formatCurrency } = useSettingsContext();
  const [selectedShift, setSelectedShift] = useState<any | null>(null);

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Shift Reports</h1>
          <p className="text-muted-foreground">Review shift activity, sales, and issues</p>
        </div>
        {/* ... content */}

      <Card>
        <CardHeader>
          <CardTitle>All Shifts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Opening</TableHead>
                  <TableHead>Closing</TableHead>
                  <TableHead>Difference</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* ... rest of table content */}
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">Loading shifts...</TableCell>
                </TableRow>
              ) : shifts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">No shifts found</TableCell>
                </TableRow>
              ) : (
                shifts.map(shift => (
                  <TableRow key={shift.id}>
                    <TableCell>
                      {shift.staff ? `${shift.staff.first_name} ${shift.staff.last_name}` : 'Unknown'}
                    </TableCell>
                    <TableCell className="capitalize">{shift.staff_role}</TableCell>
                    <TableCell>
                      <Badge variant={shift.status === 'ACTIVE' ? 'default' : shift.status === 'CLOSED' ? 'secondary' : shift.status === 'REVIEWED' ? 'outline' : 'destructive'}>
                        {shift.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{shift.opened_at ? new Date(shift.opened_at).toLocaleString() : '-'}</TableCell>
                    <TableCell>{shift.closed_at ? new Date(shift.closed_at).toLocaleString() : '-'}</TableCell>
                    <TableCell>{formatCurrency(Number(shift.opening_cash || 0))}</TableCell>
                    <TableCell>{formatCurrency(Number(shift.closing_cash || 0))}</TableCell>
                    <TableCell className={Number(shift.difference || 0) !== 0 ? 'text-destructive' : ''}>
                      {formatCurrency(Number(shift.difference || 0))}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => setSelectedShift(shift)}>
                        View Report
                      </Button>
                      {shift.status === 'CLOSED' && (
                        <Button size="sm" onClick={() => reviewShift.mutate({ shiftId: shift.id })}>
                          Mark Reviewed
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedShift} onOpenChange={(open) => !open && setSelectedShift(null)}>
        <DialogContent className="max-w-2xl print:max-w-none print:m-0 print:p-0">
          <DialogHeader className="print:hidden">
            <div className="flex justify-between items-center">
              <DialogTitle>Shift Report</DialogTitle>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                Print Report
              </Button>
            </div>
          </DialogHeader>
          {selectedShift && (
            <div className="space-y-6 print:p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Staff</div>
                  <div>{selectedShift.staff ? `${selectedShift.staff.first_name} ${selectedShift.staff.last_name}` : 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Role</div>
                  <div className="capitalize">{selectedShift.staff_role}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Shift Start</div>
                  <div>{selectedShift.opened_at ? new Date(selectedShift.opened_at).toLocaleString() : '-'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Shift End</div>
                  <div>{selectedShift.closed_at ? new Date(selectedShift.closed_at).toLocaleString() : '-'}</div>
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Financial Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>Opening Cash: {formatCurrency(Number(selectedShift.opening_cash || 0))}</div>
                    <div>Total Sales: {formatCurrency(Number(selectedShift.summary?.financial?.total_sales || 0))}</div>
                    <div className="font-medium">Cash Sales: {formatCurrency(Number(selectedShift.summary?.financial?.cash_sales || 0))}</div>
                    <div>Momo Sales: {formatCurrency(Number(selectedShift.summary?.financial?.momo_sales || 0))}</div>
                    <div>Card/Other Sales: {formatCurrency(Number(selectedShift.summary?.financial?.card_sales || 0))}</div>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="font-bold">Expected Cash: {formatCurrency(Number(selectedShift.summary?.financial?.expected_cash || 0))}</div>
                    <div className="font-bold">Closing Cash: {formatCurrency(Number(selectedShift.summary?.financial?.closing_cash || 0))}</div>
                    <div className={`font-bold ${Number(selectedShift.summary?.financial?.difference || 0) !== 0 ? 'text-destructive' : 'text-green-600'}`}>
                      Difference: {formatCurrency(Number(selectedShift.summary?.financial?.difference || 0))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Orders Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>Total: {selectedShift.summary?.orders?.total_orders || 0}</div>
                    <div>Completed: {selectedShift.summary?.orders?.completed_orders || 0}</div>
                    <div className={selectedShift.summary?.orders?.cancelled_orders > 0 ? 'text-destructive font-medium' : ''}>
                      Cancelled: {selectedShift.summary?.orders?.cancelled_orders || 0}
                    </div>
                    <div className={selectedShift.summary?.orders?.pending_orders > 0 ? 'text-orange-500 font-medium' : ''}>
                      Pending: {selectedShift.summary?.orders?.pending_orders || 0}
                    </div>
                  </div>
                  
                  {selectedShift.summary?.orders?.cancelled_details?.length > 0 && (
                    <div className="space-y-2 mt-4">
                      <div className="font-semibold text-xs uppercase text-muted-foreground">Cancellation Details</div>
                      <div className="border rounded-md overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/50">
                            <TableRow>
                              <TableHead className="h-8 text-xs">Order #</TableHead>
                              <TableHead className="h-8 text-xs">Amount</TableHead>
                              <TableHead className="h-8 text-xs">Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedShift.summary.orders.cancelled_details.map((o: any, i: number) => (
                              <TableRow key={i}>
                                <TableCell className="py-1 text-xs">{o.order_number}</TableCell>
                                <TableCell className="py-1 text-xs">{formatCurrency(o.amount)}</TableCell>
                                <TableCell className="py-1 text-xs">{o.reason || 'No reason'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Hotel Activity</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div>Rooms Booked: {selectedShift.summary?.hotel_activity?.rooms_booked || 0}</div>
                  <div>Check-ins: {selectedShift.summary?.hotel_activity?.check_ins || 0}</div>
                  <div>Check-outs: {selectedShift.summary?.hotel_activity?.check_outs || 0}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sales by Station</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="font-semibold">Kitchen:</span> {selectedShift.summary?.stations?.kitchen?.qty || 0} items
                    <span className="block text-muted-foreground text-xs">{formatCurrency(selectedShift.summary?.stations?.kitchen?.total || 0)}</span>
                  </div>
                  <div>
                    <span className="font-semibold">Bar:</span> {selectedShift.summary?.stations?.bar?.qty || 0} items
                    <span className="block text-muted-foreground text-xs">{formatCurrency(selectedShift.summary?.stations?.bar?.total || 0)}</span>
                  </div>
                  <div>
                    <span className="font-semibold">Inventory:</span> {selectedShift.summary?.stations?.inventory?.qty || 0} items
                    <span className="block text-muted-foreground text-xs">{formatCurrency(selectedShift.summary?.stations?.inventory?.total || 0)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Issues</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {(selectedShift.summary?.issues || []).length === 0 ? 'No issues detected' : (selectedShift.summary?.issues || []).join(', ')}
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </Layout>
  );
}
