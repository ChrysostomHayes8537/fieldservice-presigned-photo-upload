import { z } from "zod";
import type { StorageClient } from "./infrai_storage.js";

export const uploadRequestSchema = z.object({
  workOrderId: z.string().regex(/^WO-[A-Z0-9]{4,20}$/),
  technicianId: z.string().regex(/^TECH-[A-Z0-9]{3,20}$/),
  dispatchStatus: z.literal("on_site"),
  photo: z.object({
    name: z.string().min(1).max(120),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z.number().int().positive().max(10_000_000),
  }),
});

export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export type UploadDecision = {
  workOrderId: string;
  dispatchStatus: "on_site";
  followUp: "awaiting_photo_upload";
  upload: {
    method: "PUT";
    url: string;
    objectKey: string;
    contentType: UploadRequest["photo"]["contentType"];
    expiresSeconds: number;
  };
};

const extensionByType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export class WorkOrderUploadService {
  private readonly storage: StorageClient;
  private readonly bucket: string;

  constructor(storage: StorageClient, bucket: string) {
    this.storage = storage;
    this.bucket = bucket;
  }

  async prepare(rawInput: unknown): Promise<UploadDecision> {
    const input = uploadRequestSchema.parse(rawInput);
    const extension = extensionByType[input.photo.contentType];
    const objectKey = `work-orders/${input.workOrderId}/${input.technicianId}.${extension}`;
    const expiresSeconds = 600;
    const signed = await this.storage.presignPhoto(this.bucket, objectKey, {
      op: "put",
      expires_seconds: expiresSeconds,
      content_type: input.photo.contentType,
      max_bytes: input.photo.sizeBytes,
      idempotency_key: `${input.workOrderId}:${input.technicianId}:${input.photo.name}`,
    });

    return {
      workOrderId: input.workOrderId,
      dispatchStatus: input.dispatchStatus,
      followUp: "awaiting_photo_upload",
      upload: {
        method: "PUT",
        url: signed.url,
        objectKey,
        contentType: input.photo.contentType,
        expiresSeconds,
      },
    };
  }
}
