import nodemailer from 'nodemailer';
import prisma from '@/lib/prisma';
import { DeviceStatus, EventSeverity } from '@prisma/client';

// ============================================================================
// DEDUPE CACHE - Prevents duplicate alerts within 30 minutes
// ============================================================================

interface AlertCacheEntry {
  lastSentAt: number;
  alertType: string;
}

// In-memory cache: key = `${deviceId}:${alertType}`
const alertDedupeCache = new Map<string, AlertCacheEntry>();
const DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// Cleanup old cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  Array.from(alertDedupeCache.entries()).forEach(([key, entry]) => {
    if (now - entry.lastSentAt > DEDUPE_WINDOW_MS) {
      alertDedupeCache.delete(key);
    }
  });
}, 10 * 60 * 1000);

function shouldSendAlert(deviceId: string, alertType: string): boolean {
  const cacheKey = `${deviceId}:${alertType}`;
  const entry = alertDedupeCache.get(cacheKey);
  const now = Date.now();

  if (entry && now - entry.lastSentAt < DEDUPE_WINDOW_MS) {
    console.log(`[ALERT] Dedupe: skipping ${alertType} for ${deviceId} (sent ${Math.round((now - entry.lastSentAt) / 1000)}s ago)`);
    return false;
  }

  return true;
}

function markAlertSent(deviceId: string, alertType: string): void {
  const cacheKey = `${deviceId}:${alertType}`;
  alertDedupeCache.set(cacheKey, { lastSentAt: Date.now(), alertType });
}

// ============================================================================
// EMAIL TRANSPORT
// ============================================================================

const getTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_PORT === '465',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
};

// ============================================================================
// SEND EMAIL
// ============================================================================

export async function sendEmail(subject: string, html: string, to?: string): Promise<boolean> {
  const transporter = getTransporter();
  const toEmail = to || process.env.SMTP_TO;

  if (!transporter || !toEmail) {
    console.log('[ALERT] Email not configured, skipping email notification');
    console.log('[ALERT] Subject:', subject);
    return false;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: toEmail,
      subject,
      html,
    });

    console.log(`[ALERT] Email sent: ${subject}`);
    return true;
  } catch (error) {
    console.error('[ALERT] Failed to send email:', error);
    return false;
  }
}

// ============================================================================
// SEND SMS - Provider-agnostic placeholder
// ============================================================================

export async function sendSms(to: string, message: string): Promise<boolean> {
  // Provider-agnostic SMS placeholder
  // Implement your SMS provider integration here:
  // - Twilio: twilio.messages.create({ body: message, from: TWILIO_FROM, to })
  // - AWS SNS: sns.publish({ PhoneNumber: to, Message: message })
  // - Vonage/Nexmo: vonage.message.sendSms(from, to, message)
  // - Africa's Talking: africastalking.SMS.send({ to: [to], message })

  console.log('[SMS] Provider not configured - placeholder');
  console.log('[SMS] Would send to:', to);
  console.log('[SMS] Message:', message);

  // Return false until a provider is configured
  return false;
}

// ============================================================================
// ALERT PAYLOAD TYPE
// ============================================================================

export type AlertType =
  | 'THRESHOLD_OK_TO_LOW'
  | 'THRESHOLD_LOW_TO_CRITICAL'
  | 'THRESHOLD_CRITICAL_TO_LOW'
  | 'THRESHOLD_LOW_TO_OK'
  | 'SAFETY_DRY_RUN_SHUTDOWN'
  | 'SAFETY_SENSOR_FAIL'
  | 'SAFETY_EVENT'
  | 'DEVICE_OFFLINE';

export interface AlertPayload {
  deviceId: string;
  siteName: string;
  type: AlertType;
  message: string;
  oilPercent?: number;
  previousStatus?: DeviceStatus;
  newStatus?: DeviceStatus;
  timestamp: Date;
}

// ============================================================================
// SEND ALERT EMAIL (formatted)
// ============================================================================

export async function sendEmailAlert(payload: AlertPayload): Promise<boolean> {
  const isCritical = payload.type.includes('CRITICAL') || payload.type.includes('SAFETY');

  const subject = isCritical
    ? `CRITICAL: ${payload.type.replace(/_/g, ' ')} - ${payload.siteName}`
    : `Alert: ${payload.type.replace(/_/g, ' ')} - ${payload.siteName}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: ${isCritical ? '#dc2626' : '#f59e0b'};">
        Fleet Oil Monitoring Alert
      </h2>
      <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid ${isCritical ? '#dc2626' : '#f59e0b'};">
        <p><strong>Device:</strong> ${payload.deviceId}</p>
        <p><strong>Site:</strong> ${payload.siteName}</p>
        <p><strong>Alert Type:</strong> ${payload.type.replace(/_/g, ' ')}</p>
        ${payload.oilPercent !== undefined ? `<p><strong>Oil Level:</strong> ${payload.oilPercent.toFixed(1)}%</p>` : ''}
        ${payload.previousStatus && payload.newStatus ? `<p><strong>Status Change:</strong> ${payload.previousStatus} -> ${payload.newStatus}</p>` : ''}
        <p><strong>Message:</strong> ${payload.message}</p>
        <p><strong>Time:</strong> ${payload.timestamp.toISOString()}</p>
      </div>
      <p style="color: #6b7280; font-size: 12px;">
        This is an automated alert from the Fleet Oil Level Monitoring System.
      </p>
    </div>
  `;

  return sendEmail(subject, html);
}

// ============================================================================
// SEND SMS ALERT (formatted)
// ============================================================================

export async function sendSmsAlert(payload: AlertPayload, phoneNumber: string): Promise<boolean> {
  const message = `[Fleet Oil] ${payload.type.replace(/_/g, ' ')}: ${payload.siteName} - ${payload.message}${payload.oilPercent !== undefined ? ` (${payload.oilPercent.toFixed(1)}%)` : ''}`;

  return sendSms(phoneNumber, message);
}

// ============================================================================
// CREATE EVENT ENTRY
// ============================================================================

async function createAlertEvent(
  deviceId: string,
  type: string,
  severity: EventSeverity,
  message: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        deviceId,
        ts: BigInt(Date.now()),
        type,
        severity,
        message,
        metaJson: meta ? JSON.parse(JSON.stringify(meta)) : undefined,
      },
    });
    console.log(`[ALERT] Event created: ${type} for ${deviceId}`);
  } catch (error) {
    console.error('[ALERT] Failed to create event:', error);
  }
}

// ============================================================================
// EVALUATE AND NOTIFY - Main alerting function
// ============================================================================

export interface AlertRule {
  lowThreshold: number;
  criticalThreshold: number;
  notifyEmail?: string | null;
  notifySms?: string | null;
}

export interface DeviceInfo {
  deviceId: string;
  siteName: string;
  currentStatus: DeviceStatus;
}

export interface TelemetryData {
  oilPercent: number;
  safetyStatus: string;
}

export async function evaluateAndNotify(
  device: DeviceInfo,
  telemetry: TelemetryData,
  rule: AlertRule
): Promise<void> {
  const { deviceId, siteName, currentStatus } = device;
  const { oilPercent, safetyStatus } = telemetry;
  const timestamp = new Date();

  // Determine new status based on thresholds
  let newStatus: DeviceStatus;
  if (oilPercent < rule.criticalThreshold) {
    newStatus = DeviceStatus.CRITICAL;
  } else if (oilPercent < rule.lowThreshold) {
    newStatus = DeviceStatus.LOW;
  } else {
    newStatus = DeviceStatus.OK;
  }

  // -------------------------------------------------------------------------
  // THRESHOLD CROSSING DETECTION
  // -------------------------------------------------------------------------

  // OK -> LOW
  if (currentStatus === DeviceStatus.OK && newStatus === DeviceStatus.LOW) {
    const alertType: AlertType = 'THRESHOLD_OK_TO_LOW';
    
    await createAlertEvent(
      deviceId,
      'THRESHOLD_CROSSED',
      EventSeverity.WARN,
      `Oil level dropped below low threshold: ${oilPercent.toFixed(1)}% (threshold: ${rule.lowThreshold}%)`,
      { previousStatus: currentStatus, newStatus, oilPercent, threshold: rule.lowThreshold }
    );

    if (shouldSendAlert(deviceId, alertType)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: `Oil level dropped below ${rule.lowThreshold}% threshold`,
        oilPercent,
        previousStatus: currentStatus,
        newStatus,
        timestamp,
      };

      await sendEmailAlert(payload);
      if (rule.notifySms) await sendSmsAlert(payload, rule.notifySms);
      markAlertSent(deviceId, alertType);
    }
  }

  // LOW -> CRITICAL
  if (currentStatus === DeviceStatus.LOW && newStatus === DeviceStatus.CRITICAL) {
    const alertType: AlertType = 'THRESHOLD_LOW_TO_CRITICAL';

    await createAlertEvent(
      deviceId,
      'THRESHOLD_CROSSED',
      EventSeverity.CRITICAL,
      `Oil level dropped to CRITICAL: ${oilPercent.toFixed(1)}% (threshold: ${rule.criticalThreshold}%)`,
      { previousStatus: currentStatus, newStatus, oilPercent, threshold: rule.criticalThreshold }
    );

    if (shouldSendAlert(deviceId, alertType)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: `CRITICAL: Oil level dropped below ${rule.criticalThreshold}%`,
        oilPercent,
        previousStatus: currentStatus,
        newStatus,
        timestamp,
      };

      await sendEmailAlert(payload);
      if (rule.notifySms) await sendSmsAlert(payload, rule.notifySms);
      markAlertSent(deviceId, alertType);
    }
  }

  // OK -> CRITICAL (direct jump)
  if (currentStatus === DeviceStatus.OK && newStatus === DeviceStatus.CRITICAL) {
    const alertType: AlertType = 'THRESHOLD_LOW_TO_CRITICAL';

    await createAlertEvent(
      deviceId,
      'THRESHOLD_CROSSED',
      EventSeverity.CRITICAL,
      `Oil level dropped directly to CRITICAL: ${oilPercent.toFixed(1)}%`,
      { previousStatus: currentStatus, newStatus, oilPercent, threshold: rule.criticalThreshold }
    );

    if (shouldSendAlert(deviceId, alertType)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: `CRITICAL: Oil level dropped directly below ${rule.criticalThreshold}%`,
        oilPercent,
        previousStatus: currentStatus,
        newStatus,
        timestamp,
      };

      await sendEmailAlert(payload);
      if (rule.notifySms) await sendSmsAlert(payload, rule.notifySms);
      markAlertSent(deviceId, alertType);
    }
  }

  // CRITICAL -> LOW (recovering)
  if (currentStatus === DeviceStatus.CRITICAL && newStatus === DeviceStatus.LOW) {
    const alertType: AlertType = 'THRESHOLD_CRITICAL_TO_LOW';

    await createAlertEvent(
      deviceId,
      'THRESHOLD_CROSSED',
      EventSeverity.INFO,
      `Oil level recovering from CRITICAL to LOW: ${oilPercent.toFixed(1)}%`,
      { previousStatus: currentStatus, newStatus, oilPercent }
    );

    if (shouldSendAlert(deviceId, alertType)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: `Recovering: Oil level rose above critical threshold`,
        oilPercent,
        previousStatus: currentStatus,
        newStatus,
        timestamp,
      };

      await sendEmailAlert(payload);
      markAlertSent(deviceId, alertType);
    }
  }

  // LOW -> OK (recovered)
  if (currentStatus === DeviceStatus.LOW && newStatus === DeviceStatus.OK) {
    const alertType: AlertType = 'THRESHOLD_LOW_TO_OK';

    await createAlertEvent(
      deviceId,
      'THRESHOLD_CROSSED',
      EventSeverity.INFO,
      `Oil level recovered to OK: ${oilPercent.toFixed(1)}%`,
      { previousStatus: currentStatus, newStatus, oilPercent }
    );

    if (shouldSendAlert(deviceId, alertType)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: `Recovered: Oil level is back above ${rule.lowThreshold}%`,
        oilPercent,
        previousStatus: currentStatus,
        newStatus,
        timestamp,
      };

      await sendEmailAlert(payload);
      markAlertSent(deviceId, alertType);
    }
  }

  // CRITICAL -> OK (full recovery, direct jump)
  if (currentStatus === DeviceStatus.CRITICAL && newStatus === DeviceStatus.OK) {
    const alertType: AlertType = 'THRESHOLD_LOW_TO_OK';

    await createAlertEvent(
      deviceId,
      'THRESHOLD_CROSSED',
      EventSeverity.INFO,
      `Oil level fully recovered from CRITICAL to OK: ${oilPercent.toFixed(1)}%`,
      { previousStatus: currentStatus, newStatus, oilPercent }
    );

    if (shouldSendAlert(deviceId, alertType)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: `Fully recovered: Oil level is back above ${rule.lowThreshold}%`,
        oilPercent,
        previousStatus: currentStatus,
        newStatus,
        timestamp,
      };

      await sendEmailAlert(payload);
      markAlertSent(deviceId, alertType);
    }
  }

  // -------------------------------------------------------------------------
  // SAFETY STATUS ALERTS
  // -------------------------------------------------------------------------

  // DRY_RUN_SHUTDOWN
  if (safetyStatus === 'DRY_RUN_SHUTDOWN') {
    const alertType: AlertType = 'SAFETY_DRY_RUN_SHUTDOWN';

    await createAlertEvent(
      deviceId,
      'SAFETY_TRIGGERED',
      EventSeverity.CRITICAL,
      'Pump shut down due to dry-run protection',
      { safetyStatus, oilPercent }
    );

    if (shouldSendAlert(deviceId, alertType)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: 'SAFETY: Pump automatically shut down - dry-run protection triggered',
        oilPercent,
        timestamp,
      };

      await sendEmailAlert(payload);
      if (rule.notifySms) await sendSmsAlert(payload, rule.notifySms);
      markAlertSent(deviceId, alertType);
    }
  }

  // SENSOR_FAIL
  if (safetyStatus === 'SENSOR_FAIL') {
    const alertType: AlertType = 'SAFETY_SENSOR_FAIL';

    await createAlertEvent(
      deviceId,
      'SAFETY_TRIGGERED',
      EventSeverity.CRITICAL,
      'Sensor failure detected',
      { safetyStatus, oilPercent }
    );

    if (shouldSendAlert(deviceId, alertType)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: 'SAFETY: Sensor failure detected - manual inspection required',
        oilPercent,
        timestamp,
      };

      await sendEmailAlert(payload);
      if (rule.notifySms) await sendSmsAlert(payload, rule.notifySms);
      markAlertSent(deviceId, alertType);
    }
  }

  // Other safety statuses (not OK, DRY_RUN_SHUTDOWN, or SENSOR_FAIL)
  if (safetyStatus !== 'OK' && safetyStatus !== 'DRY_RUN_SHUTDOWN' && safetyStatus !== 'SENSOR_FAIL') {
    const alertType: AlertType = 'SAFETY_EVENT';

    await createAlertEvent(
      deviceId,
      'SAFETY_TRIGGERED',
      EventSeverity.WARN,
      `Safety status changed: ${safetyStatus}`,
      { safetyStatus, oilPercent }
    );

    if (shouldSendAlert(deviceId, `SAFETY_${safetyStatus}`)) {
      const payload: AlertPayload = {
        deviceId,
        siteName,
        type: alertType,
        message: `Safety status: ${safetyStatus}`,
        oilPercent,
        timestamp,
      };

      await sendEmailAlert(payload);
      markAlertSent(deviceId, `SAFETY_${safetyStatus}`);
    }
  }
}

// ============================================================================
// LEGACY FUNCTION - for backward compatibility
// ============================================================================

export async function evaluateAndSendAlerts(
  deviceId: string,
  siteName: string,
  oilPercent: number,
  safetyStatus: string,
  rule: { lowThreshold: number; criticalThreshold: number; notifyEmail?: string | null; notifySms?: string | null }
): Promise<void> {
  // Get current device status
  const device = await prisma.device.findUnique({
    where: { deviceId },
    select: { status: true },
  });

  if (!device) {
    console.error(`[ALERT] Device not found: ${deviceId}`);
    return;
  }

  await evaluateAndNotify(
    { deviceId, siteName, currentStatus: device.status },
    { oilPercent, safetyStatus },
    rule
  );
}
