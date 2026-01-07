import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Droplet, BarChart3, Shield, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Droplet className="h-8 w-8 text-primary" />
            <span className="text-xl font-semibold">Fleet Oil Monitor</span>
          </div>
          <Link href="/login">
            <Button variant="outline">Sign In</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="container mx-auto px-6 py-20">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-5xl font-bold tracking-tight mb-6">
            Real-time Oil Tank Monitoring
          </h1>
          <p className="text-xl text-muted-foreground mb-10">
            Monitor 20+ tanks in real-time. Get instant alerts, control pumps remotely, 
            and never run out of oil with our advanced IoT monitoring system.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/login">
              <Button size="lg" className="px-8">
                Get Started
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="px-8">
                View Dashboard
              </Button>
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mt-24">
          <div className="notion-card p-8">
            <BarChart3 className="h-12 w-12 mb-4 text-primary" />
            <h3 className="text-lg font-semibold mb-2">Real-time Analytics</h3>
            <p className="text-muted-foreground">
              Track oil levels, flow rates, and consumption patterns with beautiful charts and live updates.
            </p>
          </div>
          <div className="notion-card p-8">
            <Shield className="h-12 w-12 mb-4 text-primary" />
            <h3 className="text-lg font-semibold mb-2">Smart Alerts</h3>
            <p className="text-muted-foreground">
              Receive instant email and SMS notifications when oil levels drop below thresholds.
            </p>
          </div>
          <div className="notion-card p-8">
            <Zap className="h-12 w-12 mb-4 text-primary" />
            <h3 className="text-lg font-semibold mb-2">Remote Control</h3>
            <p className="text-muted-foreground">
              Turn pumps on/off and dispense specific amounts remotely with built-in safety features.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-24 text-center">
          <div className="grid grid-cols-3 gap-8 max-w-2xl mx-auto">
            <div>
              <div className="text-4xl font-bold">20+</div>
              <div className="text-muted-foreground">Tanks Supported</div>
            </div>
            <div>
              <div className="text-4xl font-bold">10s</div>
              <div className="text-muted-foreground">Update Interval</div>
            </div>
            <div>
              <div className="text-4xl font-bold">24/7</div>
              <div className="text-muted-foreground">Monitoring</div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-20">
        <div className="container mx-auto px-6 py-8 text-center text-muted-foreground">
          <p>© 2024 Fleet Oil Monitoring System. Built by Denuel Inambao.</p>
        </div>
      </footer>
    </div>
  );
}
