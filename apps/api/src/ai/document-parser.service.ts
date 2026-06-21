import { Injectable, Logger } from '@nestjs/common';

// Lazy requires keep heavy native deps out of the cold-start path.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  /** Extracts plain text from a supported document buffer. */
  async extractText(buffer: Buffer, mimeType: string): Promise<string> {
    try {
      if (mimeType === 'application/pdf') {
        return this.fromPdf(buffer);
      }
      if (
        mimeType ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword'
      ) {
        return this.fromDocx(buffer);
      }
      if (mimeType.startsWith('image/')) {
        return this.fromImage(buffer);
      }
      // Fallback: try to read as utf-8 text
      return buffer.toString('utf-8');
    } catch (err) {
      this.logger.error(`Document parse failed: ${(err as Error).message}`);
      return '';
    }
  }

  private async fromPdf(buffer: Buffer): Promise<string> {
    const data = await pdfParse(buffer);
    return (data.text ?? '').trim();
  }

  private async fromDocx(buffer: Buffer): Promise<string> {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return (result.value ?? '').trim();
  }

  /** OCR for images (JPG/PNG) via tesseract.js. */
  private async fromImage(buffer: Buffer): Promise<string> {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(buffer);
      return (data.text ?? '').trim();
    } finally {
      await worker.terminate();
    }
  }
}
