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

/** canvas.toBlob is callback-based and can hand back null. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob produced nothing"));
    }, "image/png");
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
  const file = new File([blob], filename, { type: "image/png" });

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
