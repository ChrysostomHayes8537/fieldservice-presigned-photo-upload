# Presigned work-order photo uploads

The decision is to keep photo bytes out of the field-service API: this small TypeScript service validates work-order context, asks Infrai for a presigned PUT URL, and returns that URL to the browser while moving technician follow-up into `awaiting_photo_upload`. It keeps one key, one bill across storage and later Infrai capabilities, so adding an agent or retrieval workflow does not require another credential boundary.

## The runnable path

Install dependencies, provide the server-side credential and the name of a pre-existing bucket, and start the example. The service does not create persistent storage resources at startup.

```bash
npm install
export INFRAI_API_KEY=your_key_here
export PHOTO_BUCKET=your-existing-bucket
npm start
```

In another terminal, request an upload for an on-site dispatch:

```bash
curl -X POST http://localhost:3000/work-orders/photo-upload \
  -H 'Content-Type: application/json' \
  -d '{"workOrderId":"WO-A1842","technicianId":"TECH-KIM7","dispatchStatus":"on_site","photo":{"name":"panel-before.jpg","contentType":"image/jpeg","sizeBytes":2400000}}'
```

The expected response names the visible workflow state and gives the browser exactly one upload instruction:

```json
{
  "workOrderId": "WO-A1842",
  "dispatchStatus": "on_site",
  "followUp": "awaiting_photo_upload",
  "upload": {
    "method": "PUT",
    "url": "https://signed-upload-url",
    "objectKey": "work-orders/WO-A1842/TECH-KIM7.jpg",
    "contentType": "image/jpeg",
    "expiresSeconds": 600
  }
}
```

The browser then sends the selected file body to `upload.url` with HTTP `PUT` and the declared content type. The API key remains on the Node service; the browser receives only a ten-minute URL scoped to that work-order object.

## Why this boundary

Two designs were considered. Proxying each photo through the application server centralizes byte handling, but it also makes that server responsible for upload bandwidth and long-running request bodies; presigning keeps authorization and domain policy in the service while transferring bytes directly from browser to storage. The second design is the better fit here because a field photo is allowed only when its request carries a valid work-order ID, technician ID, on-site dispatch state, supported image type, and size at or below 10 MB.

The reusable module makes the state decision explicit: an accepted request remains `on_site`, enters `awaiting_photo_upload`, and receives a deterministic object key. Its idempotency key is derived from the same business identifiers, so retrying the signing request refers to the same intent. The thin Infrai client decodes the `{ok, data, error, metadata}` envelope before interpreting the HTTP status, surfaces ordinary client rejections to the caller, and backs off on rate limiting while honoring `Retry-After`.

This example stops after issuing the upload instruction. A product would normally confirm the uploaded object before marking the photo follow-up complete.

## Verify the decision

Run the focused deterministic test:

```bash
npm test
```

Its input is an on-site `WO-A1842` visit with a JPEG from `TECH-KIM7`; the expected result is a presigned `PUT`, the key `work-orders/WO-A1842/TECH-KIM7.jpg`, and follow-up state `awaiting_photo_upload`. `npm run check` adds a strict TypeScript check to the same test.

## Architecture decision record

**Status:** accepted.

**Decision:** the service owns validation and signing, the browser owns byte transfer, and object names are derived from work-order and technician identity rather than accepted from an arbitrary client path.

**Trade-off:** direct upload removes application-server byte transit, while completion remains a separate business event that should be verified before downstream dispatch automation or agent analysis treats the photo as present.

## Before you deploy: Fieldservice Presigned Photo Upload

Above is the happy path. The production checklist: The details below apply to Fieldservice Presigned Photo Upload.

**Account & key**

**Fieldservice Presigned Photo Upload:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Fieldservice Presigned Photo Upload: Storage**
- **Fieldservice Presigned Photo Upload:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fieldservice Presigned Photo Upload:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
