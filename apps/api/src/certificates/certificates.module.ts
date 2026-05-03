import { Module } from '@nestjs/common';
import { AcmeService } from './acme.service';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { CloudflareDnsProvider } from './cloudflare.provider';
import { CryptoService } from './crypto.service';
import { CertificateRenewService } from './renew.service';

@Module({
  controllers: [CertificatesController],
  providers: [
    CloudflareDnsProvider,
    CryptoService,
    AcmeService,
    CertificatesService,
    CertificateRenewService,
  ],
  exports: [
    CloudflareDnsProvider,
    AcmeService,
    CertificatesService,
    CryptoService,
    CertificateRenewService,
  ],
})
export class CertificatesModule {}
