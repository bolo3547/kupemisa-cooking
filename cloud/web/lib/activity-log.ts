import { prisma } from './prisma';
import { ActivityAction } from '@prisma/client';

interface LogActivityParams {
  userId: string;
  userName: string;
  userEmail: string;
  action: ActivityAction;
  description: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export async function logActivity(params: LogActivityParams) {
  try {
    await prisma.activityLog.create({
      data: {
        userId: params.userId,
        userName: params.userName,
        userEmail: params.userEmail,
        action: params.action,
        description: params.description,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metaJson: params.metadata || {},
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
    // Don't throw - logging should not break the app
  }
}

export async function getActivityLogs(filters?: {
  userId?: string;
  action?: ActivityAction;
  resourceType?: string;
  resourceId?: string;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};
  
  if (filters?.userId) where.userId = filters.userId;
  if (filters?.action) where.action = filters.action;
  if (filters?.resourceType) where.resourceType = filters.resourceType;
  if (filters?.resourceId) where.resourceId = filters.resourceId;

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return { logs, total };
}
