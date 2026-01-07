'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, DollarSign, TrendingUp, Droplets, BarChart3 } from 'lucide-react';

interface ShiftData {
  date: string;
  totalTransactions: number;
  totalLiters: number;
  totalSales: number;
  totalProfit: number;
  currency: string;
}

interface ProfitData {
  dateRange: { from: string; to: string };
  totals: {
    totalTransactions: number;
    totalLiters: number;
    totalSales: number;
    totalProfit: number;
    totalCost: number;
    profitMargin: number;
    currency: string;
  };
  byDevice: Array<{
    deviceId: string;
    siteName: string;
    totalTransactions: number;
    totalLiters: number;
    totalSales: number;
    totalProfit: number;
  }>;
  byOperator: Array<{
    operatorId: string | null;
    operatorName: string;
    totalTransactions: number;
    totalLiters: number;
    totalSales: number;
    totalProfit: number;
  }>;
  dailyTrend: Array<{
    date: string;
    sales: number;
    profit: number;
    liters: number;
  }>;
}

interface Device {
  deviceId: string;
  siteName: string;
}

interface Operator {
  id: string;
  name: string;
}

export default function ReportsPage() {
  const { data: session, status } = useSession();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<Device[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);

  // Shift report state
  const [shiftData, setShiftData] = useState<{ shifts: ShiftData[]; totals: any } | null>(null);
  const [shiftFrom, setShiftFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [shiftTo, setShiftTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [shiftDeviceId, setShiftDeviceId] = useState<string>('all');
  const [shiftOperatorId, setShiftOperatorId] = useState<string>('all');

  // Profit report state
  const [profitData, setProfitData] = useState<ProfitData | null>(null);
  const [profitRange, setProfitRange] = useState<'7d' | '30d'>('30d');
  const [profitDeviceId, setProfitDeviceId] = useState<string>('all');

  // Auth check
  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/login');
    }
  }, [status]);

  // Fetch devices and operators
  useEffect(() => {
    if (status === 'authenticated') {
      Promise.all([
        fetch('/api/devices').then((r) => r.json()),
        fetch('/api/owner/operators').then((r) => r.json()).catch(() => ({ operators: [] })),
      ]).then(([devData, opData]) => {
        if (devData.ok) setDevices(devData.devices);
        if (opData.ok) setOperators(opData.operators);
      });
    }
  }, [status]);

  // Fetch shift report
  const fetchShiftReport = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        from: shiftFrom,
        to: shiftTo,
      });
      if (shiftDeviceId !== 'all') params.set('deviceId', shiftDeviceId);
      if (shiftOperatorId !== 'all') params.set('operatorId', shiftOperatorId);

      const res = await fetch(`/api/reports/shifts?${params}`);
      const data = await res.json();
      if (data.ok) {
        setShiftData({ shifts: data.shifts, totals: data.totals });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load shift report', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Fetch profit report
  const fetchProfitReport = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ range: profitRange });
      if (profitDeviceId !== 'all') params.set('deviceId', profitDeviceId);

      const res = await fetch(`/api/reports/profit?${params}`);
      const data = await res.json();
      if (data.ok) {
        setProfitData(data);
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load profit report', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchShiftReport();
      fetchProfitReport();
    }
  }, [status]);

  // Format currency
  const formatCurrency = (amount: number, currency: string = 'ZMW') => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="text-muted-foreground">View shift totals and profit analysis</p>
      </div>

      <Tabs defaultValue="shifts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="shifts">Shift Totals</TabsTrigger>
          <TabsTrigger value="profit">Profit Report</TabsTrigger>
        </TabsList>

        {/* Shift Totals Tab */}
        <TabsContent value="shifts" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input
                    type="date"
                    value={shiftFrom}
                    onChange={(e) => setShiftFrom(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input
                    type="date"
                    value={shiftTo}
                    onChange={(e) => setShiftTo(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Device</Label>
                  <Select value={shiftDeviceId} onValueChange={setShiftDeviceId}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Devices</SelectItem>
                      {devices.map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.siteName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Operator</Label>
                  <Select value={shiftOperatorId} onValueChange={setShiftOperatorId}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Operators</SelectItem>
                      {operators.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button onClick={fetchShiftReport} disabled={loading}>
                    {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Apply'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Totals Summary */}
          {shiftData && (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{shiftData.totals.totalTransactions}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Liters</CardTitle>
                    <Droplets className="h-4 w-4 text-blue-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{shiftData.totals.totalLiters.toFixed(2)} L</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
                    <DollarSign className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(shiftData.totals.totalSales, shiftData.totals.currency)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Profit</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(shiftData.totals.totalProfit, shiftData.totals.currency)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Daily Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle>Daily Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                        <TableHead className="text-right">Liters</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shiftData.shifts.map((shift) => (
                        <TableRow key={shift.date}>
                          <TableCell className="font-medium">{shift.date}</TableCell>
                          <TableCell className="text-right">{shift.totalTransactions}</TableCell>
                          <TableCell className="text-right">{shift.totalLiters.toFixed(2)} L</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(shift.totalSales, shift.currency)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(shift.totalProfit, shift.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {shiftData.shifts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            No data for selected period
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Profit Report Tab */}
        <TabsContent value="profit" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label>Range</Label>
                  <Select value={profitRange} onValueChange={(v) => setProfitRange(v as any)}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Device</Label>
                  <Select value={profitDeviceId} onValueChange={setProfitDeviceId}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Devices</SelectItem>
                      {devices.map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.siteName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button onClick={fetchProfitReport} disabled={loading}>
                    {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Apply'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {profitData && (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-5">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                    <DollarSign className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(profitData.totals.totalSales, profitData.totals.currency)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
                    <DollarSign className="h-4 w-4 text-red-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(profitData.totals.totalCost, profitData.totals.currency)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(profitData.totals.totalProfit, profitData.totals.currency)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Profit Margin</CardTitle>
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{profitData.totals.profitMargin}%</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Volume</CardTitle>
                    <Droplets className="h-4 w-4 text-blue-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{profitData.totals.totalLiters.toFixed(0)} L</div>
                  </CardContent>
                </Card>
              </div>

              {/* Charts placeholder - using simple bar representation */}
              <Card>
                <CardHeader>
                  <CardTitle>Daily Trend</CardTitle>
                  <CardDescription>Sales and profit over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {profitData.dailyTrend.slice(-14).map((day) => (
                      <div key={day.date} className="flex items-center gap-2">
                        <span className="w-24 text-sm text-muted-foreground">{day.date.slice(5)}</span>
                        <div className="flex-1 flex items-center gap-2">
                          <div
                            className="h-4 bg-blue-500 rounded"
                            style={{
                              width: `${Math.min(100, (day.sales / Math.max(...profitData.dailyTrend.map((d) => d.sales))) * 100)}%`,
                            }}
                          />
                          <span className="text-sm">{formatCurrency(day.sales)}</span>
                        </div>
                      </div>
                    ))}
                    {profitData.dailyTrend.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">No data for selected period</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Breakdown Tables */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* By Device */}
                <Card>
                  <CardHeader>
                    <CardTitle>By Device</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Site</TableHead>
                          <TableHead className="text-right">Sales</TableHead>
                          <TableHead className="text-right">Profit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profitData.byDevice.map((d) => (
                          <TableRow key={d.deviceId}>
                            <TableCell className="font-medium">{d.siteName}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(d.totalSales)}
                            </TableCell>
                            <TableCell className="text-right text-green-600">
                              {formatCurrency(d.totalProfit)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* By Operator */}
                <Card>
                  <CardHeader>
                    <CardTitle>By Operator</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Operator</TableHead>
                          <TableHead className="text-right">Sales</TableHead>
                          <TableHead className="text-right">Profit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profitData.byOperator.map((o) => (
                          <TableRow key={o.operatorId || 'unassigned'}>
                            <TableCell className="font-medium">{o.operatorName}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(o.totalSales)}
                            </TableCell>
                            <TableCell className="text-right text-green-600">
                              {formatCurrency(o.totalProfit)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
