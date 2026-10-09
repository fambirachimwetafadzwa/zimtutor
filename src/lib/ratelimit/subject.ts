import { createHmac } from "node:crypto";

/**
 * What is stored for the thing being counted: a keyed hash of its bucket and value. The value (a
 * username, an email address, an internet address) is not kept, and without the secret nobody can
 * find out whose counter a row is, or test a guess against it.
 */
export function subjectHash(secret: string, bucket: string, subject: string): string {
  return (
    createHmac("sha256", secret)
      // a bucket name never contains a colon, so the two parts cannot run into each other
      .update(`${bucket}:${subject.trim().toLowerCase()}`)
      .digest("hex")
  );
}
