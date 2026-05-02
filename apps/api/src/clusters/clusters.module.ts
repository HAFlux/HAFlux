import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { ProxyHostsModule } from '../proxy-hosts/proxy-hosts.module';
import { ClustersController } from './clusters.controller';
import { ClustersService } from './clusters.service';
import { ClusterErrorFilesService } from './cluster-error-files.service';
import { AccessGroupsService } from './access-groups.service';

@Module({
  imports: [ProxyHostsModule, CertificatesModule],
  controllers: [ClustersController],
  providers: [ClustersService, ClusterErrorFilesService, AccessGroupsService],
  exports: [ClustersService],
})
export class ClustersModule {}
