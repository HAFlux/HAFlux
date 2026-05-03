import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { CertificatesModule } from './certificates/certificates.module';
import { ClustersModule } from './clusters/clusters.module';
import { HaproxyModule } from './haproxy/haproxy.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProxyHostsModule } from './proxy-hosts/proxy-hosts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
    ClustersModule,
    CertificatesModule,
    HaproxyModule,
    ProxyHostsModule,
    BackupModule,
  ],
})
export class AppModule {}
