import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface BulkUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (updates: Record<string, any>) => Promise<void>;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'select';
    options?: Array<{ label: string; value: string }>;
  }>;
  selectedCount: number;
}

export function BulkUpdateDialog({
  open,
  onOpenChange,
  onUpdate,
  fields,
  selectedCount,
}: BulkUpdateDialogProps) {
  const [updates, setUpdates] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onUpdate(updates);
      setUpdates({});
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Update</DialogTitle>
          <DialogDescription>
            Update {selectedCount} selected items. Only filled fields will be updated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>{field.label}</Label>
              {field.type === 'select' ? (
                <Select
                  value={updates[field.key] || ''}
                  onValueChange={(value) => setUpdates({ ...updates, [field.key]: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={field.key}
                  type={field.type}
                  value={updates[field.key] || ''}
                  onChange={(e) => setUpdates({ 
                    ...updates, 
                    [field.key]: field.type === 'number' ? parseFloat(e.target.value) : e.target.value 
                  })}
                  placeholder={`Update ${field.label.toLowerCase()}`}
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || Object.keys(updates).length === 0}>
            {loading ? "Updating..." : `Update ${selectedCount} Items`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
