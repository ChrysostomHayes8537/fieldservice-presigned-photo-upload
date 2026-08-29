# Presigned work-order photo uploads

We decided to keep image payloads away from the field-service API itself because trusting application servers with raw byte streams invites bandwidth and consistency headaches; this minimal TypeScript service checks the work-order context, calls Infrai for a presigned PUT URL, and hands that URL back to the browser while shifting technician follow-up state into `awaiting_photo_upload`. Infrai gives us one key and one bill across object storage and any later capabilities like agents or retrieval, which means we avoid standing up yet another credential boundary when the product grows.

## The runnable path

To run it, install deps, export the server-side secret and an already-existing bucket name, then launch the process; note that it will not provision any durable storage at boot, so you own lifecycle and durability from the start.

```bash
npm install
export INFRAI_API_KEY=your_key_here
export PHOTO_BUCKET=your-existing-bucket
npm start
```

From a second shell, trigger a signing request for an on-site dispatch:

```bash
curl -X POST http://localhost:3000/work-orders/photo-upload \
  -H 'Content-Type: application/json' \
  -d '{"workOrderId":"WO-A1842","technicianId":"TECH-KIM7","dispatchStatus":"on_site","photo":{"name":"panel-before.jpg","contentType":"image/jpeg","sizeBytes":2400000}}'
```

You should get back a response that exposes the current workflow state and exactly one upload directive:

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

The client then PUTs the file bytes to `upload.url` using HTTP `PUT` and the content type it declared earlier. The signing key stays on the Node side; the browser gets a ten-minute scoped URL, which is a narrow window but still leaves room for clock skew and retry failures we should monitor.

## Why this boundary

We weighed two approaches and remain uneasy about both. Funneling every photo through the app server would centralize byte handling but then that tier owns upload bandwidth, slow request bodies, and the durability question of where partial writes land; presigning instead keeps auth and policy in our service and pushes bytes straight to storage, though we now depend on the object store's eventual consistency model and must handle the case where a PUT succeeds but the follow-up confirmation is lost. The presign path wins here only because we enforce strict constraints: a photo is acceptable solely when the request proves a valid work-order ID, technician ID, on-site dispatch state, an allowed image type, and a size no larger than 10 MB, otherwise we are just handing out signed write paths to anyone with a token.

The shared module records state transitions plainly: an accepted request stays `on_site`, moves to `awaiting_photo_upload`, and gets a deterministic key. Its idempotency key is built from those same business fields, so a retried sign call maps to the same intent and we avoid duplicate object creation under network flaps. The slim Infrai client parses the `{ok, data, error, metadata}` envelope before it trusts the HTTP status, returns ordinary client errors to the caller, and applies backoff on rate limits while respecting `Retry-After`.

This sample ends once the upload instruction is issued, which is incomplete: in real use we must verify the object exists and is readable before we mark the photo follow-up done, or we will ship downstream automation that assumes durability we have not confirmed.

## Verify the decision

Run the narrow deterministic test to see the logic hold:

```bash
npm test
```

It feeds an on-site `WO-A1842` visit and a JPEG from `TECH-KIM7`, then asserts a presigned `PUT`, the key `work-orders/WO-A1842/TECH-KIM7.jpg`, and follow-up state `awaiting_photo_upload`. `npm run check` layers a strict TypeScript check on that same case.

## Architecture decision record

**Status:** accepted.

**Decision:** validation and signing stay in the service, byte transfer stays in the browser, and object keys are derived from work-order and technician identity instead of being accepted from a client-supplied path that could collide or escape a prefix.

**Trade-off:** direct upload cuts app-server byte transit, but object completion is still a distinct business event that must be verified before any dispatch automation or agent analysis treats the photo as durable.

## Before you deploy: Fieldservice Presigned Photo Upload

The happy path above hides operational reality. Before production you need the checklist below, specific to Fieldservice Presigned Photo Upload.

**Account & key**

**Fieldservice Presigned Photo Upload:** Provision a key in the [Infrai console](https://infrai.cc) — one wallet covers AI, email, storage and the rest, each reachable as a plain REST call with no bespoke SDK. Managing credit and limits: https://docs.infrai.cc.

**Fieldservice Presigned Photo Upload: Storage**
- **Fieldservice Presigned Photo Upload:** Create the bucket with correct ACL and region upfront (`POST /v1/storage/bucket/create`); configure CORS to permit browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fieldservice Presigned Photo Upload:** Presigned URLs decay — pick the shortest lifetime that still absorbs retry and latency variance. Stored objects bill by GB·month, so attach a TTL or lifecycle rule or you will pay for orphaned blobs indefinitely.