import { createHash } from "node:crypto";
import fs from "node:fs";

/**
 * Keep a copy of the source PDF in the private `curriculum-sources` storage bucket (admin-readable),
 * so the exact document every record cites can always be re-opened and re-checked.
 *
 * The object is content-addressed (`<document id>/<sha256>.pdf`) and the checksum is verified before
 * upload, so a different file can never be stored under a document's name.
 */

export const SOURCES_BUCKET = "curriculum-sources";

export interface StorageUploader {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ error: { message: string } | null }>;
}

export async function uploadSourcePdf(
  storage: StorageUploader,
  input: { pdfPath: string; documentId: string; expectedSha256: string },
): Promise<string> {
  const bytes = fs.readFileSync(input.pdfPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== input.expectedSha256) {
    throw new Error(
      `Refusing to upload ${input.pdfPath}: its checksum ${sha256} is not the ${input.expectedSha256} the snapshot was extracted from.`,
    );
  }
  const objectPath = `${input.documentId}/${sha256}.pdf`;
  const { error } = await storage.upload(objectPath, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Uploading the source PDF failed: ${error.message}`);
  return objectPath;
}
