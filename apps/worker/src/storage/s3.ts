import { S3Client, GetObjectCommand, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { requireEnv } from "@famfinance/lib";
import { Readable } from "node:stream";

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export class S3Storage {
  readonly bucket = requireEnv("S3_BUCKET");
  readonly client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY"),
      secretAccessKey: requireEnv("S3_SECRET_KEY"),
    },
  });

  private ensured = false;

  async ensureBucket(): Promise<void> {
    if (this.ensured) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.ensured = true;
      return;
    } catch {
      // fallthrough
    }
    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    this.ensured = true;
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) return Buffer.alloc(0);
    if (res.Body instanceof Readable) return streamToBuffer(res.Body);
    throw new Error("Unsupported S3 body type");
  }

  async putObject(params: { key: string; body: Buffer; contentType?: string }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
  }
}
