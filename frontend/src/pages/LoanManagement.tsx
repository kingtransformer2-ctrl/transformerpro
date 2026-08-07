import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useLoans } from "@/hooks/useLoans";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { format } from "date-fns";
import { Plus, Search, Eye, DollarSign } from "lucide-react";
import { LoanDetails } from "@/components/loans/LoanDetails";
import { CreateLoanDialog } from "@/components/loans/CreateLoanDialog";
import { AddPaymentDialog } from "@/components/loans/AddPaymentDialog";

export default function LoanManagement() {
  const { loans, loading } = useLoans();
  const { formatCurrency } = useSettingsContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLoan, setSelectedLoan] = useState<string | null>(null);

  const filteredLoans = loans.filter(loan => {
    const search = searchTerm.toLowerCase();
    return (
      loan.loan_number?.toLowerCase().includes(search) ||
      loan.customer?.name?.toLowerCase().includes(search) ||
      loan.customer?.phone?.toLowerCase().includes(search)
    );
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'default';
      case 'completed':
        return 'outline';
      case 'overdue':
        return 'destructive';
      case 'cancelled':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const totalActiveLoans = loans.filter(loan => loan.status === 'active').length;
  const totalLoanAmount = loans
    .filter(loan => loan.status === 'active')
    .reduce((sum, loan) => sum + loan.remaining_amount, 0);
  const overdueLoans = loans.filter(loan => 
    loan.status === 'active' && 
    loan.due_date && 
    new Date(loan.due_date) < new Date()
  ).length;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading loans...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Loan Management</h1>
          <CreateLoanDialog>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Loan
            </Button>
          </CreateLoanDialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Loans</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalActiveLoans}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Outstanding Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(totalLoanAmount)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overdue Loans</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{overdueLoans}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search by loan number, customer name, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Loans Table */}
        <Card>
          <CardHeader>
            <CardTitle>Customer Loans</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loan Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Paid Amount</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLoans.map((loan) => (
                  <TableRow key={loan.id}>
                    <TableCell className="font-medium">{loan.loan_number}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{loan.customer?.name}</div>
                        {loan.customer?.phone && (
                          <div className="text-sm text-gray-500">{loan.customer.phone}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(loan.total_amount)}</TableCell>
                    <TableCell>{formatCurrency(loan.paid_amount)}</TableCell>
                    <TableCell>{formatCurrency(loan.remaining_amount)}</TableCell>
                    <TableCell>
                      {loan.due_date ? format(new Date(loan.due_date), 'MMM dd, yyyy') : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusColor(loan.status) as any}>
                        {loan.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => setSelectedLoan(loan.id)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl">
                            <DialogHeader>
                              <DialogTitle>Loan Details - {loan.loan_number}</DialogTitle>
                            </DialogHeader>
                            {selectedLoan && <LoanDetails loanId={selectedLoan} />}
                          </DialogContent>
                        </Dialog>

                        {loan.status === 'active' && (
                          <AddPaymentDialog loanId={loan.id}>
                            <Button variant="outline" size="sm">
                              <DollarSign className="h-4 w-4" />
                            </Button>
                          </AddPaymentDialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {filteredLoans.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No loans found
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}