import assert from "node:assert/strict";
import test from "node:test";
import type { StorageClient } from "../src/infrai_storage.js";
import { WorkOrderUploadService } from "../src/work_order_upload_service.js";

test("an on-site technician receives a scoped PUT and enters photo follow-up", async () => {
  let presignInput: Parameters<StorageClient["presignPhoto"]> | undefined;
  const storage: StorageClient = {
    async presignPhoto(...input) {
      presignInput = input;
      return { url: "https://uploads.example/signed-photo" };
    },
  };
  const service = new WorkOrderUploadService(storage, "work-order-photos");

  const result = await service.prepare({
    workOrderId: "WO-A1842",
    technicianId: "TECH-KIM7",
    dispatchStatus: "on_site",
    photo: { name: "panel-before.jpg", contentType: "image/jpeg", sizeBytes: 2_400_000 },
  });

  assert.equal(result.followUp, "awaiting_photo_upload");
  assert.equal(result.upload.method, "PUT");
  assert.equal(result.upload.objectKey, "work-orders/WO-A1842/TECH-KIM7.jpg");
  assert.deepEqual(presignInput, [
    "work-order-photos",
    "work-orders/WO-A1842/TECH-KIM7.jpg",
    {
      op: "put",
      expires_seconds: 600,
      content_type: "image/jpeg",
      max_bytes: 2_400_000,
      idempotency_key: "WO-A1842:TECH-KIM7:panel-before.jpg",
    },
  ]);
});
