import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SOURCES_BUCKET,
  uploadSourcePdf,
  type StorageUploader,
} from "../../src/ingestion/upload-source";

function tempPdf(contents: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zt-upload-"));
  const file = path.join(dir, "doc.pdf");
  fs.writeFileSync(file, contents);
  return { file, sha256: createHash("sha256").update(contents).digest("hex") };
}

describe("uploadSourcePdf", () => {
  it("stores the PDF content-addressed under its document id, as application/pdf", async () => {
    const { file, sha256 } = tempPdf("%PDF-1.7 pretend syllabus");
    const upload = vi.fn(async () => ({ error: null }));
    const storage: StorageUploader = { upload };
    const stored = await uploadSourcePdf(storage, {
      pdfPath: file,
      documentId: "mopse-junior-mathematics-2024-2030",
      expectedSha256: sha256,
    });
    expect(stored).toBe(`mopse-junior-mathematics-2024-2030/${sha256}.pdf`);
    expect(upload).toHaveBeenCalledWith(stored, expect.any(Buffer), {
      contentType: "application/pdf",
      upsert: true,
    });
    expect(SOURCES_BUCKET).toBe("curriculum-sources");
  });

  it("refuses to upload a file whose checksum is not the one the snapshot was extracted from", async () => {
    const { file } = tempPdf("a different document");
    const upload = vi.fn(async () => ({ error: null }));
    await expect(
      uploadSourcePdf(
        { upload },
        { pdfPath: file, documentId: "doc", expectedSha256: "0".repeat(64) },
      ),
    ).rejects.toThrow(/Refusing to upload/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("surfaces storage errors", async () => {
    const { file, sha256 } = tempPdf("x");
    const storage: StorageUploader = {
      upload: async () => ({ error: { message: "bucket not found" } }),
    };
    await expect(
      uploadSourcePdf(storage, { pdfPath: file, documentId: "doc", expectedSha256: sha256 }),
    ).rejects.toThrow(/bucket not found/);
  });
});
