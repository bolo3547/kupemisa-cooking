'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDateTime } from '@/lib/utils';
import { Search, Activity, RefreshCw } from 'lucide-react';
import { ExportButton } from '@/components/export-button';

interface ActivityLog {
  id: string;
  userName: string;
  userEmail: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  description: string;
  ipAddress: string | null;
  createdAt: string;
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/activity-logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error('Failed to fetch activity logs:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.userName.toLowerCase().includes(search.toLowerCase()) ||
      log.userEmail.toLowerCase().includes(search.toLowerCase()) ||
      log.description.toLowerCase().includes(search.toLowerCase());
    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  const actionColors: Record<string, string> = {
    LOGIN: 'bg-blue-100 text-blue-800',
    LOGOUT: 'bg-gray-100 text-gray-800',
    CREATE_DEVICE: 'bg-green-100 text-green-800',
    UPDATE_DEVICE: 'bg-yellow-100 text-yellow-800',
    DELETE_DEVICE: 'bg-red-100 text-red-800',
    CREATE_COMMAND: 'bg-purple-100 text-purple-800',
    CREATE_OPERATOR: 'bg-green-100 text-green-800',
    UPDATE_OPERATOR: 'bg-yellow-100 text-yellow-800',
    DELETE_OPERATOR: 'bg-red-100 text-red-800',
    UPDATE_PRICING: 'bg-orange-100 text-orange-800',
    EXPORT_REPORT: 'bg-indigo-100 text-indigo-800',
    UPDATE_ALERT_RULE: 'bg-pink-100 text-pink-800',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-8 w-8" />
            Activity Logs
          </h1>
          <p className="text-muted-foreground">Track all user actions and system events</p>
        </div>
        <ExportButton 
          data={filteredLogs.map(log => ({
            timestamp: formatDateTime(log.createdAt),
            user: log.userName,
            email: log.userEmail,
            action: log.action,
            description: log.description,
            resourceType: log.resourceType || '',
            resourceId: log.resourceId || '',
            ipAddress: log.ipAddress || '',
          }))}
          filename={`activity-logs-${new Date().toISOString().split('T')[0]}`}
          title="Activity Logs Report"
          type="excel"
        />
      </div>
      
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by user, email, or description..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            className="pl-10" 
          />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Actions</SelectItem>
            <SelectItem value="LOGIN">Login</SelectItem>
            <SelectItem value="CREATE_DEVICE">Create Device</SelectItem>
            <SelectItem value="UPDATE_DEVICE">Update Device</SelectItem>
            <SelectItem value="DELETE_DEVICE">Delete Device</SelectItem>
            <SelectItem value="CREATE_COMMAND">Create Command</SelectItem>
            <SelectItem value="CREATE_OPERATOR">Create Operator</SelectItem>
            <SelectItem value="EXPORT_REPORT">Export Report</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filteredLogs.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          No activity logs found
        </Card>
      ) : (
        <Card>
          <div className="divide-y">
            {filteredLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={actionColors[log.action] || 'bg-gray-100 text-gray-800'}>
                        {log.action.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-sm font-medium truncate">{log.userName}</span>
                      <span className="text-sm text-muted-foreground truncate">{log.userEmail}</span>
                    </div>
                    <p className="text-sm text-foreground">{log.description}</p>
                    {log.resourceType && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.resourceType} {log.resourceId && `• ${log.resourceId}`}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </div>
                    {log.ipAddress && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {log.ipAddress}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
