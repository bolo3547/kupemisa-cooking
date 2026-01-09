"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

interface LcdDisplayControlProps {
  deviceId: string;
  apiKey: string;
}

export function LcdDisplayControl({ deviceId, apiKey }: LcdDisplayControlProps) {
  const [line0, setLine0] = useState("");
  const [line1, setLine1] = useState("");
  const [ttlSec, setTtlSec] = useState(60);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSet = async () => {
    if (!line0.trim() || !line1.trim()) {
      toast({
        title: "Error",
        description: "Both lines are required",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/device/display", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-id": deviceId,
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          line0: line0.substring(0, 16),
          line1: line1.substring(0, 16),
          ttlSec,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        toast({
          title: "Success",
          description: `Display message set for ${ttlSec} seconds`,
        });
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to set message",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Network error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/device/display", {
        method: "DELETE",
        headers: {
          "x-device-id": deviceId,
          "x-api-key": apiKey,
        },
      });

      const data = await response.json();

      if (data.ok) {
        toast({
          title: "Success",
          description: "Display message cleared",
        });
        setLine0("");
        setLine1("");
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to clear message",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Network error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>LCD Display Message</CardTitle>
        <CardDescription>
          Send a temporary message to the device LCD (16x2 characters)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="line0">Line 1 (max 16 chars)</Label>
          <Input
            id="line0"
            value={line0}
            onChange={(e) => setLine0(e.target.value.substring(0, 16))}
            placeholder="WELCOME"
            maxLength={16}
          />
          <p className="text-sm text-muted-foreground">
            {line0.length}/16 characters
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="line1">Line 2 (max 16 chars)</Label>
          <Input
            id="line1"
            value={line1}
            onChange={(e) => setLine1(e.target.value.substring(0, 16))}
            placeholder="Have a nice day!"
            maxLength={16}
          />
          <p className="text-sm text-muted-foreground">
            {line1.length}/16 characters
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ttl">Duration (seconds)</Label>
          <Input
            id="ttl"
            type="number"
            value={ttlSec}
            onChange={(e) => setTtlSec(Math.min(3600, Math.max(1, parseInt(e.target.value) || 60)))}
            min={1}
            max={3600}
          />
          <p className="text-sm text-muted-foreground">
            1-3600 seconds (1 hour max)
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSet} disabled={loading}>
            {loading ? "Sending..." : "Set Message"}
          </Button>
          <Button onClick={handleClear} variant="outline" disabled={loading}>
            Clear Message
          </Button>
        </div>

        <div className="mt-4 p-4 bg-muted rounded-md font-mono text-sm">
          <div className="border border-border p-2 bg-background">
            <div className="truncate">{line0 || "________________"}</div>
            <div className="truncate">{line1 || "________________"}</div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Preview</p>
        </div>
      </CardContent>
    </Card>
  );
}
