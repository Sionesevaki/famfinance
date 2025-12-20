import { Injectable } from "@nestjs/common";
import { S3Client, HeadBucketCommand, CreateBucketCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "@famfinance/lib";

@Injectable()
export class S3Service {
  private readonly bucket = requireEnv("S3_BUCKET");
  private readonly internalClient = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY"),
      secretAccessKey: requireEnv("S3_SECRET_KEY"),
    },
  });

  // Use a public endpoint for presigned URLs so browsers can reach it.
  // Example:
  // - S3_ENDPOINT=http://minio:9000 (internal docker network)
  // - S3_PRESIGN_ENDPOINT=https://minio.yourdomain.com (public)
  private readonly presignClient = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_PRESIGN_ENDPOINT ?? process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY"),
      secretAccessKey: requireEnv("S3_SECRET_KEY"),
    },
  });

  private bucketEnsured = false;

  async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) return;

    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketEnsured = true;
      return;
    } catch {
      // fallthrough
    }

    await this.internalClient.send(new CreateBucketCommand({ Bucket: this.bucket }));
    this.bucketEnsured = true;
  }

  async presignPutObject(params: { key: string; contentType: string }) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });

    const url = await getSignedUrl(this.presignClient, cmd, { expiresIn: 15 * 60 });
    return { url, headers: { "Content-Type": params.contentType } };
  }

  async presignGetObject(params: { key: string }) {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
    });

    return getSignedUrl(this.presignClient, cmd, { expiresIn: 15 * 60 });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.internalClient.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
