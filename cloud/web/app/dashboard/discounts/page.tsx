"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Tag, Plus, Trash2, Percent, DollarSign } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Discount {
  id: string;
  code: string;
  description: string | null;
  discountPercent: number | null;
  discountAmount: number | null;
  minPurchase: number | null;
  maxUses: number | null;
  usedCount: number;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
}

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const { toast } = useToast();

  // Form state
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [minPurchase, setMinPurchase] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [validTo, setValidTo] = useState("");

  useEffect(() => {
    fetchDiscounts();
  }, []);

  const fetchDiscounts = async () => {
    try {
      const res = await fetch("/api/discounts");
      if (res.ok) {
        const data = await res.json();
        setDiscounts(data);
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to load discounts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const createDiscount = async () => {
    if (!code || !discountValue) return;

    try {
      const res = await fetch("/api/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          description: description || null,
          discountPercent: discountType === "percent" ? parseFloat(discountValue) : null,
          discountAmount: discountType === "amount" ? parseFloat(discountValue) : null,
          minPurchase: minPurchase ? parseFloat(minPurchase) : null,
          maxUses: maxUses ? parseInt(maxUses) : null,
          validTo: validTo || null,
        }),
      });

      if (res.ok) {
        toast({ title: "Success", description: "Discount code created" });
        setAddOpen(false);
        resetForm();
        fetchDiscounts();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to create discount", variant: "destructive" });
    }
  };

  const toggleDiscount = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch("/api/discounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive }),
      });

      if (res.ok) {
        fetchDiscounts();
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update discount", variant: "destructive" });
    }
  };

  const deleteDiscount = async (id: string) => {
    if (!confirm("Are you sure you want to delete this discount code?")) return;

    try {
      const res = await fetch(`/api/discounts?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Success", description: "Discount deleted" });
        fetchDiscounts();
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete discount", variant: "destructive" });
    }
  };

  const resetForm = () => {
    setCode("");
    setDescription("");
    setDiscountType("percent");
    setDiscountValue("");
    setMinPurchase("");
    setMaxUses("");
    setValidTo("");
  };

  const isExpired = (discount: Discount) => {
    if (!discount.validTo) return false;
    return new Date(discount.validTo) < new Date();
  };

  const isMaxedOut = (discount: Discount) => {
    if (!discount.maxUses) return false;
    return discount.usedCount >= discount.maxUses;
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-2xl font-bold mb-6">Discount Codes</h1>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Discount Codes</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Code
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Discount Code</DialogTitle>
              <DialogDescription>Create a promotional discount</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Code *</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g., SAVE10"
                  maxLength={20}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., 10% off for new customers"
                />
              </div>
              <div>
                <Label>Discount Type</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    type="button"
                    variant={discountType === "percent" ? "default" : "outline"}
                    onClick={() => setDiscountType("percent")}
                  >
                    <Percent className="h-4 w-4 mr-1" />
                    Percentage
                  </Button>
                  <Button
                    type="button"
                    variant={discountType === "amount" ? "default" : "outline"}
                    onClick={() => setDiscountType("amount")}
                  >
                    <DollarSign className="h-4 w-4 mr-1" />
                    Fixed Amount
                  </Button>
                </div>
              </div>
              <div>
                <Label>
                  {discountType === "percent" ? "Discount %" : "Discount Amount (ZMW)"} *
                </Label>
                <Input
                  type="number"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === "percent" ? "e.g., 10" : "e.g., 50"}
                />
              </div>
              <div>
                <Label>Minimum Purchase (ZMW)</Label>
                <Input
                  type="number"
                  value={minPurchase}
                  onChange={(e) => setMinPurchase(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>Max Uses</Label>
                <Input
                  type="number"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="Unlimited if empty"
                />
              </div>
              <div>
                <Label>Valid Until</Label>
                <Input
                  type="date"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createDiscount} disabled={!code || !discountValue}>
                Create Code
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Discount List */}
      <div className="space-y-3">
        {discounts.length > 0 ? (
          discounts.map((discount) => {
            const expired = isExpired(discount);
            const maxedOut = isMaxedOut(discount);

            return (
              <Card key={discount.id} className={expired || maxedOut ? "opacity-60" : ""}>
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Tag className="h-5 w-5 text-primary" />
                        <span className="font-mono font-bold text-lg">{discount.code}</span>
                        {discount.discountPercent && (
                          <Badge variant="secondary">{discount.discountPercent}% OFF</Badge>
                        )}
                        {discount.discountAmount && (
                          <Badge variant="secondary">K{discount.discountAmount} OFF</Badge>
                        )}
                        {expired && <Badge variant="destructive">Expired</Badge>}
                        {maxedOut && <Badge variant="destructive">Max Uses Reached</Badge>}
                        {!discount.isActive && <Badge variant="outline">Disabled</Badge>}
                      </div>
                      {discount.description && (
                        <p className="text-muted-foreground mt-1">{discount.description}</p>
                      )}
                      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mt-2">
                        {discount.minPurchase && <span>Min: K{discount.minPurchase}</span>}
                        <span>
                          Used: {discount.usedCount}
                          {discount.maxUses && `/${discount.maxUses}`}
                        </span>
                        {discount.validTo && (
                          <span>Expires: {new Date(discount.validTo).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`active-${discount.id}`}>Active</Label>
                        <Switch
                          id={`active-${discount.id}`}
                          checked={discount.isActive}
                          onCheckedChange={(checked) => toggleDiscount(discount.id, checked)}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteDiscount(discount.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No discount codes yet. Create your first promotional code!
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
