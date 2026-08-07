import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLoans } from "@/hooks/useLoans";

interface AddPaymentDialogProps {
  loanId: string;
  children: React.ReactNode;
}

export function AddPaymentDialog({ loanId, children }: AddPaymentDialogProps) {
  const { addPayment, loans } = useLoans();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const loan = loans.find(l => l.id === loanId);

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    setLoading(true);
    try {
      await addPayment(
        loanId,
        parseFloat(amount),
        paymentMethod,
        referenceNumber || undefined,
        notes || undefined
      );
      
      // Reset form
      setAmount("");
      setPaymentMethod("cash");
      setReferenceNumber("");
      setNotes("");
      setOpen(false);
    } catch (error) {
      console.error('Error adding payment:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {loan && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">Loan: {loan.loan_number}</p>
              <p className="text-sm text-gray-600">Customer: {loan.customer?.name}</p>
              <p className="text-sm font-medium">Remaining: ${loan.remaining_amount.toFixed(2)}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount">Payment Amount</Label>
            <Input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              max={loan?.remaining_amount}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="momo">Mobile Money</SelectItem>
                <SelectItem value="airtel">Airtel Money</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="referenceNumber">Reference Number (Optional)</Label>
            <Input
              id="referenceNumber"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Transaction reference"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!amount || parseFloat(amount) <= 0 || loading}
            >
              {loading ? "Processing..." : "Add Payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}