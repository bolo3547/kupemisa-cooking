"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Bell, Mail, MessageSquare, Shield, Save, Calendar, DollarSign } from "lucide-react";

interface NotificationPrefs {
  emailDailySummary: boolean;
  emailLowStock: boolean;
  emailTamper: boolean;
  pushSales: boolean;
  pushLowStock: boolean;
  pushTamper: boolean;
  whatsappReceipts: boolean;
  whatsappPhone: string | null;
}

interface ScheduledPrice {
  id: string;
  deviceId: string | null;
  newPricePerLiter: number;
  effectiveAt: string;
  applied: boolean;
}

interface PriceHistory {
  id: string;
  sellingPricePerLiter: number;
  effectiveFrom: string;
  device: { siteName: string } | null;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    emailDailySummary: true,
    emailLowStock: true,
    emailTamper: true,
    pushSales: true,
    pushLowStock: true,
    pushTamper: true,
    whatsappReceipts: false,
    whatsappPhone: null,
  });

  // Price schedule
  const [schedules, setSchedules] = useState<ScheduledPrice[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
  const [newPrice, setNewPrice] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      // Fetch notification preferences
      const notifRes = await fetch("/api/notifications/preferences");
      if (notifRes.ok) {
        const data = await notifRes.json();
        setNotifPrefs(data);
      }

      // Fetch price schedules
      const priceRes = await fetch("/api/price-schedule");
      if (priceRes.ok) {
        const data = await priceRes.json();
        setSchedules(data.schedules || []);
        setPriceHistory(data.priceHistory || []);
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to load settings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const saveNotifications = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notifPrefs),
      });

      if (res.ok) {
        toast({ title: "Success", description: "Notification settings saved" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const schedulePriceChange = async () => {
    if (!newPrice || !effectiveDate) return;

    try {
      const res = await fetch("/api/price-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPricePerLiter: parseFloat(newPrice),
          effectiveAt: effectiveDate,
        }),
      });

      if (res.ok) {
        toast({ title: "Success", description: "Price change scheduled" });
        setNewPrice("");
        setEffectiveDate("");
        fetchSettings();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to schedule price change", variant: "destructive" });
    }
  };

  const cancelSchedule = async (id: string) => {
    try {
      const res = await fetch(`/api/price-schedule?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Success", description: "Schedule cancelled" });
        fetchSettings();
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to cancel schedule", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Tabs defaultValue="notifications" className="space-y-6">
        <TabsList>
          <TabsTrigger value="notifications">
            <Bell className="h-4 w-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="pricing">
            <DollarSign className="h-4 w-4 mr-2" />
            Pricing
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="h-4 w-4 mr-2" />
            Security
          </TabsTrigger>
        </TabsList>

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <div className="space-y-6">
            {/* Email Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Email Notifications
                </CardTitle>
                <CardDescription>Configure email alerts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Daily Summary Email</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive a daily summary of sales
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.emailDailySummary}
                    onCheckedChange={(checked) =>
                      setNotifPrefs({ ...notifPrefs, emailDailySummary: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Low Stock Alerts</Label>
                    <p className="text-sm text-muted-foreground">
                      Get notified when tank is low
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.emailLowStock}
                    onCheckedChange={(checked) =>
                      setNotifPrefs({ ...notifPrefs, emailLowStock: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Tamper Alerts</Label>
                    <p className="text-sm text-muted-foreground">
                      Immediate alert on tamper detection
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.emailTamper}
                    onCheckedChange={(checked) =>
                      setNotifPrefs({ ...notifPrefs, emailTamper: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Push Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Push Notifications
                </CardTitle>
                <CardDescription>Browser push notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Sales Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Get notified for each sale
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.pushSales}
                    onCheckedChange={(checked) =>
                      setNotifPrefs({ ...notifPrefs, pushSales: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Low Stock Push</Label>
                    <p className="text-sm text-muted-foreground">
                      Push notification when stock is low
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.pushLowStock}
                    onCheckedChange={(checked) =>
                      setNotifPrefs({ ...notifPrefs, pushLowStock: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Tamper Push</Label>
                    <p className="text-sm text-muted-foreground">
                      Immediate push on tamper
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.pushTamper}
                    onCheckedChange={(checked) =>
                      setNotifPrefs({ ...notifPrefs, pushTamper: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* WhatsApp */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  WhatsApp Integration
                </CardTitle>
                <CardDescription>Send receipts via WhatsApp</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>WhatsApp Receipts</Label>
                    <p className="text-sm text-muted-foreground">
                      Send transaction receipts to WhatsApp
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.whatsappReceipts}
                    onCheckedChange={(checked) =>
                      setNotifPrefs({ ...notifPrefs, whatsappReceipts: checked })
                    }
                  />
                </div>
                {notifPrefs.whatsappReceipts && (
                  <div>
                    <Label>WhatsApp Number</Label>
                    <Input
                      value={notifPrefs.whatsappPhone || ""}
                      onChange={(e) =>
                        setNotifPrefs({ ...notifPrefs, whatsappPhone: e.target.value })
                      }
                      placeholder="e.g., +260971234567"
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <Button onClick={saveNotifications} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save Notification Settings"}
            </Button>
          </div>
        </TabsContent>

        {/* Pricing Tab */}
        <TabsContent value="pricing">
          <div className="space-y-6">
            {/* Schedule Price Change */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Schedule Price Change
                </CardTitle>
                <CardDescription>Set a future automatic price change</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>New Price (ZMW/L)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      placeholder="e.g., 48.00"
                    />
                  </div>
                  <div>
                    <Label>Effective Date</Label>
                    <Input
                      type="datetime-local"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={schedulePriceChange} disabled={!newPrice || !effectiveDate}>
                      Schedule Change
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Pending Schedules */}
            {schedules.filter((s) => !s.applied).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Pending Price Changes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {schedules
                      .filter((s) => !s.applied)
                      .map((schedule) => (
                        <div
                          key={schedule.id}
                          className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
                        >
                          <div>
                            <div className="font-medium">
                              K{schedule.newPricePerLiter.toFixed(2)}/L
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Scheduled for: {new Date(schedule.effectiveAt).toLocaleString()}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => cancelSchedule(schedule.id)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Price History */}
            <Card>
              <CardHeader>
                <CardTitle>Price History</CardTitle>
              </CardHeader>
              <CardContent>
                {priceHistory.length > 0 ? (
                  <div className="space-y-2">
                    {priceHistory.map((price) => (
                      <div
                        key={price.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div>
                          <div className="font-medium">
                            K{price.sellingPricePerLiter.toFixed(2)}/L
                          </div>
                          {price.device && (
                            <div className="text-sm text-muted-foreground">
                              {price.device.siteName}
                            </div>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(price.effectiveFrom).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No price history</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Two-Factor Authentication
                </CardTitle>
                <CardDescription>Add extra security to your account</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  Two-factor authentication adds an extra layer of security by requiring a code
                  from your phone in addition to your password.
                </p>
                <Button variant="outline">Enable 2FA (Coming Soon)</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Audit Log</CardTitle>
                <CardDescription>View recent account activity</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-center py-4">
                  View detailed audit logs in the Activity page
                </p>
                <Button variant="outline" asChild>
                  <a href="/dashboard/activity">View Activity Log</a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
