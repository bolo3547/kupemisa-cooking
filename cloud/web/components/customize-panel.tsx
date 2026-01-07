'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, X } from 'lucide-react';

interface DashboardPreferences {
  showLocation: boolean;
  showFlowRate: boolean;
  showPumpState: boolean;
  showLastSeen: boolean;
  gridColumns: '2' | '3' | '4';
  sortBy: 'name' | 'status' | 'level';
  refreshInterval: '5' | '10' | '30';
}

const defaultPreferences: DashboardPreferences = {
  showLocation: true,
  showFlowRate: true,
  showPumpState: true,
  showLastSeen: true,
  gridColumns: '4',
  sortBy: 'name',
  refreshInterval: '5',
};

interface CustomizePanelProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: DashboardPreferences;
  onSave: (prefs: DashboardPreferences) => void;
}

export function CustomizePanel({ isOpen, onClose, preferences, onSave }: CustomizePanelProps) {
  const [localPrefs, setLocalPrefs] = useState(preferences);

  useEffect(() => {
    setLocalPrefs(preferences);
  }, [preferences]);

  const handleSave = () => {
    onSave(localPrefs);
    onClose();
  };

  const handleReset = () => {
    setLocalPrefs(defaultPreferences);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-96 bg-background border-l shadow-lg z-50 overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Customize Dashboard</h2>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <Card className="p-4 mb-4">
            <h3 className="font-medium mb-4">Display Options</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="showLocation">Show Location</Label>
                <Switch 
                  id="showLocation"
                  checked={localPrefs.showLocation}
                  onCheckedChange={(checked) => setLocalPrefs({...localPrefs, showLocation: checked})}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showFlowRate">Show Flow Rate</Label>
                <Switch 
                  id="showFlowRate"
                  checked={localPrefs.showFlowRate}
                  onCheckedChange={(checked) => setLocalPrefs({...localPrefs, showFlowRate: checked})}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showPumpState">Show Pump State</Label>
                <Switch 
                  id="showPumpState"
                  checked={localPrefs.showPumpState}
                  onCheckedChange={(checked) => setLocalPrefs({...localPrefs, showPumpState: checked})}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showLastSeen">Show Last Seen</Label>
                <Switch 
                  id="showLastSeen"
                  checked={localPrefs.showLastSeen}
                  onCheckedChange={(checked) => setLocalPrefs({...localPrefs, showLastSeen: checked})}
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 mb-4">
            <h3 className="font-medium mb-4">Layout</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="gridColumns">Grid Columns (Desktop)</Label>
                <Select 
                  value={localPrefs.gridColumns} 
                  onValueChange={(value) => setLocalPrefs({...localPrefs, gridColumns: value as any})}
                >
                  <SelectTrigger id="gridColumns" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 Columns</SelectItem>
                    <SelectItem value="3">3 Columns</SelectItem>
                    <SelectItem value="4">4 Columns</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          <Card className="p-4 mb-4">
            <h3 className="font-medium mb-4">Sorting & Refresh</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="sortBy">Sort By</Label>
                <Select 
                  value={localPrefs.sortBy} 
                  onValueChange={(value) => setLocalPrefs({...localPrefs, sortBy: value as any})}
                >
                  <SelectTrigger id="sortBy" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                    <SelectItem value="level">Oil Level</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="refreshInterval">Refresh Interval (seconds)</Label>
                <Select 
                  value={localPrefs.refreshInterval} 
                  onValueChange={(value) => setLocalPrefs({...localPrefs, refreshInterval: value as any})}
                >
                  <SelectTrigger id="refreshInterval" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 seconds</SelectItem>
                    <SelectItem value="10">10 seconds</SelectItem>
                    <SelectItem value="30">30 seconds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          <div className="flex gap-2">
            <Button onClick={handleSave} className="flex-1">Save Preferences</Button>
            <Button onClick={handleReset} variant="outline">Reset</Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function useDashboardPreferences() {
  const [preferences, setPreferences] = useState<DashboardPreferences>(defaultPreferences);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('dashboardPreferences');
    if (stored) {
      try {
        setPreferences(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse preferences:', e);
      }
    }
    setIsLoaded(true);
  }, []);

  const savePreferences = (prefs: DashboardPreferences) => {
    setPreferences(prefs);
    localStorage.setItem('dashboardPreferences', JSON.stringify(prefs));
  };

  return { preferences, savePreferences, isLoaded };
}
