import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { ProxyHostsModule } from '../proxy-hosts/proxy-hosts.module';
import { AccessGroupsService } from './access-groups.service';
import { ClusterErrorFilesService } from './cluster-error-files.service';
import { ClustersController } from './clusters.controller';
import { ClustersService } from './clusters.service';

@Module({
  imports: [ProxyHostsModule, CertificatesModule],
  controllers: [ClustersController],
  providers: [ClustersService, ClusterErrorFilesService, AccessGroupsService],
  exports: [ClustersService],
})
export class ClustersModule {}
