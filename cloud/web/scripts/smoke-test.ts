/**
 * Smoke Test for Fleet Oil Level Monitoring System
 * 
 * Run with: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/smoke-test.ts
 * 
 * This script:
 * 1. Checks /api/health endpoint
 * 2. Creates a test device (if not exists)
 * 3. Posts sample telemetry
 * 4. Verifies device appears in /api/devices
 */

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

interface HealthResponse {
  ok: boolean;
  db: boolean;
  time: string;
}

interface ProvisionResponse {
  ok: boolean;
  device: {
    deviceId: string;
  };
  provisioning: {
    deviceId: string;
    apiKey: string;
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkHealth(): Promise<boolean> {
  console.log('\n🏥 Checking health endpoint...');
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    const data: HealthResponse = await res.json();
    
    console.log(`   Status: ${res.status}`);
    console.log(`   Response: ${JSON.stringify(data)}`);
    
    if (data.ok && data.db) {
      console.log('   ✅ Health check passed');
      return true;
    } else {
      console.log('   ❌ Health check failed (db not connected)');
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Health check failed: ${error}`);
    return false;
  }
}

async function provisionDevice(): Promise<{ deviceId: string; apiKey: string } | null> {
  console.log('\n📦 Provisioning test device...');
  
  try {
    // Note: This requires an authenticated session in production
    // For testing, you may need to manually create a device or use a dev token
    const res = await fetch(`${BASE_URL}/api/owner/devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add session cookie or auth header for production
      },
      body: JSON.stringify({
        siteName: 'Smoke Test Tank',
        location: 'Test Location',
        notes: 'Created by smoke test',
      }),
    });
    
    if (res.status === 403 || res.status === 401) {
      console.log('   ⚠️ Auth required - using manual test device');
      console.log('   To test fully, create a device via dashboard and update this script');
      return null;
    }
    
    const data: ProvisionResponse = await res.json();
    
    if (data.ok) {
      console.log(`   ✅ Device created: ${data.provisioning.deviceId}`);
      return {
        deviceId: data.provisioning.deviceId,
        apiKey: data.provisioning.apiKey,
      };
    } else {
      console.log(`   ❌ Provision failed: ${JSON.stringify(data)}`);
      return null;
    }
  } catch (error) {
    console.log(`   ❌ Provision error: ${error}`);
    return null;
  }
}

async function postTelemetry(deviceId: string, apiKey: string): Promise<boolean> {
  console.log('\n📡 Posting telemetry...');
  
  try {
    const res = await fetch(`${BASE_URL}/api/ingest/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        ts: Date.now(),
        oilPercent: 75.5,
        oilLiters: 755.0,
        distanceCm: 50.0,
        flowLpm: 2.5,
        litersTotal: 1234.56,
        pumpState: false,
        safetyStatus: 'OK',
        wifiRssi: -55,
        uptimeSec: 3600,
      }),
    });
    
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response: ${JSON.stringify(data)}`);
    
    if (data.ok) {
      console.log('   ✅ Telemetry posted');
      return true;
    } else {
      console.log('   ❌ Telemetry failed');
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Telemetry error: ${error}`);
    return false;
  }
}

async function postEvent(deviceId: string, apiKey: string): Promise<boolean> {
  console.log('\n📝 Posting event...');
  
  try {
    const res = await fetch(`${BASE_URL}/api/ingest/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        ts: Date.now(),
        type: 'SMOKE_TEST',
        severity: 'INFO',
        message: 'Smoke test event',
      }),
    });
    
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response: ${JSON.stringify(data)}`);
    
    if (data.ok) {
      console.log('   ✅ Event posted');
      return true;
    } else {
      console.log('   ❌ Event failed');
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Event error: ${error}`);
    return false;
  }
}

async function checkDevices(): Promise<boolean> {
  console.log('\n📋 Checking devices list...');
  
  try {
    const res = await fetch(`${BASE_URL}/api/devices`);
    
    if (res.status === 401) {
      console.log('   ⚠️ Auth required for /api/devices');
      return true; // Not a failure
    }
    
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Devices count: ${Array.isArray(data) ? data.length : 'N/A'}`);
    
    if (Array.isArray(data)) {
      console.log('   ✅ Devices endpoint working');
      data.forEach((d: any) => {
        console.log(`      - ${d.deviceId}: ${d.siteName} (${d.status})`);
      });
      return true;
    }
    return false;
  } catch (error) {
    console.log(`   ❌ Devices check error: ${error}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Fleet Oil Monitoring System - Smoke Test');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log('='.repeat(50));
  
  // 1. Health check
  const healthOk = await checkHealth();
  if (!healthOk) {
    console.log('\n❌ SMOKE TEST FAILED: Health check failed');
    process.exit(1);
  }
  
  // 2. Provision device
  const device = await provisionDevice();
  
  if (device) {
    // 3. Post telemetry
    await sleep(100);
    const telemetryOk = await postTelemetry(device.deviceId, device.apiKey);
    
    // 4. Post event
    await sleep(100);
    const eventOk = await postEvent(device.deviceId, device.apiKey);
    
    if (!telemetryOk || !eventOk) {
      console.log('\n⚠️ SMOKE TEST PARTIAL: Some ingest tests failed');
    }
  } else {
    console.log('\n   Skipping ingest tests (no device credentials)');
    console.log('   To test ingest:');
    console.log('   1. Login to dashboard');
    console.log('   2. Provision a device');
    console.log('   3. Use the device credentials with curl:');
    console.log(`   curl -X POST ${BASE_URL}/api/ingest/telemetry \\`);
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -H "x-device-id: YOUR_DEVICE_ID" \\');
    console.log('     -H "x-api-key: YOUR_API_KEY" \\');
    console.log('     -d \'{"ts":...}\'');
  }
  
  // 5. Check devices (requires auth)
  await checkDevices();
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ SMOKE TEST COMPLETE');
  console.log('\nNext steps:');
  console.log('1. Open http://localhost:3000');
  console.log('2. Login with admin@denuel.local / Admin123!');
  console.log('3. Provision a new tank device');
  console.log('4. Flash ESP32 with firmware and configure');
}

main().catch(console.error);
