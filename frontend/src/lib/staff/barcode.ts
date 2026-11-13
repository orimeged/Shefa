/**
 * Reading product barcodes with the phone's camera.
 *
 * Chrome on Android has a barcode reader built in. Safari doesn't, so iPhones get
 * the same interface from a WebAssembly build of ZXing, loaded only when needed and
 * served from this site rather than the CDN the library would fetch it from.
 */

// The codes on grocery packaging. QR codes and the rest are left out: fewer false reads.
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

export interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

interface NativeDetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

export async function createDetector(): Promise<Detector> {
  const native = (window as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (native) {
    try {
      const supported = await native.getSupportedFormats();
      const formats = FORMATS.filter((format) => supported.includes(format));
      if (formats.length > 0) return new native({ formats });
    } catch {
      // Fall through to the WebAssembly reader.
    }
  }
  const [{ BarcodeDetector, setZXingModuleOverrides }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
  });
  return new BarcodeDetector({ formats: [...FORMATS] });
}

/** A product code: 8 to 14 digits. Anything else the camera thought it saw is noise. */
export function isProductCode(raw: string): boolean {
  return /^\d{8,14}$/.test(raw.trim());
}
