"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { Droplets, Plus, AlertTriangle, History, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Tank {
  id: string;
  deviceId: string;
  capacityLiters: number;
  currentLiters: number;
  lowThreshold: number;
  percentage: number;
  isLow: boolean;
  lastRefillAt: string | null;
  refills: Refill[];
}

interface Refill {
  id: string;
  litersAdded: number;
  costPerLiter: number | null;
  totalCost: number | null;
  supplier: string | null;
  invoiceNo: string | null;
  refilledAt: string;
}

interface Device {
  deviceId: string;
  siteName: string;
}

export default function TankPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [tank, setTank] = useState<Tank | null>(null);
  const [loading, setLoading] = useState(true);
  const [refillOpen, setRefillOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { toast } = useToast();

  // Refill form state
  const [refillLiters, setRefillLiters] = useState("");
  const [refillCost, setRefillCost] = useState("");
  const [refillSupplier, setRefillSupplier] = useState("");
  const [refillInvoice, setRefillInvoice] = useState("");

  // Settings form state
  const [capacity, setCapacity] = useState("");
  const [lowThreshold, setLowThreshold] = useState("");

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (selectedDevice) {
      fetchTank(selectedDevice);
    }
  }, [selectedDevice]);

  const fetchDevices = async () => {
    try {
      const res = await fetch("/api/devices");
      if (res.ok) {
        const data = await res.json();
        setDevices(data);
        if (data.length > 0) {
          setSelectedDevice(data[0].deviceId);
        }
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to load devices", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchTank = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/tank/${deviceId}`);
      if (res.ok) {
        const data = await res.json();
        setTank(data);
        setCapacity(data.capacityLiters.toString());
        setLowThreshold(data.lowThreshold.toString());
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to load tank info", variant: "destructive" });
    }
  };

  const addRefill = async () => {
    if (!selectedDevice || !refillLiters) return;

    try {
      const res = await fetch(`/api/tank/${selectedDevice}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          litersAdded: parseFloat(refillLiters),
          costPerLiter: refillCost ? parseFloat(refillCost) : null,
          supplier: refillSupplier || null,
          invoiceNo: refillInvoice || null,
        }),
      });

      if (res.ok) {
        toast({ title: "Success", description: "Refill recorded" });
        setRefillOpen(false);
        setRefillLiters("");
        setRefillCost("");
        setRefillSupplier("");
        setRefillInvoice("");
        fetchTank(selectedDevice);
      } else {
        toast({ title: "Error", description: "Failed to add refill", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to add refill", variant: "destructive" });
    }
  };

  const updateSettings = async () => {
    if (!selectedDevice) return;

    try {
      const res = await fetch(`/api/tank/${selectedDevice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capacityLiters: parseFloat(capacity),
          lowThreshold: parseFloat(lowThreshold),
        }),
      });

      if (res.ok) {
        toast({ title: "Success", description: "Tank settings updated" });
        setSettingsOpen(false);
        fetchTank(selectedDevice);
      } else {
        toast({ title: "Error", description: "Failed to update settings", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update settings", variant: "destructive" });
    }
  };

  const getTankColor = (percentage: number, isLow: boolean) => {
    if (isLow) return "bg-red-500";
    if (percentage < 30) return "bg-yellow-500";
    return "bg-green-500";
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-2xl font-bold mb-6">Tank Management</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Tank Management</h1>
        <div className="flex gap-2">
          <select
            className="border rounded px-3 py-2"
            value={selectedDevice || ""}
            onChange={(e) => setSelectedDevice(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.siteName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tank && (
        <>
          {/* Tank Level Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Droplets className="h-5 w-5" />
                    Tank Level
                  </CardTitle>
                  <CardDescription>Current oil level in tank</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Dialog open={refillOpen} onOpenChange={setRefillOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Refill
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Record Tank Refill</DialogTitle>
                        <DialogDescription>Enter the refill details</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Liters Added *</Label>
                          <Input
                            type="number"
                            value={refillLiters}
                            onChange={(e) => setRefillLiters(e.target.value)}
                            placeholder="e.g., 500"
                          />
                        </div>
                        <div>
                          <Label>Cost per Liter (ZMW)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={refillCost}
                            onChange={(e) => setRefillCost(e.target.value)}
                            placeholder="e.g., 35.00"
                          />
                        </div>
                        <div>
                          <Label>Supplier</Label>
                          <Input
                            value={refillSupplier}
                            onChange={(e) => setRefillSupplier(e.target.value)}
                            placeholder="Supplier name"
                          />
                        </div>
                        <div>
                          <Label>Invoice Number</Label>
                          <Input
                            value={refillInvoice}
                            onChange={(e) => setRefillInvoice(e.target.value)}
                            placeholder="Invoice #"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setRefillOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={addRefill} disabled={!refillLiters}>
                          Save Refill
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <Settings className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Tank Settings</DialogTitle>
                        <DialogDescription>Configure tank parameters</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Tank Capacity (Liters)</Label>
                          <Input
                            type="number"
                            value={capacity}
                            onChange={(e) => setCapacity(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label>Low Level Threshold (Liters)</Label>
                          <Input
                            type="number"
                            value={lowThreshold}
                            onChange={(e) => setLowThreshold(e.target.value)}
                          />
                          <p className="text-sm text-muted-foreground mt-1">
                            Alert when tank falls below this level
                          </p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={updateSettings}>Save Settings</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {tank.isLow && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-medium">Low Stock Alert!</span>
                    <span>Tank is below {tank.lowThreshold}L threshold</span>
                  </div>
                )}

                <div className="relative pt-8">
                  <div className="text-center mb-4">
                    <span className="text-4xl font-bold">{tank.currentLiters.toFixed(0)}</span>
                    <span className="text-muted-foreground">/{tank.capacityLiters}L</span>
                  </div>
                  <div className="h-8 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getTankColor(tank.percentage, tank.isLow)} transition-all`}
                      style={{ width: `${Math.min(tank.percentage, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-2 text-sm text-muted-foreground">
                    <span>0%</span>
                    <span className="font-medium">{tank.percentage.toFixed(1)}%</span>
                    <span>100%</span>
                  </div>
                </div>

                {tank.lastRefillAt && (
                  <p className="text-sm text-muted-foreground text-center">
                    Last refill: {new Date(tank.lastRefillAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Refill History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Refill History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tank.refills && tank.refills.length > 0 ? (
                <div className="space-y-3">
                  {tank.refills.map((refill) => (
                    <div
                      key={refill.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <div className="font-medium">+{refill.litersAdded}L</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(refill.refilledAt).toLocaleDateString()}
                          {refill.supplier && ` · ${refill.supplier}`}
                        </div>
                      </div>
                      <div className="text-right">
                        {refill.totalCost && (
                          <div className="font-medium">K{refill.totalCost.toFixed(2)}</div>
                        )}
                        {refill.costPerLiter && (
                          <div className="text-sm text-muted-foreground">
                            K{refill.costPerLiter.toFixed(2)}/L
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4">No refill history</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
