import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ClustersModule } from './clusters/clusters.module';
import { CertificatesModule } from './certificates/certificates.module';
import { HaproxyModule } from './haproxy/haproxy.module';
import { ProxyHostsModule } from './proxy-hosts/proxy-hosts.module';
import { BackupModule } from './backup/backup.module';

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
