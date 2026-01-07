'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Fuel, 
  Play, 
  Square, 
  Pause, 
  CheckCircle, 
  AlertCircle,
  Clock,
  Droplets,
  Gauge,
  Power,
  History,
  DollarSign,
  Tag,
  Receipt
} from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils';
import {
  getDispenserStateColor,
  getDispenserStateLabel,
  formatDuration,
  formatCurrency,
  parseDispenserStateMeta,
} from '@/lib/dispense-utils';
import { ReceiptModal } from '@/components/receipt-modal';

interface FillingStationCardProps {
  deviceId: string;
  siteName: string;
  telemetry: {
    oilPercent: number;
    oilLiters: number;
    flowLpm: number;
    pumpState: boolean;
    safetyStatus: string;
    meta?: any;
  } | null;
  isOwner: boolean;
  onSendCommand: (type: string, payload?: any) => Promise<void>;
  commandLoading: boolean;
}

interface Transaction {
  id: string;
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

export function FillingStationCard({
  deviceId,
  siteName,
  telemetry,
  isOwner,
  onSendCommand,
  commandLoading,
}: FillingStationCardProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [targetLiters, setTargetLiters] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [settingPrice, setSettingPrice] = useState(false);

  // Parse dispenser state from telemetry meta
  const dispenserMeta = telemetry?.meta ? parseDispenserStateMeta(telemetry.meta) : {};
  const dispenserState = dispenserMeta.dispenserState || 'UNKNOWN';
  const isDispensing = dispenserState === 'DISPENSING';
  const isPaused = dispenserState === 'PAUSED';
  const isActive = isDispensing || isPaused;
  
  // Pricing info from telemetry
  const currentPrice = dispenserMeta.pricePerLiter ?? 0;
  const currentCurrency = dispenserMeta.currency || 'ZMW';
  const liveTotalCost = dispenserMeta.totalCost ?? 0;

  // Fetch recent transactions
  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const res = await fetch(`/api/devices/${deviceId}/transactions?limit=20`);
        if (res.ok) {
          const data = await res.json();
          setTransactions(data.transactions || []);
        }
      } catch (e) {
        console.error('Failed to fetch transactions:', e);
      } finally {
        setLoadingTransactions(false);
      }
    };

    fetchTransactions();
    const interval = setInterval(fetchTransactions, 10000);
    return () => clearInterval(interval);
  }, [deviceId]);

  const handleRemoteStop = async () => {
    await onSendCommand('PUMP_OFF');
  };

  const handleRemoteStart = async () => {
    if (!targetLiters) return;
    await onSendCommand('DISPENSE_TARGET', { liters: parseFloat(targetLiters) });
    setTargetLiters('');
  };

  const handleSetPrice = async () => {
    const price = parseFloat(newPrice);
    if (isNaN(price) || price < 0 || price > 10000) return;
    
    setSettingPrice(true);
    try {
      await onSendCommand('SET_PRICE_PER_LITER', { price });
      setPriceDialogOpen(false);
      setNewPrice('');
    } finally {
      setSettingPrice(false);
    }
  };

  const progress = isActive && dispenserMeta.targetLiters && dispenserMeta.dispensedLiters
    ? (dispenserMeta.dispensedLiters / dispenserMeta.targetLiters) * 100
    : 0;

  return (
    <Card className="border-2 rounded-2xl">
      <CardHeader className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-t-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-100 rounded-xl">
              <Fuel className="h-6 w-6 text-cyan-600" />
            </div>
            <div>
              <CardTitle className="text-lg">Filling Station Mode</CardTitle>
              <CardDescription>Real-time dispenser status and controls</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Price Display */}
            <div className="text-right mr-2">
              <div className="text-xs text-muted-foreground">Price/Liter</div>
              <div className="font-bold text-cyan-700">
                {formatCurrency(currentPrice, currentCurrency)}
              </div>
            </div>
            <Badge className={`${getDispenserStateColor(dispenserState)} border px-3 py-1`}>
              {getDispenserStateLabel(dispenserState)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {/* Live Status Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-secondary/30 rounded-xl">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Droplets className="h-4 w-4" />
              Tank Level
            </div>
            <div className="text-2xl font-bold">
              {telemetry?.oilPercent?.toFixed(1) ?? '--'}%
            </div>
            <div className="text-xs text-muted-foreground">
              {telemetry?.oilLiters?.toFixed(0) ?? '--'} L available
            </div>
          </div>

          <div className="p-4 bg-secondary/30 rounded-xl">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Gauge className="h-4 w-4" />
              Flow Rate
            </div>
            <div className="text-2xl font-bold">
              {telemetry?.flowLpm?.toFixed(2) ?? '--'}
            </div>
            <div className="text-xs text-muted-foreground">L/min</div>
          </div>

          <div className="p-4 bg-secondary/30 rounded-xl">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Power className="h-4 w-4" />
              Pump
            </div>
            <div className={`text-2xl font-bold ${telemetry?.pumpState ? 'text-green-600' : ''}`}>
              {telemetry?.pumpState ? 'ON' : 'OFF'}
            </div>
            <div className="text-xs text-muted-foreground">
              {telemetry?.safetyStatus ?? '--'}
            </div>
          </div>

          <div className="p-4 bg-secondary/30 rounded-xl">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <History className="h-4 w-4" />
              Transactions
            </div>
            <div className="text-2xl font-bold">
              {dispenserMeta.transactionCounter ?? '--'}
            </div>
            <div className="text-xs text-muted-foreground">Total count</div>
          </div>
        </div>

        {/* Active Session Display */}
        {isActive && (
          <div className="p-5 bg-cyan-50 border border-cyan-200 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-cyan-900 flex items-center gap-2">
                {isDispensing ? (
                  <>
                    <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse" />
                    Active Dispensing Session
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4 text-yellow-600" />
                    Session Paused
                  </>
                )}
              </h4>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-cyan-700 mb-1">Target</div>
                <div className="text-xl font-bold text-cyan-900">
                  {dispenserMeta.targetLiters?.toFixed(1) ?? '--'} L
                </div>
              </div>
              <div>
                <div className="text-xs text-cyan-700 mb-1">Dispensed</div>
                <div className="text-xl font-bold text-cyan-900">
                  {dispenserMeta.dispensedLiters?.toFixed(2) ?? '--'} L
                </div>
              </div>
              <div>
                <div className="text-xs text-cyan-700 mb-1">Price/L</div>
                <div className="text-xl font-bold text-cyan-700">
                  {formatCurrency(currentPrice, currentCurrency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-amber-700 mb-1 flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  Total Cost
                </div>
                <div className="text-xl font-bold text-amber-700">
                  {formatCurrency(liveTotalCost, currentCurrency)}
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-cyan-700 mb-1">
                <span>Progress</span>
                <span>{progress.toFixed(0)}%</span>
              </div>
              <Progress value={progress} className="h-3" />
            </div>
          </div>
        )}

        {/* Remote Controls (Owner Only) */}
        {isOwner && (
          <div className="space-y-4">
            <h4 className="font-medium text-sm text-muted-foreground">Remote Controls</h4>
            <div className="flex flex-wrap gap-3 items-end">
              {/* Set Price Button */}
              <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Tag className="h-4 w-4" />
                    Set Price
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[400px]">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Tag className="h-5 w-5" />
                      Set Price Per Liter
                    </DialogTitle>
                    <DialogDescription>
                      Configure the price per liter for {siteName}. This will be applied to all future dispenses.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Current Price</label>
                      <div className="text-2xl font-bold text-cyan-700">
                        {formatCurrency(currentPrice, currentCurrency)}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">New Price ({currentCurrency})</label>
                      <Input
                        type="number"
                        min={0}
                        max={10000}
                        step={0.01}
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        placeholder="0.00"
                        className="text-lg"
                      />
                      <p className="text-xs text-muted-foreground">
                        Enter a value between 0 and 10,000
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPriceDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleSetPrice} 
                      disabled={settingPrice || !newPrice}
                      className="bg-cyan-600 hover:bg-cyan-700"
                    >
                      {settingPrice ? 'Sending...' : 'Set Price'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Emergency Stop */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    disabled={commandLoading}
                    className="gap-2"
                  >
                    <Square className="h-4 w-4" />
                    Emergency Stop
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Emergency Stop</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will immediately turn OFF the pump for {siteName}. 
                      Any active dispensing will be interrupted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRemoteStop}>
                      Stop Pump
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Remote Start */}
              <div className="flex gap-2 items-end">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Target Liters
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={targetLiters}
                    onChange={(e) => setTargetLiters(e.target.value)}
                    className="w-24"
                    placeholder="50"
                  />
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="default"
                      disabled={commandLoading || !targetLiters || isActive}
                      className="gap-2 bg-cyan-600 hover:bg-cyan-700"
                    >
                      <Play className="h-4 w-4" />
                      Remote Start
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Start Remote Dispense?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remotely start a dispense of {targetLiters} liters 
                        on {siteName}. Make sure someone is present at the device.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRemoteStart}>
                        Start Dispense
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        )}

        {/* Recent Transactions */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Transactions
            </h4>
          </div>

          {loadingTransactions ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No dispense transactions yet
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/30">
                    <TableHead className="text-xs">Time</TableHead>
                    <TableHead className="text-xs">Result</TableHead>
                    <TableHead className="text-xs text-right">Target</TableHead>
                    <TableHead className="text-xs text-right">Dispensed</TableHead>
                    <TableHead className="text-xs text-right">Cost</TableHead>
                    <TableHead className="text-xs text-right">Duration</TableHead>
                    <TableHead className="text-xs"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.slice(0, 10).map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-xs">
                        {formatTimeAgo(tx.ts)}
                      </TableCell>
                      <TableCell>
                        {tx.result === 'SUCCESS' ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Done
                          </Badge>
                        ) : tx.result === 'ERROR' ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Error
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {tx.type}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {tx.targetLiters?.toFixed(1) ?? '--'} L
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {tx.dispensedLiters?.toFixed(2) ?? '--'} L
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono font-medium text-amber-700">
                        {tx.totalCost !== undefined 
                          ? formatCurrency(tx.totalCost, tx.currency) 
                          : '--'}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {formatDuration(tx.durationSec)}
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        {(tx.result === 'SUCCESS' || tx.result === 'ERROR') && tx.pricePerLiter !== undefined && (
                          <ReceiptModal
                            transaction={{
                              id: tx.id,
                              siteName,
                              deviceId,
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
                                <Receipt className="h-3.5 w-3.5" />
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
          )}
        </div>
      </CardContent>
    </Card>
  );
}
