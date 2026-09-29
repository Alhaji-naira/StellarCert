import { Test, TestingModule } from '@nestjs/testing';
import { JobsProcessor } from './jobs.processor';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Certificate } from '../../entities/certificate.entity';
import { WebhooksService } from '../../../webhooks/webhooks.service';
import { LoggingService } from '../../../../common/logging/logging.service';
import { EmailService } from '../../../email/email.service';
import { CertificatePdfService } from '../../services/pdf.service';

describe('JobsProcessor', () => {
  let processor: JobsProcessor;
  let emailService: jest.Mocked<EmailService>;
  let pdfService: jest.Mocked<CertificatePdfService>;
  let certificateRepository: any;

  beforeEach(async () => {
    const mockEmailService = { sendEmail: jest.fn() };
    const mockPdfService = { generate: jest.fn() };
    const mockRepo = { findOne: jest.fn() };
    const mockWebhooks = {};
    const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsProcessor,
        { provide: getRepositoryToken(Certificate), useValue: mockRepo },
        { provide: WebhooksService, useValue: mockWebhooks },
        { provide: LoggingService, useValue: mockLogger },
        { provide: EmailService, useValue: mockEmailService },
        { provide: CertificatePdfService, useValue: mockPdfService },
      ],
    }).compile();

    processor = module.get<JobsProcessor>(JobsProcessor);
    emailService = module.get(EmailService);
    pdfService = module.get(CertificatePdfService);
    certificateRepository = module.get(getRepositoryToken(Certificate));
  });

  it('should call EmailService on send-email', async () => {
    const jobData = { recipientEmail: 'test@example.com', subject: 'Test', metadata: {} };
    await processor.handleEmail({ data: jobData } as any);
    expect(emailService.sendEmail).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: 'Test',
      template: 'certificate-issued',
      data: {},
    });
  });

  it('should call PdfService on generate-pdf', async () => {
    const cert = { id: 'cert-1' };
    certificateRepository.findOne.mockResolvedValue(cert);
    await processor.handlePdf({ data: { certificateId: 'cert-1' } } as any);
    expect(pdfService.generate).toHaveBeenCalledWith(cert);
  });
});
