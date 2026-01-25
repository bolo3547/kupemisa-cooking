"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Users, Plus, Search, Wallet, Star, Phone, Mail, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  balance: number;
  loyaltyPoints: number;
  totalSpent: number;
  totalLiters: number;
  _count: { transactions: number };
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const { toast } = useToast();

  // Form state
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [topupAmount, setTopupAmount] = useState("");
  const [topupMethod, setTopupMethod] = useState("CASH");

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      const res = await fetch("/api/customers");
      if (res.ok) {
        const data = await res.json();
        setCustomers(data);
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to load customers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const addCustomer = async () => {
    if (!newName) return;

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          phone: newPhone || null,
          email: newEmail || null,
        }),
      });

      if (res.ok) {
        toast({ title: "Success", description: "Customer added" });
        setAddOpen(false);
        setNewName("");
        setNewPhone("");
        setNewEmail("");
        fetchCustomers();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to add customer", variant: "destructive" });
    }
  };

  const addTopup = async () => {
    if (!selectedCustomer || !topupAmount) return;

    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(topupAmount),
          method: topupMethod,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toast({ title: "Success", description: `Credit added. New balance: K${data.newBalance.toFixed(2)}` });
        setTopupOpen(false);
        setTopupAmount("");
        fetchCustomers();
      } else {
        toast({ title: "Error", description: "Failed to add credit", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to add credit", variant: "destructive" });
    }
  };

  const deleteCustomer = async (id: string) => {
    if (!confirm("Are you sure you want to delete this customer?")) return;

    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Success", description: "Customer deleted" });
        fetchCustomers();
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete customer", variant: "destructive" });
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-2xl font-bold mb-6">Customers</h1>
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
        <h1 className="text-2xl font-bold">Customers</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Customer</DialogTitle>
              <DialogDescription>Create a customer account</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name *</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Customer name"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="e.g., 0971234567"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button onClick={addCustomer} disabled={!newName}>
                Add Customer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-10"
          placeholder="Search by name, phone, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Users className="h-4 w-4" />
              Total Customers
            </div>
            <div className="text-2xl font-bold">{customers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Wallet className="h-4 w-4" />
              Total Balance
            </div>
            <div className="text-2xl font-bold text-green-600">
              K{customers.reduce((sum, c) => sum + c.balance, 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Star className="h-4 w-4" />
              Total Points
            </div>
            <div className="text-2xl font-bold text-yellow-600">
              {customers.reduce((sum, c) => sum + c.loyaltyPoints, 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              Total Spent
            </div>
            <div className="text-2xl font-bold">
              K{customers.reduce((sum, c) => sum + c.totalSpent, 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Customer List */}
      <div className="space-y-3">
        {filteredCustomers.length > 0 ? (
          filteredCustomers.map((customer) => (
            <Card key={customer.id}>
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="font-medium text-lg">{customer.name}</div>
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mt-1">
                      {customer.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {customer.phone}
                        </span>
                      )}
                      {customer.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {customer.email}
                        </span>
                      )}
                      <span>{customer._count.transactions} purchases</span>
                      <span>{customer.totalLiters.toFixed(1)}L total</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Balance</div>
                      <div className="font-bold text-green-600">K{customer.balance.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Points</div>
                      <Badge variant="secondary" className="text-yellow-600">
                        <Star className="h-3 w-3 mr-1" />
                        {customer.loyaltyPoints}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setTopupOpen(true);
                        }}
                      >
                        <Wallet className="h-4 w-4 mr-1" />
                        Add Credit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteCustomer(customer.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {search ? "No customers match your search" : "No customers yet. Add your first customer!"}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Topup Dialog */}
      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Credit</DialogTitle>
            <DialogDescription>
              Add prepaid credit for {selectedCustomer?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount (ZMW) *</Label>
              <Input
                type="number"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder="e.g., 100"
              />
            </div>
            <div>
              <Label>Payment Method</Label>
              <select
                className="w-full border rounded px-3 py-2"
                value={topupMethod}
                onChange={(e) => setTopupMethod(e.target.value)}
              >
                <option value="CASH">Cash</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="BANK">Bank Transfer</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopupOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addTopup} disabled={!topupAmount}>
              Add Credit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
