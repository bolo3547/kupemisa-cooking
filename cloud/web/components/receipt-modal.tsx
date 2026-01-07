'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Receipt, Copy, Download, CheckCircle, AlertCircle, Check } from 'lucide-react';
import { generateReceiptText, formatCurrency } from '@/lib/dispense-utils';

interface ReceiptModalProps {
  transaction: {
    id: string;
    siteName: string;
    deviceId: string;
    targetLiters?: number;
    dispensedLiters?: number;
    pricePerLiter?: number;
    totalCost?: number;
    currency?: string;
    durationSec?: number;
    transactionId?: number;
    ts: number;
    result: string;
    error?: string;
  };
  trigger?: React.ReactNode;
}

export function ReceiptModal({ transaction, trigger }: ReceiptModalProps) {
  const [copied, setCopied] = useState(false);
  const curr = transaction.currency || 'ZMW';
  const timestamp = new Date(transaction.ts);

  const receiptText = generateReceiptText({
    siteName: transaction.siteName,
    deviceId: transaction.deviceId,
    targetLiters: transaction.targetLiters,
    dispensedLiters: transaction.dispensedLiters,
    pricePerLiter: transaction.pricePerLiter,
    totalCost: transaction.totalCost,
    currency: curr,
    durationSec: transaction.durationSec,
    transactionId: transaction.transactionId,
    timestamp,
    result: transaction.result === 'SUCCESS' ? 'SUCCESS' : 'ERROR',
    error: transaction.error,
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(receiptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([receiptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${transaction.transactionId || transaction.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
            <Receipt className="h-3.5 w-3.5" />
            Receipt
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Dispense Receipt
          </DialogTitle>
          <DialogDescription>
            Transaction #{transaction.transactionId || 'N/A'}
          </DialogDescription>
        </DialogHeader>

        {/* Receipt Display */}
        <div className="bg-neutral-50 border rounded-xl p-4 font-mono text-sm space-y-3">
          {/* Header */}
          <div className="text-center border-b border-dashed pb-3 border-neutral-300">
            <div className="font-bold text-base">OIL DISPENSE RECEIPT</div>
          </div>

          {/* Site Info */}
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-neutral-500">Site:</span>
              <span className="font-medium">{transaction.siteName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Device:</span>
              <span>{transaction.deviceId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Date:</span>
              <span>{timestamp.toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Time:</span>
              <span>{timestamp.toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Divider */}
          <div className="border-b border-dashed border-neutral-300" />

          {/* Transaction Details */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-500">Price/Liter:</span>
              <span className="font-medium text-cyan-700">
                {formatCurrency(transaction.pricePerLiter, curr)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-neutral-500">Target:</span>
              <span>{(transaction.targetLiters ?? 0).toFixed(2)} L</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-neutral-500">Dispensed:</span>
              <span className="font-medium">{(transaction.dispensedLiters ?? 0).toFixed(2)} L</span>
            </div>
          </div>

          {/* Divider */}
          <div className="border-b border-dashed border-neutral-300" />

          {/* Total */}
          <div className="flex justify-between items-center text-sm pt-1">
            <span className="font-bold">TOTAL:</span>
            <span className="font-bold text-lg text-amber-700">
              {formatCurrency(transaction.totalCost, curr)}
            </span>
          </div>

          {/* Divider */}
          <div className="border-b border-dashed border-neutral-300" />

          {/* Status */}
          <div className="flex justify-between items-center text-xs">
            <span className="text-neutral-500">Status:</span>
            {transaction.result === 'SUCCESS' ? (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle className="h-3 w-3 mr-1" />
                Completed
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                <AlertCircle className="h-3 w-3 mr-1" />
                Error
              </Badge>
            )}
          </div>
          {transaction.error && (
            <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
              Error: {transaction.error}
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-neutral-500">Duration:</span>
            <span>{transaction.durationSec ?? 0} seconds</span>
          </div>

          {/* Footer */}
          <div className="text-center border-t border-dashed pt-3 border-neutral-300 text-xs text-neutral-400">
            Thank you for your business!
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-green-600" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy
              </>
            )}
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={handleDownload}
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
