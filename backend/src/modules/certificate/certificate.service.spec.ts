import { Test, TestingModule } from '@nestjs/testing';
import { CertificateService } from './certificate.service';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Certificate } from './entities/certificate.entity';
import { Verification } from './entities/verification.entity';
import { User } from '../users/entities/user.entity';
import { DuplicateDetectionService } from './services/duplicate-detection.service';
import { MetadataSchemaService } from '../metadata-schema/services/metadata-schema.service';
import { FilesService } from '../files/services/files.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { SorobanService } from '../stellar/services/soroban.service';

describe('CertificateService', () => {
  let service: CertificateService;
  const certificateRepository = {
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const verificationRepository = {};
  const duplicateDetectionService = {};
  const webhooksService = {};
  const metadataSchemaService = {};
  const filesService = {
    generateAndUploadQrCode: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };
  const sorobanService = {
    isConfigured: jest.fn().mockReturnValue(false),
    issueCertificate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateService,
        {
          provide: getRepositoryToken(Certificate),
          useValue: certificateRepository,
        },
        {
          provide: getRepositoryToken(Verification),
          useValue: verificationRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: {},
        },
        {
          provide: DuplicateDetectionService,
          useValue: duplicateDetectionService,
        },
        {
          provide: WebhooksService,
          useValue: webhooksService,
        },
        {
          provide: MetadataSchemaService,
          useValue: metadataSchemaService,
        },
        {
          provide: FilesService,
          useValue: filesService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: DataSource,
          useValue: {},
        },
        {
          provide: SorobanService,
          useValue: sorobanService,
        },
      ],
    }).compile();

    service = module.get<CertificateService>(CertificateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate a QR code URL for a certificate', async () => {
    const certificate = {
      id: 'cert-123',
      verificationCode: 'AB12CD34',
    } as Certificate;

    jest.spyOn(service, 'findOne').mockResolvedValue(certificate);
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://stellarcert.app';

    try {
      const result = await service.getCertificateQrCode('cert-123');

      expect(result).toEqual({
        id: 'cert-123',
        verificationCode: 'AB12CD34',
        verificationUrl: 'https://stellarcert.app/verify/AB12CD34',
        qrCode: expect.any(String),
      });
      expect(result.qrCode).toContain('data:image/png;base64,');
    } finally {
      if (originalFrontendUrl === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = originalFrontendUrl;
      }
    }
  });

  describe('syncChain (#733)', () => {
    const certificate = {
      id: 'cert-1',
      verificationCode: 'AB12CD34',
      issuerStellarAddress: 'GISSUER',
      recipientStellarAddress: 'GRECIPIENT',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      stellarTransactionHash: undefined,
    } as unknown as Certificate;

    beforeEach(() => {
      jest.clearAllMocks();
      sorobanService.isConfigured.mockReturnValue(false);
    });

    it('returns the existing hash without touching the chain when already synced', async () => {
      const synced = {
        ...certificate,
        stellarTransactionHash: 'abc123',
      } as unknown as Certificate;
      jest.spyOn(service, 'findOne').mockResolvedValue(synced);

      const result = await service.syncChain('cert-1');

      expect(result.alreadySynced).toBe(true);
      expect(result.stellarTransactionHash).toBe('abc123');
      expect(sorobanService.issueCertificate).not.toHaveBeenCalled();
      expect(certificateRepository.update).not.toHaveBeenCalled();
    });

    it('refuses to retry when Soroban is not configured', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(certificate);

      await expect(service.syncChain('cert-1')).rejects.toThrow(
        /not configured/i,
      );
      expect(certificateRepository.update).not.toHaveBeenCalled();
    });

    it('persists the transaction hash returned by a successful retry', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(certificate);
      sorobanService.isConfigured.mockReturnValue(true);
      sorobanService.issueCertificate.mockResolvedValue('deadbeef');
      certificateRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.syncChain('cert-1');

      expect(sorobanService.issueCertificate).toHaveBeenCalledWith(
        'cert-1',
        'GISSUER',
        'GRECIPIENT',
        'AB12CD34',
        Math.floor(new Date('2027-01-01T00:00:00.000Z').getTime() / 1000),
      );
      expect(certificateRepository.update).toHaveBeenCalledWith('cert-1', {
        stellarTransactionHash: 'deadbeef',
      });
      expect(result.alreadySynced).toBe(false);
      expect(result.stellarTransactionHash).toBe('deadbeef');
    });

    it('fails loudly when the retry still cannot reach the chain', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(certificate);
      sorobanService.isConfigured.mockReturnValue(true);
      sorobanService.issueCertificate.mockResolvedValue(null);

      await expect(service.syncChain('cert-1')).rejects.toThrow(
        /on-chain issuance failed/i,
      );
      expect(certificateRepository.update).not.toHaveBeenCalled();
    });
  });
});
