'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import QRCode from 'react-qr-code';
import { Copy, Check, Loader2, ArrowLeft, Wifi, Code, Key, QrCode, Download, Shield, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import {
  generateArduinoSnippet,
  generateProvisioningJson,
  generateProvisioningJsonCompact,
  generateInstructionsFile,
  downloadTextFile,
  type ProvisioningData,
} from '@/lib/firmware-utils';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className="h-8 gap-2"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-600" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          {label}
        </>
      )}
    </Button>
  );
}

export default function ProvisionPage() {
  const [siteName, setSiteName] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<{ device: any; provisioning: ProvisioningData } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/owner/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteName, location, notes }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to provision device');
        setLoading(false);
        return;
      }

      setResult(data);
      setSiteName('');
      setLocation('');
      setNotes('');
    } catch (err) {
      setError('Failed to provision device');
    } finally {
      setLoading(false);
    }
  };

  const provisioningJson = result ? generateProvisioningJson(result.provisioning) : '';
  const provisioningJsonCompact = result ? generateProvisioningJsonCompact(result.provisioning) : '';
  const arduinoSnippet = result ? generateArduinoSnippet(result.provisioning) : '';

  const handleDownloadInstructions = () => {
    if (!result) return;
    const content = generateInstructionsFile(result.provisioning);
    downloadTextFile(content, `device-${result.provisioning.deviceId}-setup.txt`);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold">Provision New Tank</h1>
        <p className="text-muted-foreground mt-1">
          Add a new oil tank device to your fleet monitoring system
        </p>
      </div>

      {/* Provision Form */}
      {!result && (
        <Card>
          <CardHeader>
            <CardTitle>Tank Details</CardTitle>
            <CardDescription>
              Enter the details for the new tank. A unique Device ID and API Key will be generated automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProvision} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="siteName">
                  Site Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="siteName"
                  placeholder="e.g., Main Storage Tank A"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  placeholder="e.g., Building 2, North Wing"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Any additional information about this tank..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={loading}
                  rows={3}
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm border border-red-200">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Provisioning...
                  </>
                ) : (
                  'Provision Device'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Success Result - Safe Firmware Setup */}
      {result && (
        <div className="space-y-6">
          {/* Success Banner */}
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-4">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-green-800 mb-2">
              Device Provisioned Successfully!
            </h2>
            <p className="text-green-700 text-sm">
              Save the API Key now — it will not be shown again.
            </p>
          </div>

          {/* Device Credentials Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Device Credentials
              </CardTitle>
              <CardDescription>
                These credentials are required for the ESP32 device to authenticate with the cloud.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Device ID */}
              <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                <div>
                  <div className="text-xs text-muted-foreground">Device ID</div>
                  <div className="font-mono font-semibold">{result.provisioning.deviceId}</div>
                </div>
                <CopyButton text={result.provisioning.deviceId} label="Copy" />
              </div>

              {/* API Key */}
              <div className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex-1 mr-4">
                  <div className="text-xs text-yellow-700 flex items-center gap-1">
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs">
                      ONE-TIME
                    </Badge>
                    API Key
                  </div>
                  <div className="font-mono text-sm break-all mt-1">{result.provisioning.apiKey}</div>
                </div>
                <CopyButton text={result.provisioning.apiKey} label="Copy" />
              </div>

              {/* API Base URL */}
              <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                <div>
                  <div className="text-xs text-muted-foreground">API Base URL</div>
                  <div className="font-mono text-sm">{result.provisioning.apiBaseUrl}</div>
                </div>
                <CopyButton text={result.provisioning.apiBaseUrl} label="Copy" />
              </div>
            </CardContent>
          </Card>

          {/* Safe Firmware Setup - Tabbed Panel */}
          <Card className="border-2 border-blue-200">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Shield className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-xl">Safe Firmware Setup</CardTitle>
                  <CardDescription className="text-blue-700">
                    Choose your preferred method to configure the ESP32 device
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <Tabs defaultValue="wifi-portal" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="wifi-portal" className="gap-2">
                    <Wifi className="h-4 w-4" />
                    WiFi Portal
                    <Badge variant="secondary" className="ml-1 text-xs bg-green-100 text-green-700">
                      Recommended
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="arduino" className="gap-2">
                    <Code className="h-4 w-4" />
                    Arduino / Manual
                  </TabsTrigger>
                </TabsList>

                {/* Tab A: WiFi Portal Method */}
                <TabsContent value="wifi-portal" className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                      <span className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">A</span>
                      ESP32 Provisioning Portal (No Code Editing!)
                    </h4>
                    <p className="text-sm text-blue-800">
                      Flash the firmware once, then configure via the device's built-in WiFi portal.
                    </p>
                  </div>

                  {/* Steps */}
                  <ol className="space-y-4">
                    <li className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold">1</span>
                      <div>
                        <div className="font-medium">Flash the ESP32</div>
                        <div className="text-sm text-muted-foreground">
                          Upload <code className="bg-muted px-1.5 py-0.5 rounded text-xs">esp32_oil_node.ino</code> to your ESP32 using Arduino IDE.
                        </div>
                      </div>
                    </li>
                    <li className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold">2</span>
                      <div>
                        <div className="font-medium">Connect to Device AP</div>
                        <div className="text-sm text-muted-foreground">
                          On first boot, connect to:
                          <code className="bg-muted px-2 py-1 rounded block mt-1 text-xs">
                            SSID: <strong>oil-system</strong> &nbsp;|&nbsp; Password: <strong>12345678</strong>
                          </code>
                        </div>
                      </div>
                    </li>
                    <li className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold">3</span>
                      <div>
                        <div className="font-medium">Open Portal & Paste JSON</div>
                        <div className="text-sm text-muted-foreground">
                          Navigate to <code className="bg-muted px-1.5 py-0.5 rounded text-xs">http://192.168.4.1</code> and paste the JSON below.
                        </div>
                      </div>
                    </li>
                  </ol>

                  {/* Provisioning JSON */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Provisioning JSON</Label>
                      <CopyButton text={provisioningJsonCompact} label="Copy JSON" />
                    </div>
                    <Textarea
                      readOnly
                      value={provisioningJson}
                      className="font-mono text-xs h-32 bg-muted/50"
                    />
                  </div>

                  {/* QR Code */}
                  <div className="flex flex-col items-center gap-4 p-6 bg-secondary/30 rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <QrCode className="h-4 w-4" />
                      Scan QR Code (alternative)
                    </div>
                    <div className="bg-white p-4 rounded-lg shadow-sm">
                      <QRCode value={provisioningJsonCompact} size={160} />
                    </div>
                  </div>
                </TabsContent>

                {/* Tab B: Arduino / Manual Method */}
                <TabsContent value="arduino" className="space-y-6">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <h4 className="font-semibold text-amber-900 mb-2 flex items-center gap-2">
                      <span className="bg-amber-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">B</span>
                      Arduino IDE / Manual Configuration
                    </h4>
                    <p className="text-sm text-amber-800">
                      Edit the firmware source code directly. Best for developers or offline deployment.
                    </p>
                  </div>

                  {/* Warning */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-red-800 text-sm">Important</div>
                      <p className="text-sm text-red-700">
                        Paste the snippet <strong>only</strong> in the USER CONFIG section at the top of the firmware file.
                        Pasting elsewhere will cause compilation errors.
                      </p>
                    </div>
                  </div>

                  {/* Arduino Snippet */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Arduino #define Snippet</Label>
                      <CopyButton text={arduinoSnippet} label="Copy Snippet" />
                    </div>
                    <div className="relative">
                      <Textarea
                        readOnly
                        value={arduinoSnippet}
                        className="font-mono text-xs h-56 bg-zinc-900 text-green-400 border-zinc-700"
                      />
                    </div>
                  </div>

                  {/* Where to Paste Diagram */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      📍 Where to paste?
                    </Label>
                    <div className="bg-zinc-900 text-zinc-300 p-4 rounded-lg font-mono text-xs overflow-x-auto">
                      <pre>{`esp32_oil_node.ino
┌────────────────────────────────────────────────┐
│  // ═══════════════════════════════════════    │
│  //         USER CONFIG SECTION                │
│  // ═══════════════════════════════════════    │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  ✅ PASTE YOUR SNIPPET HERE              │  │
│  │                                          │  │
│  │  #define DEVICE_ID     "OIL-XXXX"        │  │
│  │  #define API_KEY       "..."             │  │
│  │  #define API_BASE_URL  "..."             │  │
│  │  #define SITE_NAME     "..."             │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  // WiFi credentials (set these too)           │
│  #define WIFI_SSID     "your-wifi"             │
│  #define WIFI_PASSWORD "your-password"         │
│                                                │
│  // ═══════════════════════════════════════    │
│  //         END USER CONFIG                    │
│  // ═══════════════════════════════════════    │
│                                                │
│  // ... rest of firmware code ...              │
└────────────────────────────────────────────────┘`}</pre>
                    </div>
                  </div>

                  {/* Steps for Arduino */}
                  <ol className="space-y-3 text-sm">
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-semibold">1</span>
                      <span>Open <code className="bg-muted px-1.5 py-0.5 rounded text-xs">esp32_oil_node.ino</code> in Arduino IDE</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-semibold">2</span>
                      <span>Find the <strong>USER CONFIG</strong> section at the top</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-semibold">3</span>
                      <span>Replace placeholder values with the snippet above</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-semibold">4</span>
                      <span>Set your WiFi SSID and Password below the device config</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-semibold">5</span>
                      <span>Upload to ESP32 (Tools → Board → ESP32 Dev Module)</span>
                    </li>
                  </ol>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Download Instructions */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">Download Setup Instructions</h4>
                  <p className="text-sm text-muted-foreground">
                    Save all credentials and instructions as a text file for offline reference.
                  </p>
                </div>
                <Button variant="outline" onClick={handleDownloadInstructions} className="gap-2">
                  <Download className="h-4 w-4" />
                  Download .txt
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-4">
            <Button onClick={() => setResult(null)} variant="outline" className="flex-1">
              Provision Another Device
            </Button>
            <Link href="/dashboard" className="flex-1">
              <Button className="w-full">Go to Dashboard</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
