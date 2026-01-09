-- CreateTable
CREATE TABLE "DeviceDisplayMessage" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "line0" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceDisplayMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceDisplayMessage_deviceId_key" ON "DeviceDisplayMessage"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceDisplayMessage_deviceId_expiresAt_idx" ON "DeviceDisplayMessage"("deviceId", "expiresAt");

-- CreateIndex
CREATE INDEX "DeviceDisplayMessage_expiresAt_idx" ON "DeviceDisplayMessage"("expiresAt");
