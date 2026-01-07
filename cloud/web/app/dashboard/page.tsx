'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatTimeAgo, formatDateTime, getStatusColor } from '@/lib/utils';
import { Search, Plus, RefreshCw, Wifi, WifiOff, Download, Settings, Droplet } from 'lucide-react';
import { ExportButton } from '@/components/export-button';
import { CustomizePanel, useDashboardPreferences } from '@/components/customize-panel';
import { motion, AnimatePresence } from 'framer-motion';
import { FadeIn, SlideIn, Stagger, cardVariants, hoverScale, tapScale } from '@/components/animations';
import { CardSkeleton } from '@/components/skeleton';

interface Device {
  id: string;
  deviceId: string;
  siteName: string;
  location?: string;
  status: string;
  lastSeenAt?: string;
  latestTelemetry?: {
    oilPercent: number;
    oilLiters: number;
    flowLpm: number;
    pumpState: boolean;
    ts: number;
  };
}

export default function DashboardPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const { preferences, savePreferences, isLoaded } = useDashboardPreferences();

  const fetchDevices = async () => {
    try {
      const res = await fetch('/api/devices');
      if (res.ok) {
        const data = await res.json();
        setDevices(data);
      }
    } catch (e) {
      console.error('Failed to fetch devices:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoaded) return;
    fetchDevices();
    const interval = setInterval(fetchDevices, parseInt(preferences.refreshInterval) * 1000);
    return () => clearInterval(interval);
  }, [preferences.refreshInterval, isLoaded]);

  const filteredDevices = devices.filter(device => {
    const matchesSearch = 
      device.siteName.toLowerCase().includes(search.toLowerCase()) ||
      device.deviceId.toLowerCase().includes(search.toLowerCase()) ||
      (device.location?.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === 'ALL' || device.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    ALL: devices.length,
    OK: devices.filter(d => d.status === 'OK').length,
    LOW: devices.filter(d => d.status === 'LOW').length,
    CRITICAL: devices.filter(d => d.status === 'CRITICAL').length,
    OFFLINE: devices.filter(d => d.status === 'OFFLINE').length,
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center mb-8">
          <div className="space-y-2">
            <div className="h-8 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-64 bg-muted animate-pulse rounded" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="notion-card p-6 space-y-2">
              <div className="h-8 w-16 bg-muted animate-pulse rounded" />
              <div className="h-4 w-12 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <FadeIn>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
          <h1 className="text-3xl font-bold">Tanks Overview</h1>
          <p className="text-muted-foreground">Monitoring {devices.length} tanks in real-time</p>
        </div>
        <div className="flex gap-2">
          <ExportButton 
            data={filteredDevices.map(d => ({
              deviceId: d.deviceId,
              siteName: d.siteName,
              location: d.location || '',
              status: d.status,
              oilPercent: d.latestTelemetry?.oilPercent?.toFixed(1) || '0',
              oilLiters: d.latestTelemetry?.oilLiters?.toFixed(1) || '0',
              flowRate: d.latestTelemetry?.flowLpm?.toFixed(1) || '0',
              pumpState: d.latestTelemetry?.pumpState ? 'ON' : 'OFF',
              lastSeen: d.lastSeenAt || 'Never'
            }))}
            filename={`tanks-report-${new Date().toISOString().split('T')[0]}`}
            title="Fleet Tank Status Report"
            type="excel"
          />
          <ExportButton 
            data={filteredDevices.map(d => ({
              deviceId: d.deviceId,
              siteName: d.siteName,
              location: d.location || '',
              status: d.status,
              oilPercent: d.latestTelemetry?.oilPercent?.toFixed(1) || '0',
              oilLiters: d.latestTelemetry?.oilLiters?.toFixed(1) || '0',
              flowRate: d.latestTelemetry?.flowLpm?.toFixed(1) || '0',
              pumpState: d.latestTelemetry?.pumpState ? 'ON' : 'OFF',
              lastSeen: d.lastSeenAt || 'Never'
            }))}
            filename={`tanks-report-${new Date().toISOString().split('T')[0]}`}
            title="Fleet Tank Status Report"
            type="pdf"
          />
          <Button variant="outline" size="sm" onClick={() => setCustomizeOpen(true)}>
            <Settings className="h-4 w-4 mr-2" />
            Customize
          </Button>
          <Link href="/dashboard/provision">
            <Button><Plus className="h-4 w-4 mr-2" />Add Tank</Button>
          </Link>
        </div>
      </div>
      </FadeIn>
      
      <CustomizePanel 
        isOpen={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        preferences={preferences}
        onSave={savePreferences}
      />
      
      <SlideIn delay={0.1}>
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name, ID, or location..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 transition-all duration-200 focus:shadow-lg" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48 transition-all duration-200 hover:border-primary/50"><SelectValue placeholder="Filter by status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All ({statusCounts.ALL})</SelectItem>
              <SelectItem value="OK">OK ({statusCounts.OK})</SelectItem>
              <SelectItem value="LOW">Low ({statusCounts.LOW})</SelectItem>
              <SelectItem value="CRITICAL">Critical ({statusCounts.CRITICAL})</SelectItem>
              <SelectItem value="OFFLINE">Offline ({statusCounts.OFFLINE})</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SlideIn>
      
      <Stagger staggerDelay={0.05}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { count: statusCounts.OK, label: 'OK', color: 'text-green-600', bgColor: 'bg-green-50 dark:bg-green-950/20' },
            { count: statusCounts.LOW, label: 'Low', color: 'text-yellow-600', bgColor: 'bg-yellow-50 dark:bg-yellow-950/20' },
            { count: statusCounts.CRITICAL, label: 'Critical', color: 'text-red-600', bgColor: 'bg-red-50 dark:bg-red-950/20' },
            { count: statusCounts.OFFLINE, label: 'Offline', color: 'text-gray-600', bgColor: 'bg-gray-50 dark:bg-gray-950/20' },
          ].map((stat, i) => (
            <motion.div 
              key={stat.label}
              variants={cardVariants}
              whileHover={hoverScale}
              whileTap={tapScale}
              className={`notion-card p-6 text-center cursor-pointer ${stat.bgColor}`}
            >
              <div className={`text-4xl font-bold ${stat.color} mb-2`}>{stat.count}</div>
              <div className="text-sm text-muted-foreground font-medium">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </Stagger>
      
      <AnimatePresence mode="wait">
        {filteredDevices.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-center py-20"
          >
            <div className="max-w-md mx-auto">
              {devices.length === 0 ? (
                <FadeIn delay={0.2}>
                  <div className="notion-card p-12">
                    <Droplet className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No Tanks Yet</h3>
                    <p className="text-muted-foreground mb-6">Get started by adding your first oil tank to the system.</p>
                    <Link href="/dashboard/provision">
                      <Button className="transition-transform hover:scale-105 active:scale-95">
                        <Plus className="h-4 w-4 mr-2" />Add Your First Tank
                      </Button>
                    </Link>
                  </div>
                </FadeIn>
              ) : (
                <p className="text-muted-foreground">No tanks match your search criteria.</p>
              )}
            </div>
          </motion.div>
        ) : (
          <Stagger staggerDelay={0.03}>
            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${preferences.gridColumns} gap-6`}>
              {filteredDevices.map((device, index) => (
                <motion.div 
                  key={device.deviceId}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  transition={{ delay: index * 0.03 }}
                >
                  <Link href={`/dashboard/devices/${device.deviceId}`}>
                    <motion.div 
                      whileHover={{ scale: 1.02, y: -4 }}
                      whileTap={{ scale: 0.98 }}
                      className="notion-card p-6 flex flex-col gap-3 h-full group cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <Badge className={`${getStatusColor(device.status)} transition-all duration-200`}>{device.status}</Badge>
                        {preferences.showLastSeen && (
                          <span 
                            className="text-xs text-muted-foreground flex items-center gap-1 cursor-help transition-colors group-hover:text-foreground"
                            title={device.lastSeenAt ? `Last seen: ${formatDateTime(device.lastSeenAt)}` : 'Never connected'}
                          >
                            {device.status === 'OFFLINE' ? (
                              <WifiOff className="h-3 w-3" />
                            ) : (
                              <Wifi className="h-3 w-3" />
                            )}
                            {device.lastSeenAt ? formatTimeAgo(device.lastSeenAt) : 'Never'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-2 mt-2">
                        <motion.span 
                          className="text-5xl font-bold transition-colors group-hover:text-primary"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 200, delay: index * 0.03 + 0.2 }}
                        >
                          {device.latestTelemetry?.oilPercent?.toFixed(0) ?? '--'}
                        </motion.span>
                        <span className="text-xl text-muted-foreground">%</span>
                      </div>
                      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                        <motion.div 
                          className={`h-full ${device.status === 'OK' ? 'bg-green-500' : device.status === 'LOW' ? 'bg-yellow-500' : device.status === 'CRITICAL' ? 'bg-red-500' : 'bg-gray-400'}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${device.latestTelemetry?.oilPercent ?? 0}%` }}
                          transition={{ duration: 1, delay: index * 0.03 + 0.3, ease: "easeOut" }}
                        />
                      </div>
                      <div className="mt-1">
                        <div className="font-semibold truncate text-lg group-hover:text-primary transition-colors">{device.siteName}</div>
                        {preferences.showLocation && device.location && (
                          <div className="text-sm text-muted-foreground truncate">{device.deviceId} • {device.location}</div>
                        )}
                        {!preferences.showLocation && (
                          <div className="text-sm text-muted-foreground truncate">{device.deviceId}</div>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-sm text-muted-foreground mt-2 pt-3 border-t border-border/50">
                        <span className="font-medium">{device.latestTelemetry?.oilLiters?.toFixed(0) ?? '--'} L</span>
                        {preferences.showFlowRate && (
                          <span>{device.latestTelemetry?.flowLpm?.toFixed(1) ?? '--'} L/min</span>
                        )}
                        {preferences.showPumpState && (
                          <motion.span 
                            className={device.latestTelemetry?.pumpState ? 'text-green-600 font-semibold' : ''}
                            animate={device.latestTelemetry?.pumpState ? { scale: [1, 1.1, 1] } : {}}
                            transition={{ repeat: Infinity, duration: 2 }}
                          >
                            {device.latestTelemetry?.pumpState ? '⚡ ON' : 'OFF'}
                          </motion.span>
                        )}
                      </div>
                    </motion.div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </Stagger>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
