import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiError, storageClient } from "./infrai_storage.js";
import { WorkOrderUploadService } from "./work_order_upload_service.js";

const bucket = process.env.PHOTO_BUCKET ?? "field-service-work-order-photos";
const port = Number(process.env.PORT ?? 3000);

function send(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function start() {
  const uploads = new WorkOrderUploadService(storageClient, bucket);

  createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/work-orders/photo-upload") {
      send(response, 404, { error: "route_not_found" });
      return;
    }

    try {
      send(response, 200, await uploads.prepare(await readJson(request)));
    } catch (error) {
      if (error instanceof ZodError) {
        send(response, 400, { error: "invalid_request", issues: error.issues });
        return;
      }
      if (error instanceof InfraiError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        send(response, status, { error: error.detail });
        return;
      }
      send(response, 500, { error: "request_processing_failed" });
    }
  }).listen(port, () => {
    console.log(`Work-order upload service listening on http://localhost:${port}`);
  });
}

await start();
