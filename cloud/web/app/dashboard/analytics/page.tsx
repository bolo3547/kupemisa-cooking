'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Activity, Droplet, Zap, AlertTriangle, Download, Calendar } from 'lucide-react';
import { ExportButton } from '@/components/export-button';

interface AnalyticsData {
  totalDevices: number;
  activeDevices: number;
  avgOilLevel: number;
  totalCapacity: number;
  totalCurrent: number;
  criticalDevices: number;
  consumptionTrend: { date: string; liters: number }[];
  deviceStatusDistribution: { status: string; count: number }[];
  topConsumers: { deviceId: string; siteName: string; consumption: number }[];
  forecast: { date: string; predicted: number; confidence: number }[];
}

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6b7280'];

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [timeRange, setTimeRange] = useState('7d');

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/analytics?range=${timeRange}`);
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch (e) {
      console.error('Failed to fetch analytics:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !analytics) {
    return (
      <div className="flex items-center justify-center py-20">
        <Activity className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusData = analytics.deviceStatusDistribution.map((item, index) => ({
    ...item,
    fill: COLORS[index % COLORS.length],
  }));

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-8 w-8" />
            Analytics Dashboard
          </h1>
          <p className="text-muted-foreground">Insights, trends, and forecasting</p>
        </div>
        <div className="flex gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
          <ExportButton
            data={analytics.consumptionTrend}
            filename={`analytics-${timeRange}-${new Date().toISOString().split('T')[0]}`}
            title="Analytics Report"
            type="excel"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Total Devices</span>
            <Droplet className="h-5 w-5 text-blue-500" />
          </div>
          <div className="text-3xl font-bold">{analytics.totalDevices}</div>
          <p className="text-sm text-muted-foreground mt-1">
            {analytics.activeDevices} active
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Avg Oil Level</span>
            <TrendingUp className="h-5 w-5 text-green-500" />
          </div>
          <div className="text-3xl font-bold">{analytics.avgOilLevel.toFixed(1)}%</div>
          <p className="text-sm text-muted-foreground mt-1">
            Fleet average
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Total Capacity</span>
            <Zap className="h-5 w-5 text-purple-500" />
          </div>
          <div className="text-3xl font-bold">{analytics.totalCapacity.toFixed(0)}L</div>
          <p className="text-sm text-muted-foreground mt-1">
            {analytics.totalCurrent.toFixed(0)}L current
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Critical Alerts</span>
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div className="text-3xl font-bold text-red-600">{analytics.criticalDevices}</div>
          <p className="text-sm text-muted-foreground mt-1">
            Require attention
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Consumption Trend */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Consumption Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analytics.consumptionTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="liters" stroke="#3b82f6" strokeWidth={2} name="Liters" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Status Distribution */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Device Status Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ status, count }) => `${status}: ${count}`}
                outerRadius={100}
                dataKey="count"
              >
                {statusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Consumption Forecast */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">7-Day Forecast</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analytics.forecast}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="predicted" stroke="#8b5cf6" strokeWidth={2} name="Predicted" strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-sm text-muted-foreground mt-4">
            <TrendingUp className="inline h-4 w-4 mr-1" />
            Forecast based on historical consumption patterns
          </p>
        </Card>

        {/* Top Consumers */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Top Consumers</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics.topConsumers}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="siteName" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="consumption" fill="#f59e0b" name="Liters" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Insights */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Key Insights</h3>
        <div className="space-y-3">
          {analytics.avgOilLevel < 30 && (
            <div className="flex items-start gap-3 p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-900 dark:text-yellow-200">Low Fleet Average</p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">Average oil level is below 30%. Consider scheduling refills.</p>
              </div>
            </div>
          )}
          {analytics.criticalDevices > 0 && (
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <p className="font-medium text-red-900 dark:text-red-200">Critical Tanks Detected</p>
                <p className="text-sm text-red-700 dark:text-red-300">{analytics.criticalDevices} tank(s) require immediate attention.</p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
            <TrendingUp className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-200">Consumption Analysis</p>
              <p className="text-sm text-blue-700 dark:text-blue-300">Based on trends, expect {analytics.forecast[6]?.predicted.toFixed(0)}L consumption in 7 days.</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
