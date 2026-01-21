'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Users,
  TrendingUp,
  Droplet,
  DollarSign,
  Award,
  RefreshCw,
  BarChart3,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

interface DailyData {
  date: string;
  liters: number;
  revenue: number;
  count: number;
}

interface OperatorPerformance {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  totalTransactions: number;
  totalLiters: number;
  totalRevenue: number;
  totalProfit: number;
  avgLitersPerTransaction: number;
  avgRevenuePerTransaction: number;
  commission: number;
  dailyData: DailyData[];
}

interface Totals {
  totalOperators: number;
  activeOperators: number;
  totalTransactions: number;
  totalLiters: number;
  totalRevenue: number;
  totalProfit: number;
  totalCommission: number;
}

function formatCurrency(amount: number | undefined, currency = 'ZMW'): string {
  if (amount === undefined || amount === null) return '--';
  return `K${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(num: number | undefined): string {
  if (num === undefined || num === null) return '--';
  return num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Mini sparkline chart component
function MiniChart({ data, color = 'primary' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  const colors: Record<string, string> = {
    primary: 'bg-primary',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    cyan: 'bg-cyan-500',
  };
  
  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((value, i) => (
        <div
          key={i}
          className={`w-2 ${colors[color] || colors.primary} rounded-t opacity-70 hover:opacity-100 transition-opacity`}
          style={{ height: `${(value / max) * 100}%`, minHeight: value > 0 ? '2px' : '0' }}
          title={`${value.toFixed(1)}`}
        />
      ))}
    </div>
  );
}

export default function PerformancePage() {
  const [operators, setOperators] = useState<OperatorPerformance[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [commissionRate, setCommissionRate] = useState(0.02);
  const [range, setRange] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<'totalRevenue' | 'totalLiters' | 'totalTransactions' | 'commission'>('totalRevenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/operators/performance?range=${range}`);
      const data = await res.json();
      if (data.ok) {
        setOperators(data.operators);
        setTotals(data.totals);
        setCommissionRate(data.commissionRate);
      }
    } catch (error) {
      console.error('Failed to fetch performance data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [range]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedOperators = [...operators].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const getRangeLabel = () => {
    switch (range) {
      case '24h': return 'Last 24 Hours';
      case '7d': return 'Last 7 Days';
      case '30d': return 'Last 30 Days';
      case 'all': return 'All Time';
      default: return 'Last 30 Days';
    }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? (
      <ChevronUp className="h-4 w-4 inline" />
    ) : (
      <ChevronDown className="h-4 w-4 inline" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Award className="h-7 w-7 text-amber-500" />
            Operator Performance
          </h1>
          <p className="text-muted-foreground">
            Track sales, commissions, and performance metrics for each operator
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {totals && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Active Operators</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totals.activeOperators}</div>
              <p className="text-xs text-muted-foreground">
                of {totals.totalOperators} total
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totals.totalTransactions.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">{getRangeLabel()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Liters</CardTitle>
              <Droplet className="h-4 w-4 text-cyan-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-cyan-600">{formatNumber(totals.totalLiters)} L</div>
              <p className="text-xs text-muted-foreground">{getRangeLabel()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(totals.totalRevenue)}</div>
              <p className="text-xs text-muted-foreground">{getRangeLabel()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Commission</CardTitle>
              <TrendingUp className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{formatCurrency(totals.totalCommission)}</div>
              <p className="text-xs text-muted-foreground">{(commissionRate * 100).toFixed(0)}% of revenue</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Operators Table */}
      <Card>
        <CardHeader>
          <CardTitle>Operator Leaderboard</CardTitle>
          <CardDescription>
            Performance metrics for {getRangeLabel().toLowerCase()}. Click column headers to sort.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">7-Day Trend</TableHead>
                  <TableHead 
                    className="text-right cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('totalTransactions')}
                  >
                    Transactions <SortIcon field="totalTransactions" />
                  </TableHead>
                  <TableHead 
                    className="text-right cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('totalLiters')}
                  >
                    Liters <SortIcon field="totalLiters" />
                  </TableHead>
                  <TableHead 
                    className="text-right cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('totalRevenue')}
                  >
                    Revenue <SortIcon field="totalRevenue" />
                  </TableHead>
                  <TableHead 
                    className="text-right cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('commission')}
                  >
                    Commission <SortIcon field="commission" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                      <p className="mt-2 text-sm text-muted-foreground">Loading performance data...</p>
                    </TableCell>
                  </TableRow>
                ) : sortedOperators.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No operator data available for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedOperators.map((op, index) => (
                    <TableRow key={op.id} className={!op.isActive ? 'opacity-50' : ''}>
                      <TableCell className="font-medium">
                        {index === 0 && <span className="text-amber-500">🥇</span>}
                        {index === 1 && <span className="text-gray-400">🥈</span>}
                        {index === 2 && <span className="text-amber-700">🥉</span>}
                        {index > 2 && <span className="text-muted-foreground">{index + 1}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{op.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Avg: {formatNumber(op.avgLitersPerTransaction)}L/tx
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {op.isActive ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-200">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <MiniChart 
                          data={op.dailyData.map(d => d.revenue)} 
                          color="emerald"
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {op.totalTransactions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-cyan-600">
                        {formatNumber(op.totalLiters)} L
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-emerald-600">
                        {formatCurrency(op.totalRevenue)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-amber-600">
                        {formatCurrency(op.commission)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Commission Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Commission Calculation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Current Rate:</strong> {(commissionRate * 100).toFixed(1)}% of total revenue
            </p>
            <p>
              Commission is automatically calculated based on each operator's sales revenue. 
              Use this data for payroll or bonus calculations.
            </p>
            <p className="text-xs">
              To adjust the commission rate, contact the system administrator.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
