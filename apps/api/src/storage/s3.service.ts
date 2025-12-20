import { Injectable } from "@nestjs/common";
import { S3Client, HeadBucketCommand, CreateBucketCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "@famfinance/lib";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import * as https from "node:https";

function getAwsErrorInfo(err: unknown): { httpStatusCode?: number; code?: string } {
  if (!err || typeof err !== "object") return {};
  const anyErr = err as Record<string, unknown>;

  let httpStatusCode: number | undefined;
  const metadata = anyErr.$metadata;
  if (metadata && typeof metadata === "object") {
    const m = metadata as Record<string, unknown>;
    if (typeof m.httpStatusCode === "number") httpStatusCode = m.httpStatusCode;
  }
  const codeRaw = anyErr.Code ?? anyErr.code ?? anyErr.name;
  const code = typeof codeRaw === "string" ? codeRaw : undefined;

  return { httpStatusCode, code };
}

function destroyBodyIfPossible(body: unknown) {
  if (!body || typeof body !== "object") return;
  const maybe = body as { destroy?: () => void };
  if (typeof maybe.destroy === "function") maybe.destroy();
}

@Injectable()
export class S3Service {
  private readonly bucket = requireEnv("S3_BUCKET");
  private readonly allowSelfSigned = process.env.S3_ALLOW_SELF_SIGNED === "true";

  private handlerForEndpoint(endpoint?: string) {
    const isHttps = (endpoint ?? "").trim().toLowerCase().startsWith("https://");
    if (!isHttps || !this.allowSelfSigned) return undefined;
    return new NodeHttpHandler({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
  }

  private readonly internalHandler = this.handlerForEndpoint(process.env.S3_ENDPOINT);
  private readonly presignHandler = this.handlerForEndpoint(process.env.S3_PRESIGN_ENDPOINT ?? process.env.S3_ENDPOINT);

  private readonly internalClient = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY"),
      secretAccessKey: requireEnv("S3_SECRET_KEY"),
    },
    ...(this.internalHandler ? { requestHandler: this.internalHandler } : {}),
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
    ...(this.presignHandler ? { requestHandler: this.presignHandler } : {}),
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
    } catch (e: unknown) {
      const { httpStatusCode: httpStatus, code } = getAwsErrorInfo(e);

      // Some proxies mis-handle HEAD requests; fall back to a minimal ranged GET before concluding "missing".
      if (httpStatus === 404 || code === "NotFound" || code === "NoSuchKey") {
        try {
          const res = await this.internalClient.send(
            new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: "bytes=0-0" }),
          );
          destroyBodyIfPossible((res as { Body?: unknown }).Body);
          return true;
        } catch (e2: unknown) {
          const { httpStatusCode: httpStatus2, code: code2 } = getAwsErrorInfo(e2);
          if (httpStatus2 === 404 || code2 === "NotFound" || code2 === "NoSuchKey") return false;
          throw e2;
        }
      }

      // Anything else is likely configuration/permissions.
      throw e;
    }
  }
}
