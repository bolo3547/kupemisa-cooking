'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { Droplet, Gauge, Activity, Wifi, Clock, Power } from 'lucide-react';
import { FillingStationCard } from '@/components/filling-station-card';

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

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchDevice(), fetchTelemetry()]).finally(() => setLoading(false));
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{device.siteName}</h1>
          <p className="text-muted-foreground">{device.deviceId} {device.location && `• ${device.location}`}</p>
        </div>
        <Badge className={getStatusColor(device.status)}>{device.status}</Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Oil Level</CardTitle>
            <Droplet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{latest?.oilPercent?.toFixed(1) ?? '--'}%</div>
            <p className="text-xs text-muted-foreground">{latest?.oilLiters?.toFixed(1) ?? '--'} liters</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Flow Rate</CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{latest?.flowLpm?.toFixed(2) ?? '--'}</div>
            <p className="text-xs text-muted-foreground">L/min</p>
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
