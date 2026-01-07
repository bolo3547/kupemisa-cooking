'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  History, 
  CheckCircle, 
  AlertCircle, 
  Filter, 
  Download,
  ChevronLeft,
  ChevronRight,
  Fuel,
  Search,
  DollarSign,
  Receipt
} from 'lucide-react';
import Link from 'next/link';
import { formatDuration, formatCurrency } from '@/lib/dispense-utils';
import { ReceiptModal } from '@/components/receipt-modal';

interface Transaction {
  id: string;
  deviceId: string;
  siteName: string;
  location?: string;
  ts: number;
  time: string;
  type: string;
  result: string;
  targetLiters?: number;
  dispensedLiters?: number;
  durationSec?: number;
  transactionId?: number;
  error?: string;
  message: string;
  pricePerLiter?: number;
  totalCost?: number;
  currency?: string;
}

interface Device {
  deviceId: string;
  siteName: string;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  });

  // Filters
  const [range, setRange] = useState('7d');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch devices for filter dropdown
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const res = await fetch('/api/devices');
        if (res.ok) {
          const data = await res.json();
          setDevices(data.devices || []);
        }
      } catch (e) {
        console.error('Failed to fetch devices:', e);
      }
    };
    fetchDevices();
  }, []);

  // Fetch transactions
  const fetchTransactions = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        range,
        status: statusFilter,
        limit: String(pagination.limit),
        offset: String(offset),
      });

      if (deviceFilter !== 'all') {
        params.append('deviceId', deviceFilter);
      }

      const res = await fetch(`/api/transactions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setPagination(prev => ({
          ...prev,
          total: data.pagination.total,
          offset: data.pagination.offset,
          hasMore: data.pagination.hasMore,
        }));
      }
    } catch (e) {
      console.error('Failed to fetch transactions:', e);
    } finally {
      setLoading(false);
    }
  }, [range, deviceFilter, statusFilter, pagination.limit]);

  useEffect(() => {
    fetchTransactions(0);
  }, [range, deviceFilter, statusFilter]);

  const handlePrevPage = () => {
    const newOffset = Math.max(0, pagination.offset - pagination.limit);
    fetchTransactions(newOffset);
  };

  const handleNextPage = () => {
    if (pagination.hasMore) {
      fetchTransactions(pagination.offset + pagination.limit);
    }
  };

  // Filter transactions by search query (client-side)
  const filteredTransactions = searchQuery
    ? transactions.filter(
        tx =>
          tx.siteName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          tx.deviceId.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : transactions;

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  // Calculate summary stats
  const totalDispensed = transactions
    .filter(tx => tx.result === 'SUCCESS')
    .reduce((sum, tx) => sum + (tx.dispensedLiters || 0), 0);
  const totalRevenue = transactions
    .filter(tx => tx.result === 'SUCCESS')
    .reduce((sum, tx) => sum + (tx.totalCost || 0), 0);
  const successCount = transactions.filter(tx => tx.result === 'SUCCESS').length;
  const errorCount = transactions.filter(tx => tx.result === 'ERROR').length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <History className="h-7 w-7 text-muted-foreground" />
          Dispense Transactions
        </h1>
        <p className="text-muted-foreground mt-1">
          View all oil dispense transactions across your fleet
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200">
          <CardContent className="pt-6">
            <div className="text-sm text-amber-700 mb-1 flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Total Revenue
            </div>
            <div className="text-3xl font-bold text-amber-900">
              ZMW {totalRevenue.toFixed(2)}
            </div>
            <div className="text-xs text-amber-600 mt-1">In selected period</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-cyan-50 to-blue-50 border-cyan-200">
          <CardContent className="pt-6">
            <div className="text-sm text-cyan-700 mb-1">Total Dispensed</div>
            <div className="text-3xl font-bold text-cyan-900">
              {totalDispensed.toFixed(1)} L
            </div>
            <div className="text-xs text-cyan-600 mt-1">In selected period</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="pt-6">
            <div className="text-sm text-green-700 mb-1">Successful</div>
            <div className="text-3xl font-bold text-green-900">{successCount}</div>
            <div className="text-xs text-green-600 mt-1">Transactions</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-rose-50 border-red-200">
          <CardContent className="pt-6">
            <div className="text-sm text-red-700 mb-1">Errors</div>
            <div className="text-3xl font-bold text-red-900">{errorCount}</div>
            <div className="text-xs text-red-600 mt-1">Transactions</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-violet-50 border-purple-200">
          <CardContent className="pt-6">
            <div className="text-sm text-purple-700 mb-1">Total Records</div>
            <div className="text-3xl font-bold text-purple-900">{pagination.total}</div>
            <div className="text-xs text-purple-600 mt-1">Matching filters</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground block mb-1.5">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by site or device..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Date Range */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                Date Range
              </label>
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Device Filter */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                Device
              </label>
              <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All devices" />
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

            {/* Status Filter */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                Status
              </label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="DONE">Completed</SelectItem>
                  <SelectItem value="ERROR">Errors</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Transaction History</CardTitle>
            <CardDescription>
              Showing {filteredTransactions.length} of {pagination.total} transactions
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              Loading transactions...
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Fuel className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No transactions found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/30">
                      <TableHead className="text-xs font-medium">Time</TableHead>
                      <TableHead className="text-xs font-medium">Device</TableHead>
                      <TableHead className="text-xs font-medium">Site</TableHead>
                      <TableHead className="text-xs font-medium">Result</TableHead>
                      <TableHead className="text-xs font-medium text-right">Target (L)</TableHead>
                      <TableHead className="text-xs font-medium text-right">Dispensed (L)</TableHead>
                      <TableHead className="text-xs font-medium text-right">Price/L</TableHead>
                      <TableHead className="text-xs font-medium text-right">Total Cost</TableHead>
                      <TableHead className="text-xs font-medium text-right">Duration</TableHead>
                      <TableHead className="text-xs font-medium text-center">Receipt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTransactions.map((tx) => (
                      <TableRow key={tx.id} className="hover:bg-secondary/20">
                        <TableCell className="text-xs">
                          <div>{formatTime(tx.ts)}</div>
                        </TableCell>
                        <TableCell>
                          <Link 
                            href={`/dashboard/devices/${tx.deviceId}`}
                            className="text-xs font-mono text-blue-600 hover:underline"
                          >
                            {tx.deviceId}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {tx.siteName}
                          {tx.location && (
                            <span className="text-xs text-muted-foreground block">
                              {tx.location}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {tx.result === 'SUCCESS' ? (
                            <Badge 
                              variant="outline" 
                              className="bg-green-50 text-green-700 border-green-200 text-xs"
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Completed
                            </Badge>
                          ) : (
                            <Badge 
                              variant="outline" 
                              className="bg-red-50 text-red-700 border-red-200 text-xs"
                            >
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Error
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono">
                          {tx.targetLiters?.toFixed(1) ?? '--'}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono font-medium">
                          {tx.dispensedLiters?.toFixed(2) ?? '--'}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono text-cyan-700">
                          {tx.pricePerLiter !== undefined 
                            ? formatCurrency(tx.pricePerLiter, tx.currency)
                            : '--'}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono font-bold text-amber-700">
                          {tx.totalCost !== undefined 
                            ? formatCurrency(tx.totalCost, tx.currency)
                            : '--'}
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          {formatDuration(tx.durationSec)}
                        </TableCell>
                        <TableCell className="text-center">
                          {tx.pricePerLiter !== undefined && (
                            <ReceiptModal
                              transaction={{
                                id: tx.id,
                                siteName: tx.siteName,
                                deviceId: tx.deviceId,
                                targetLiters: tx.targetLiters,
                                dispensedLiters: tx.dispensedLiters,
                                pricePerLiter: tx.pricePerLiter,
                                totalCost: tx.totalCost,
                                currency: tx.currency,
                                durationSec: tx.durationSec,
                                transactionId: tx.transactionId,
                                ts: tx.ts,
                                result: tx.result,
                                error: tx.error,
                              }}
                              trigger={
                                <Button variant="ghost" size="sm" className="h-7 px-2">
                                  <Receipt className="h-4 w-4" />
                                </Button>
                              }
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Page {Math.floor(pagination.offset / pagination.limit) + 1} of{' '}
                  {Math.ceil(pagination.total / pagination.limit)}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrevPage}
                    disabled={pagination.offset === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={!pagination.hasMore}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
