import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';

export interface StoredFile {
  key: string;
  bucket: string;
  size: number;
  mimeType: string;
}

/**
 * Storage backed by Supabase Storage.
 *
 * All bucket/object operations use a dedicated server-side ADMIN client built
 * from the SERVICE ROLE key (the anon key cannot create buckets). The bucket is
 * PRIVATE — files contain sensitive supplier prices/terms — so downloads are
 * served via short-lived signed URLs.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly admin: SupabaseClient;
  private readonly bucket: string;
  private static readonly SIGNED_URL_TTL = 3600; // 1 hour

  constructor(private readonly config: ConfigService) {
    const supabase = this.config.get<{
      url: string;
      serviceRoleKey: string;
      bucket: string;
    }>('supabase');

    // Fail fast with a clear message instead of silently using the anon key.
    if (!supabase?.url || !supabase?.serviceRoleKey) {
      const missing = [
        !supabase?.url && 'SUPABASE_URL',
        !supabase?.serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
      ]
        .filter(Boolean)
        .join(', ');
      throw new Error(
        `Supabase storage is misconfigured: missing ${missing}. ` +
          `Set both env vars — the SERVICE ROLE key is required for bucket/storage operations.`,
      );
    }

    this.bucket = supabase.bucket;
    this.admin = createClient(supabase.url, supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Idempotent + quiet: ensure the private bucket exists on startup. */
  async onModuleInit() {
    const { data: existing, error: getErr } = await this.admin.storage.getBucket(
      this.bucket,
    );
    if (existing) {
      this.logger.log(`Storage bucket "${this.bucket}" is ready (private).`);
      return;
    }

    const { error: createErr } = await this.admin.storage.createBucket(
      this.bucket,
      { public: false },
    );
    if (!createErr) {
      this.logger.log(`Created private storage bucket "${this.bucket}".`);
      return;
    }

    // "Already exists" is success, not a warning (e.g. created between calls).
    if (this.isAlreadyExists(createErr)) {
      this.logger.log(`Storage bucket "${this.bucket}" already exists (private).`);
      return;
    }

    // Genuine failure — log enough to debug (message + code), then surface it.
    const code = (createErr as { statusCode?: string }).statusCode ?? 'unknown';
    this.logger.error(
      `Failed to create storage bucket "${this.bucket}": ${createErr.message} (code: ${code})` +
        (getErr ? ` [getBucket: ${getErr.message}]` : ''),
    );
  }

  async upload(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    prefix = 'quotations',
  ): Promise<StoredFile> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}/${uuid()}-${safeName}`;
    const { error } = await this.admin.storage
      .from(this.bucket)
      .upload(key, buffer, { contentType: mimeType, upsert: false });
    if (error) {
      throw new Error(`Storage upload failed for "${key}": ${error.message}`);
    }
    return { key, bucket: this.bucket, size: buffer.length, mimeType };
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const { data, error } = await this.admin.storage
      .from(this.bucket)
      .download(key);
    if (error || !data) {
      throw new Error(
        `Storage download failed for "${key}": ${error?.message ?? 'no data'}`,
      );
    }
    return Buffer.from(await data.arrayBuffer());
  }

  /** Short-lived signed URL for downloading/previewing a private object. */
  async getDownloadUrl(
    key: string,
    expiresIn = StorageService.SIGNED_URL_TTL,
  ): Promise<string> {
    const { data, error } = await this.admin.storage
      .from(this.bucket)
      .createSignedUrl(key, expiresIn);
    if (error || !data?.signedUrl) {
      throw new Error(
        `Could not create signed URL for "${key}": ${error?.message ?? 'no URL returned'}`,
      );
    }
    return data.signedUrl;
  }

  private isAlreadyExists(error: { message?: string; statusCode?: string }): boolean {
    return (
      error.statusCode === '409' ||
      /already exists|resource already exists/i.test(error.message ?? '')
    );
  }
}
