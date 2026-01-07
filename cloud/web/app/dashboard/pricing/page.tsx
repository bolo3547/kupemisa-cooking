'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, RefreshCw, DollarSign, TrendingUp, Calendar, Globe } from 'lucide-react';

interface PriceSchedule {
  id: string;
  deviceId: string | null;
  siteName: string;
  currency: string;
  sellingPricePerLiter: number;
  costPricePerLiter: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  createdByEmail: string;
  isActive: boolean;
}

interface Device {
  deviceId: string;
  siteName: string;
}

export default function PricingPage() {
  const { data: session, status } = useSession();
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<PriceSchedule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [scheduleNextMonth, setScheduleNextMonth] = useState(false);

  // Form state
  const [formDeviceId, setFormDeviceId] = useState<string>('global');
  const [formSellingPrice, setFormSellingPrice] = useState('');
  const [formCostPrice, setFormCostPrice] = useState('');

  // Auth check
  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/login');
    }
  }, [status]);

  if (status === 'authenticated' && session?.user?.role !== 'OWNER') {
    redirect('/dashboard');
  }

  // Fetch schedules
  const fetchSchedules = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/owner/prices');
      const data = await res.json();
      if (data.ok) {
        setSchedules(data.schedules);
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load price schedules', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Fetch devices
  const fetchDevices = async () => {
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      if (data.ok) {
        setDevices(data.devices);
      }
    } catch (error) {
      console.error('Failed to load devices:', error);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchSchedules();
      fetchDevices();
    }
  }, [status]);

  // Add price schedule
  const handleAddSchedule = async () => {
    const selling = parseFloat(formSellingPrice);
    const cost = parseFloat(formCostPrice || '0');

    if (isNaN(selling) || selling < 0) {
      toast({ title: 'Error', description: 'Invalid selling price', variant: 'destructive' });
      return;
    }

    if (isNaN(cost) || cost < 0) {
      toast({ title: 'Error', description: 'Invalid cost price', variant: 'destructive' });
      return;
    }

    // Calculate effectiveFrom
    let effectiveFrom: string | undefined;
    if (scheduleNextMonth) {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(1);
      nextMonth.setHours(0, 0, 0, 0);
      effectiveFrom = nextMonth.toISOString();
    }

    try {
      const res = await fetch('/api/owner/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: formDeviceId === 'global' ? null : formDeviceId,
          sellingPricePerLiter: selling,
          costPricePerLiter: cost,
          effectiveFrom,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        toast({ title: 'Success', description: 'Price schedule created successfully' });
        setAddDialogOpen(false);
        setFormDeviceId('global');
        setFormSellingPrice('');
        setFormCostPrice('');
        setScheduleNextMonth(false);
        fetchSchedules();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to create price schedule', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to create price schedule', variant: 'destructive' });
    }
  };

  // Format currency
  const formatCurrency = (amount: number, currency: string = 'ZMW') => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-ZM', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Get current active prices
  const activeGlobalPrice = schedules.find((s) => s.deviceId === null && s.isActive);
  const activeDevicePrices = schedules.filter((s) => s.deviceId !== null && s.isActive);

  // Calculate profit margin
  const profitMargin = (selling: number, cost: number) => {
    if (selling === 0) return 0;
    return ((selling - cost) / selling * 100).toFixed(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Price Management</h1>
          <p className="text-muted-foreground">Set global and device-specific fuel prices</p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Set Price
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set New Price</DialogTitle>
              <DialogDescription>
                Create a new price schedule. This will close any existing schedule for the same scope.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={formDeviceId} onValueChange={setFormDeviceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select scope" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        Global (All Devices)
                      </div>
                    </SelectItem>
                    {devices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.deviceId} - {d.siteName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="selling-price">Selling Price per Liter (ZMW)</Label>
                <Input
                  id="selling-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formSellingPrice}
                  onChange={(e) => setFormSellingPrice(e.target.value)}
                  placeholder="e.g., 25.50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost-price">Cost Price per Liter (ZMW)</Label>
                <Input
                  id="cost-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formCostPrice}
                  onChange={(e) => setFormCostPrice(e.target.value)}
                  placeholder="e.g., 20.00 (for profit calculation)"
                />
                {formSellingPrice && formCostPrice && (
                  <p className="text-sm text-muted-foreground">
                    Profit margin: {profitMargin(parseFloat(formSellingPrice), parseFloat(formCostPrice))}%
                  </p>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="schedule-next"
                  checked={scheduleNextMonth}
                  onChange={(e) => setScheduleNextMonth(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="schedule-next" className="text-sm font-normal">
                  Schedule for next month (starts 1st of next month)
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddSchedule}>
                {scheduleNextMonth ? 'Schedule Price' : 'Set Price Now'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Active Prices */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Global Price Card */}
        <Card className={activeGlobalPrice ? 'border-green-500' : 'border-dashed'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Global Price</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {activeGlobalPrice ? (
              <>
                <div className="text-2xl font-bold">
                  {formatCurrency(activeGlobalPrice.sellingPricePerLiter)}/L
                </div>
                <p className="text-xs text-muted-foreground">
                  Cost: {formatCurrency(activeGlobalPrice.costPricePerLiter)}/L
                  {' · '}
                  Margin: {profitMargin(activeGlobalPrice.sellingPricePerLiter, activeGlobalPrice.costPricePerLiter)}%
                </p>
                <Badge variant="default" className="mt-2">Active</Badge>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No global price set</p>
            )}
          </CardContent>
        </Card>

        {/* Device-specific Prices */}
        {activeDevicePrices.map((price) => (
          <Card key={price.id} className="border-blue-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{price.siteName}</CardTitle>
              <Badge variant="secondary">{price.deviceId}</Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(price.sellingPricePerLiter)}/L
              </div>
              <p className="text-xs text-muted-foreground">
                Cost: {formatCurrency(price.costPricePerLiter)}/L
                {' · '}
                Margin: {profitMargin(price.sellingPricePerLiter, price.costPricePerLiter)}%
              </p>
              <Badge variant="default" className="mt-2">Override</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Price History */}
      <Card>
        <CardHeader>
          <CardTitle>Price History</CardTitle>
          <CardDescription>
            Timeline of all price schedules
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead>Selling Price</TableHead>
                <TableHead>Cost Price</TableHead>
                <TableHead>Margin</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead>Effective To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {schedule.deviceId ? (
                        <Badge variant="secondary">{schedule.siteName}</Badge>
                      ) : (
                        <Badge variant="outline">
                          <Globe className="mr-1 h-3 w-3" />
                          Global
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(schedule.sellingPricePerLiter)}/L
                  </TableCell>
                  <TableCell>
                    {formatCurrency(schedule.costPricePerLiter)}/L
                  </TableCell>
                  <TableCell>
                    {profitMargin(schedule.sellingPricePerLiter, schedule.costPricePerLiter)}%
                  </TableCell>
                  <TableCell>{formatDate(schedule.effectiveFrom)}</TableCell>
                  <TableCell>
                    {schedule.effectiveTo ? formatDate(schedule.effectiveTo) : '—'}
                  </TableCell>
                  <TableCell>
                    {schedule.isActive ? (
                      <Badge variant="default">Active</Badge>
                    ) : new Date(schedule.effectiveFrom) > new Date() ? (
                      <Badge variant="secondary">
                        <Calendar className="mr-1 h-3 w-3" />
                        Scheduled
                      </Badge>
                    ) : (
                      <Badge variant="outline">Ended</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {schedule.createdByEmail}
                  </TableCell>
                </TableRow>
              ))}
              {schedules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No price schedules found. Set your first price to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
