"use client";

// Getting a generated PNG onto the visitor's device.
//
// This was one line — an <a download> pointed at canvas.toDataURL() — and it
// did nothing at all on an iPhone, silently, while the UI reported success.
// Three separate reasons, each enough on its own:
//
//   1. iOS Safari does not honour the `download` attribute on a `data:` URL.
//   2. A 3x share card is several megabytes as base64, and Safari refuses to
//      act on a `data:` URL that large regardless of the attribute.
//   3. The anchor was never inserted into the document, which Safari has
//      historically required before a programmatic .click() does anything.
//
// So: a blob rather than a data URL, an anchor that is actually in the DOM,
// and — on touch devices — the native share sheet, which is how you save a
// picture on a phone in the first place. "Save Image" in that sheet puts it
// in Photos, which is what someone tapping Download Image on a phone
// actually wants; a file dropped in ~/Downloads is a desktop idea.

export type SaveImageOutcome =
  /** Handed to the OS share sheet. */
  | "shared"
  /** Written out as a file download. */
  | "downloaded"
  /** The share sheet opened and the visitor dismissed it. Not a failure, and
   *  specifically not something to congratulate them about. */
  | "cancelled";

/** The slice of `navigator` this needs, so a test can supply one. */
export interface ShareCapableNavigator {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
}

/* JPEG, not PNG.
 *
 * The card is film grain over a soft gradient, which is close to the worst
 * case PNG has: high-frequency noise with almost nothing to predict. Measured
 * at 2x, the landscape export was 6.9 MB and the story export 9.8 MB -- the
 * latter within a rounding error of what Discord accepts from a free account,
 * for an image no feed will ever show above 1600px. The same frames as JPEG
 * are a fraction of that and indistinguishable at any size a person looks at
 * them, because there is no flat colour or hard edge for the encoder to ring
 * against; the card is deliberately built out of gradients.
 *
 * Nothing on the card is transparent -- it paints its own ground -- so the one
 * thing PNG offers here is not in use.
 *
 * 0.92 rather than the usual 0.8: the text is thin bone-on-black at 2x, which
 * is where JPEG shows its edges first, and the difference in bytes between
 * 0.82 and 0.92 is small next to the difference from PNG.
 */
const EXPORT_TYPE = "image/jpeg";
const EXPORT_QUALITY = 0.92;

/** The file extension matching what canvasToShareBlob produces. */
export const EXPORT_EXTENSION = "jpg";

/** canvas.toBlob is callback-based and can hand back null. */
export function canvasToShareBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob produced nothing"));
      },
      EXPORT_TYPE,
      EXPORT_QUALITY,
    );
  });
}

/** Whether to offer the share sheet rather than a file download.
 *
 *  Coarse pointer only. Desktop Chrome on Windows reports canShare({files})
 *  as true, and swapping a one-click download for a share dialog there would
 *  be a downgrade for the people the feature already worked for. */
export function shouldShare(
  file: File,
  nav: ShareCapableNavigator,
  isTouch: boolean,
): boolean {
  if (!isTouch) return false;
  if (typeof nav.share !== "function") return false;
  // canShare must be consulted with the actual files: a browser can support
  // sharing text and refuse to share a PNG.
  return nav.canShare?.({ files: [file] }) === true;
}

export async function saveImage(
  blob: Blob,
  filename: string,
  {
    nav = navigator as ShareCapableNavigator,
    doc = document,
    isTouch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
  }: {
    nav?: ShareCapableNavigator;
    doc?: Document;
    isTouch?: boolean;
  } = {},
): Promise<SaveImageOutcome> {
  // Typed from the blob rather than hardcoded: this said image/png for a
  // while after the export became a JPEG, which is the sort of mismatch a
  // share sheet is entitled to reject.
  const file = new File([blob], filename, { type: blob.type || EXPORT_TYPE });

  if (shouldShare(file, nav, isTouch)) {
    try {
      await nav.share!({ files: [file], title: filename });
      return "shared";
    } catch (error) {
      // A dismissed share sheet arrives as AbortError. Anything else means
      // sharing is broken here, and a download is still worth trying —
      // notably when the gesture that opened this has already expired,
      // which Safari reports as NotAllowedError.
      if ((error as { name?: string })?.name === "AbortError") return "cancelled";
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const link = doc.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    // In the document, not just constructed: Safari ignores .click() on a
    // detached anchor.
    doc.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoking synchronously can cancel the download that was just started;
    // one turn of the event loop is enough for the browser to have taken it.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return "downloaded";
}
