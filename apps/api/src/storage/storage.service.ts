import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';

export interface StoredFile {
  key: string;
  bucket: string;
  size: number;
  mimeType: string;
}

/** Thin wrapper over an S3-compatible object store (AWS S3 / MinIO). */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicEndpoint: string;
  private readonly forcePathStyle: boolean;

  constructor(private readonly config: ConfigService) {
    const s3 = this.config.get('s3');
    this.bucket = s3.bucket;
    this.publicEndpoint = s3.publicEndpoint;
    this.forcePathStyle = s3.forcePathStyle;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      credentials: {
        accessKeyId: s3.accessKey,
        secretAccessKey: s3.secretKey,
      },
    });
  }

  async onModuleInit() {
    // Best-effort bucket creation; ignore if it already exists / no perms.
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.warn(
          `Could not verify/create bucket "${this.bucket}": ${(err as Error).message}`,
        );
      }
    }
  }

  async upload(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    prefix = 'quotations',
  ): Promise<StoredFile> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}/${uuid()}-${safeName}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    return { key, bucket: this.bucket, size: buffer.length, mimeType };
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  /** Returns a temporary download URL for the object. */
  async getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
    // Rewrite internal endpoint to the host-reachable public endpoint
    return this.toPublicUrl(url);
  }

  private toPublicUrl(url: string): string {
    try {
      const internal = this.config.get('s3').endpoint as string;
      return url.replace(internal, this.publicEndpoint);
    } catch {
      return url;
    }
  }
}
