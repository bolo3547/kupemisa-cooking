'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatTimeAgo, getStatusColor, getSeverityColor, getCommandStatusColor } from '@/lib/utils';
import { Droplet, Gauge, Activity, Wifi, Clock, Power, Save, Eye, EyeOff } from 'lucide-react';
import { FillingStationCard } from '@/components/filling-station-card';
import { useToast } from '@/components/ui/use-toast';

interface DeviceData {
  id: string;
  deviceId: string;
  siteName: string;
  location?: string;
  status: string;
  lastSeenAt?: string;
  telemetry: Array<{
    ts: number;
    oilPercent: number;
    oilLiters: number;
    flowLpm: number;
    pumpState: boolean;
    safetyStatus: string;
    wifiRssi: number;
    meta?: any;
  }>;
  events: Array<{
    id: string;
    ts: number;
    type: string;
    severity: string;
    message: string;
  }>;
  commands: Array<{
    id: string;
    type: string;
    status: string;
    createdAt: string;
    payloadJson?: any;
    createdBy: { email: string };
  }>;
}

interface TelemetryPoint {
  ts: number;
  oilPercent: number;
  oilLiters: number;
  flowLpm: number;
  time: string;
}

interface UserSession {
  email: string;
  role: string;
}

export default function DeviceDetailPage() {
  const params = useParams();
  const deviceId = params.deviceId as string;

  const [device, setDevice] = useState<DeviceData | null>(null);
  const [chartData, setChartData] = useState<TelemetryPoint[]>([]);
  const [range, setRange] = useState('24h');
  const [loading, setLoading] = useState(true);
  const [commandLoading, setCommandLoading] = useState(false);
  const [targetLiters, setTargetLiters] = useState('');
  const [userSession, setUserSession] = useState<UserSession | null>(null);
  
  // WiFi settings state
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiLoading, setWifiLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  // Fetch user session
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUserSession(data.user);
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchSession();
  }, []);

  const fetchDevice = async () => {
    try {
      const res = await fetch(`/api/devices/${deviceId}`);
      if (res.ok) {
        const data = await res.json();
        setDevice(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTelemetry = async () => {
    try {
      const res = await fetch(`/api/devices/${deviceId}/telemetry?range=${range}`);
      if (res.ok) {
        const data = await res.json();
        setChartData(
          data.data.map((t: any) => ({
            ...t,
            time: new Date(t.ts).toLocaleTimeString(),
          }))
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch WiFi settings
  const fetchWifi = async () => {
    try {
      const res = await fetch(`/api/devices/${deviceId}/wifi`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.wifi) {
          setWifiSsid(data.wifi.ssid || '');
          setWifiPassword(data.wifi.password || '');
        }
      }
    } catch (e) {
      console.error('Failed to fetch WiFi settings:', e);
    }
  };

  // Save WiFi settings
  const saveWifi = async () => {
    if (!wifiSsid.trim()) {
      toast({ title: 'Error', description: 'WiFi SSID is required', variant: 'destructive' });
      return;
    }
    setWifiLoading(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}/wifi`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: wifiSsid.trim(), password: wifiPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: 'Success', description: 'WiFi settings saved. Device will connect on next restart.' });
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to save WiFi settings', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to save WiFi settings', variant: 'destructive' });
    }
    setWifiLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchDevice(), fetchTelemetry(), fetchWifi()]).finally(() => setLoading(false));
    const interval = setInterval(() => {
      fetchDevice();
      fetchTelemetry();
    }, 5000);
    return () => clearInterval(interval);
  }, [deviceId, range]);

  const sendCommand = async (type: string, payload?: any) => {
    setCommandLoading(true);
    try {
      await fetch(`/api/owner/devices/${deviceId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payloadJson: payload }),
      });
      fetchDevice();
    } catch (e) {
      console.error(e);
    }
    setCommandLoading(false);
  };

  if (loading || !device) {
    return <div className="text-center py-20 text-muted-foreground">Loading...</div>;
  }

  const latest = device.telemetry[0];
  const isOwner = userSession?.role === 'OWNER';

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{device.siteName}</h1>
          <p className="text-sm text-muted-foreground">{device.deviceId} {device.location && `• ${device.location}`}</p>
        </div>
        <Badge className={getStatusColor(device.status)}>{device.status}</Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 p-3 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Oil Level</CardTitle>
            <Droplet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl sm:text-3xl font-bold">{latest?.oilPercent?.toFixed(1) ?? '--'}%</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">{latest?.oilLiters?.toFixed(1) ?? '--'} liters</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 p-3 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Flow Rate</CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl sm:text-3xl font-bold">{latest?.flowLpm?.toFixed(2) ?? '--'}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">L/min</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pump</CardTitle>
            <Power className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{latest?.pumpState ? 'ON' : 'OFF'}</div>
            <p className="text-xs text-muted-foreground">{latest?.safetyStatus ?? '--'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Last Seen</CardTitle>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{device.lastSeenAt ? formatTimeAgo(device.lastSeenAt) : 'Never'}</div>
            <p className="text-xs text-muted-foreground">RSSI: {latest?.wifiRssi ?? '--'} dBm</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Telemetry</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant={range === '24h' ? 'default' : 'outline'} onClick={() => setRange('24h')}>24h</Button>
            <Button size="sm" variant={range === '7d' ? 'default' : 'outline'} onClick={() => setRange('7d')}>7d</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" domain={[0, 100]} />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="oilPercent" stroke="#2563eb" name="Oil %" dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="flowLpm" stroke="#16a34a" name="Flow L/min" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Filling Station Mode Card */}
      <FillingStationCard
        deviceId={device.deviceId}
        siteName={device.siteName}
        telemetry={latest ? {
          oilPercent: latest.oilPercent,
          oilLiters: latest.oilLiters,
          flowLpm: latest.flowLpm,
          pumpState: latest.pumpState,
          safetyStatus: latest.safetyStatus,
          meta: latest.meta,
        } : null}
        isOwner={isOwner}
        onSendCommand={sendCommand}
        commandLoading={commandLoading}
      />

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Remote Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="success" disabled={commandLoading}>Pump ON</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Turn Pump ON?</AlertDialogTitle>
                <AlertDialogDescription>This will remotely turn the pump ON for {device.siteName}.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => sendCommand('PUMP_ON')}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={commandLoading}>Pump OFF</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Turn Pump OFF?</AlertDialogTitle>
                <AlertDialogDescription>This will remotely turn the pump OFF for {device.siteName}.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => sendCommand('PUMP_OFF')}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="flex gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Target Liters</label>
              <Input type="number" min={1} value={targetLiters} onChange={e => setTargetLiters(e.target.value)} className="w-24" />
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="warning" disabled={commandLoading || !targetLiters}>Dispense</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Dispense {targetLiters} liters?</AlertDialogTitle>
                  <AlertDialogDescription>The pump will run until {targetLiters} liters are dispensed.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { sendCommand('DISPENSE_TARGET', { liters: parseFloat(targetLiters) }); setTargetLiters(''); }}>Confirm</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* WiFi Settings Card (Owner only) */}
      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              WiFi Settings
            </CardTitle>
            <CardDescription>
              Configure the WiFi network for this device to connect to. Changes take effect on device restart or next config fetch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="wifi-ssid">WiFi Network Name (SSID)</Label>
                <Input
                  id="wifi-ssid"
                  placeholder="Enter WiFi name"
                  value={wifiSsid}
                  onChange={(e) => setWifiSsid(e.target.value)}
                  maxLength={32}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wifi-password">WiFi Password</Label>
                <div className="relative">
                  <Input
                    id="wifi-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter WiFi password"
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    maxLength={64}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <Button onClick={saveWifi} disabled={wifiLoading || !wifiSsid.trim()}>
              {wifiLoading ? 'Saving...' : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save WiFi Settings
                </>
              )}
            </Button>
            {wifiSsid && (
              <p className="text-sm text-muted-foreground">
                Current: <span className="font-medium">{wifiSsid}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Commands History */}
      <Card>
        <CardHeader>
          <CardTitle>Commands</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {device.commands.length === 0 && <div className="text-muted-foreground py-2">No commands yet.</div>}
            {device.commands.map(cmd => (
              <div key={cmd.id} className="py-2 flex items-center gap-4">
                <Badge className={getCommandStatusColor(cmd.status)}>{cmd.status}</Badge>
                <span className="font-medium">{cmd.type}</span>
                {cmd.payloadJson && <span className="text-xs text-muted-foreground">{JSON.stringify(cmd.payloadJson)}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{formatTimeAgo(cmd.createdAt)} by {cmd.createdBy.email}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Events Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {device.events.length === 0 && <div className="text-muted-foreground py-2">No events yet.</div>}
            {device.events.map(evt => (
              <div key={evt.id} className="py-2 flex items-center gap-4">
                <Badge className={getSeverityColor(evt.severity)}>{evt.severity}</Badge>
                <span className="font-medium">{evt.type}</span>
                <span className="text-sm text-muted-foreground">{evt.message}</span>
                <span className="ml-auto text-xs text-muted-foreground">{formatTimeAgo(evt.ts)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
