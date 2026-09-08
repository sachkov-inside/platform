import { Module } from '@nestjs/common';
import { PlatformConfigModule } from '../../config/platform-config.module.js';
import { OperationalReadiness } from '../../infrastructure/operational-readiness.js';
import { PrismaModule } from '../../infrastructure/prisma/index.js';
import { RuntimeIdentityModule } from '../../infrastructure/runtime-identity.js';

@Module({ imports: [PlatformConfigModule.forRoot(undefined, 'notifications-worker'), PrismaModule, RuntimeIdentityModule], providers: [OperationalReadiness] })
export class NotificationsWorkerModule {}
