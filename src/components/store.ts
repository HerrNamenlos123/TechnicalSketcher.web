import type {
  FSDirEntry,
  FSFileEntry,
  ImageShapeFileFormat,
  LineShapeFileFormat,
  TextblockShapeFileFormat,
  TskFileFormat,
  VaultFS,
} from "@/types";
import { defineStore } from "pinia";
import {
  type Point,
  DEFAULT_PAGE_COLOR,
  DEFAULT_PAGE_SIZE,
  DEFAULT_GRID_COLOR,
  DEFAULT_ZOOM_PX_PER_MM,
  type Document,
  type Page,
  DEFAULT_DOCUMENT_OFFSET,
  type BBox,
  type Shape,
  type ImageShape,
  type LineShape,
  type TextblockShape,
} from "./Document";
import { Vec2 } from "./Vector";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import getStroke from "perfect-freehand";
// import PaperTexture from "@/assets/paper-texture.jpg";
// import PaperTextureWhite from "@/assets/paper-texture-white.avif";
import PaperTextureTiling from "@/assets/paper-texture-tiling.jpg";
import { nextTick } from "vue";

export const RESIZE_HANDLE_SIZE = 8;

export function assert<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (!value) throw new Error(message ?? "Assertion failed");
}

export function loadImageAsync(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function isPointInBBox(bbox: BBox, point: Vec2) {
  return (
    point.x >= bbox.left &&
    point.x <= bbox.right &&
    point.y >= bbox.top &&
    point.y <= bbox.bottom
  );
}

export function updateShapeBBox(shape: Shape) {
  if (shape.variant === "Line") {
    const outlineMm = useStore()
      .getPath(shape.penThickness, shape.points, "accurate")
      .map((p) => new Vec2(p[0], p[1]));
    const bbox: BBox = {
      left: outlineMm[0].x,
      right: outlineMm[0].x,
      bottom: outlineMm[0].y,
      top: outlineMm[0].y,
    };
    for (const p of outlineMm) {
      if (p.x < bbox.left) {
        bbox.left = p.x;
      }
      if (p.x > bbox.right) {
        bbox.right = p.x;
      }
      if (p.y < bbox.top) {
        bbox.top = p.y;
      }
      if (p.y > bbox.bottom) {
        bbox.bottom = p.y;
      }
    }
    shape.bbox = bbox;
  } else {
    shape.bbox = {
      left: shape.position.x,
      top: shape.position.y,
      right: shape.position.x + shape.size.x,
      bottom: shape.position.y + shape.size.y,
    };
  }
}

export function combineBBox(a: BBox, b: BBox): BBox {
  return {
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

export const useStore = defineStore("main", {
  state: () => ({
    vault: undefined as VaultFS | undefined,
    leftSidebarVisible: true,
    openDocuments: [] as Document[],
    currentlyOpenDocument: undefined as Document | undefined,
    penSizeMm: 0.3,
    penColor: "#000000",
    perfectFreehandAccuracyScaling: 10,
    pageGap: 1.03,
    eraserSizePx: 5,
    gridLineThicknessMm: 0.2,
    gridLineDistanceMm: 10,
    paperTexture: undefined as HTMLImageElement | undefined,
    includePaperTextureInPdf: true,
    triggerRender: false,
    forceDeepRender: false,
    forceShallowRender: false,
    // canvasPool: [] as {
    //   canvas: HTMLCanvasElement,
    //   pageIndex?: number,
    // }[],
  }),
  actions: {
    async initVault() {
      const dirHandle = await window.showDirectoryPicker();
      await dirHandle.requestPermission({ mode: "readwrite" });

      await new Promise((resolve, reject) => {
        const request = indexedDB.open("vault-db", 1);

        request.onupgradeneeded = () => {
          request.result.createObjectStore("vault");
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("vault", "readwrite");
          tx.objectStore("vault").put(dirHandle, "dir");
          tx.oncomplete = () => {
            db.close();
            resolve(null);
          };
          tx.onerror = () => reject(tx.error);
        };

        request.onerror = () => reject(request.error);
      });
    },

    async readVault(rootHandle: FileSystemDirectoryHandle): Promise<VaultFS> {
      const processEntries = async (
        dirHandle: FileSystemDirectoryHandle,
        parentPath: string,
      ): Promise<(FSFileEntry | FSDirEntry)[]> => {
        const entries: (FSFileEntry | FSDirEntry)[] = [];
        for await (const [name, handle] of dirHandle.entries()) {
          if (handle.kind === "file") {
            let skip = false;
            if (name.includes(".crswap")) {
              skip = true;
            }
            if (name.includes(".pdf")) {
              skip = true;
            }
            if (!skip) {
              entries.push({
                type: "file",
                filename: name,
                handle: handle,
                fullPath: parentPath + name,
              });
            }
          } else if (handle.kind === "directory") {
            const children = await processEntries(
              handle,
              parentPath + name + "/",
            );
            children.sort((a, b) => {
              const nameA = a.handle.name;
              const nameB = b.handle.name;
              if (a.type === "directory") return -1;
              if (b.type === "directory") return 1;
              return nameA.localeCompare(nameB);
            });
            if (children.length > 0) {
              entries.push({
                type: "directory",
                dirname: name,
                handle: handle,
                fullPath: parentPath + name + "/",
                children: children,
              });
            }
          }
        }
        return entries;
      };

      const fs: VaultFS = {
        filetree: await processEntries(rootHandle, ""),
        rootHandle: rootHandle,
      };
      fs.filetree.sort((a, b) => {
        const nameA = a.handle.name;
        const nameB = b.handle.name;
        if (a.type === "directory") return -1;
        if (b.type === "directory") return 1;
        return nameA.localeCompare(nameB);
      });
      return fs;
    },
    async loadVault() {
      const dbs = await indexedDB.databases();
      const exists = dbs.some((db) => db.name === "vault-db");
      if (!exists) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("vault-db", 1);

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("vault", "readwrite");
          const store = tx.objectStore("vault");
          const getReq = store.get("dir");

          getReq.onsuccess = async () => {
            const dirHandle = getReq.result;
            if (
              dirHandle &&
              (await dirHandle.queryPermission({ mode: "readwrite" })) ===
              "granted"
            ) {
              useStore().vault = await this.readVault(dirHandle);
            }
            resolve();
          };

          getReq.onerror = () => reject(getReq.error);
        };

        request.onerror = () => reject(request.error);
      });
    },
    async loadDocument(filehandle: FSFileEntry): Promise<Document | undefined> {
      const file = await filehandle.handle.getFile();
      const content = await file.text();

      try {
        const input: TskFileFormat = JSON.parse(content);

        if (input.filetype !== "technicalsketcher") {
          console.error("File type was not 'technicalsketcher'");
          return undefined;
        }

        if (input.fileversion !== 1) {
          console.error("File version was not 1");
          return undefined;
        }

        const document: Document = {
          pages: await Promise.all(
            input.data.pages.map(
              async (p, i): Promise<Page> => ({
                pageIndex: i,
                shapes: await Promise.all(
                  p.shapes.map(async (s) => {
                    if (s.variant === "Line") {
                      const line = {
                        variant: "Line",
                        points: s.points.map((point) => ({
                          x: point.x,
                          y: point.y,
                          pressure: point.pressure,
                        })),
                        bbox: { left: 0, right: 0, top: 0, bottom: 0 },
                        penColor:
                          typeof s.penColor === "string"
                            ? s.penColor
                            : "#000000",
                        penThickness: s.penThickness,
                      } satisfies LineShape;
                      updateShapeBBox(line);
                      return line;
                    } else if (s.variant === "Image") {
                      const image = {
                        variant: "Image",
                        position: {
                          x: s.position.x,
                          y: s.position.y,
                        },
                        bbox: { left: 0, right: 0, top: 0, bottom: 0 },
                        base64ImageData: s.base64ImageData,
                        image: await loadImageAsync(s.base64ImageData),
                        size: new Vec2(s.size.x, s.size.y),
                      } satisfies ImageShape;
                      updateShapeBBox(image);
                      return image;
                    } else if (s.variant === "Textblock") {
                      const textblock = {
                        variant: "Textblock",
                        position: {
                          x: s.position.x,
                          y: s.position.y,
                        },
                        bbox: { left: 0, right: 0, top: 0, bottom: 0 },
                        rawText: s.rawText,
                        size: new Vec2(s.size.x, s.size.y),
                      } satisfies TextblockShape;
                      updateShapeBBox(textblock);
                      return textblock;
                    } else {
                      throw new Error();
                    }
                  }),
                ),
                previewLine: undefined,
              }),
            ),
          ),
          size_mm: new Vec2(
            input.data.pageWidthMm ?? DEFAULT_PAGE_SIZE.x,
            input.data.pageHeightMm ?? DEFAULT_PAGE_SIZE.y,
          ),
          pageColor: input.data.pageColor,
          gridColor: input.data.gridColor,
          gridType: input.data.gridType,
          offset: DEFAULT_DOCUMENT_OFFSET,
          zoom_px_per_mm: 5,
          fileHandle: filehandle,
          currentPageIndex: input.data.currentPageIndex ?? 0,
        };
        return document;
      } catch (e: unknown) {
        console.error(e);
        return undefined;
      }
    },
    async loadAndOpenDocument(filehandle: FSFileEntry) {
      const newDoc = await this.loadDocument(filehandle);
      if (!newDoc) {
        console.error("Loading doc failed");
        return;
      }
      for (let i = 0; i < this.openDocuments.length; i++) {
        if (
          this.openDocuments[i].fileHandle?.filename ===
          newDoc?.fileHandle?.filename
        ) {
          this.openDocuments[i] = newDoc;
          this.currentlyOpenDocument = undefined;
          await nextTick();
          this.currentlyOpenDocument = newDoc;
          this.forceDeepRender = true;
          this.triggerRender = true;
          return;
        }
      }

      // No match
      this.openDocuments.push(newDoc);
      this.currentlyOpenDocument = undefined;
      await nextTick();
      this.currentlyOpenDocument = newDoc;
      this.forceDeepRender = true;
      this.triggerRender = true;
    },
    async saveDocument(document: Document) {
      const output: TskFileFormat = {
        filetype: "technicalsketcher",
        fileversion: 1,
        data: {
          pageColor: document.pageColor,
          gridColor: document.gridColor,
          gridType: document.gridType,
          pages: document.pages.map((p) => ({
            shapes: p.shapes
              .map((s) => {
                if (s.variant === "Line") {
                  return {
                    variant: "Line",
                    points: s.points.map((point) => ({
                      x: point.x,
                      y: point.y,
                      pressure: point.pressure,
                    })),
                    penThickness: s.penThickness,
                    penColor: s.penColor,
                  } satisfies LineShapeFileFormat;
                } else if (s.variant === "Textblock") {
                  if (s.rawText.length === 0) {
                    return undefined;
                  }
                  return {
                    variant: "Textblock",
                    position: s.position,
                    size: {
                      x: s.size.x,
                      y: s.size.y,
                    },
                    rawText: s.rawText,
                  } satisfies TextblockShapeFileFormat;
                } else {
                  return {
                    variant: "Image",
                    base64ImageData: s.base64ImageData,
                    position: s.position,
                    size: {
                      x: s.size.x,
                      y: s.size.y,
                    },
                  } satisfies ImageShapeFileFormat;
                }
              })
              .filter((s) => !!s),
          })),
          pageWidthMm: document.size_mm.x,
          pageHeightMm: document.size_mm.y,
          currentPageIndex: document.currentPageIndex,
        },
      };

      if (!document.fileHandle) {
        console.error("fileHandle missing while saving");
        return;
      }

      const writable = await document.fileHandle.handle.createWritable();
      await writable.write(JSON.stringify(output));
      await writable.close();
    },
    async fileExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
      const parts = path.split("/").filter(Boolean);
      const filename = parts.pop()!;
      let dir = root;

      try {
        for (const part of parts) {
          dir = await dir.getDirectoryHandle(part, { create: false });
        }

        await dir.getFileHandle(filename, { create: false });
        return true;
      } catch (e) {
        return false;
      }
    },
    async getOrCreateFile(root: FileSystemDirectoryHandle, path: string) {
      const parts = path.split("/").filter(Boolean);
      const filename = parts.pop()!;
      let dir = root;

      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }

      return await dir.getFileHandle(filename, { create: true });
    },
    async createDocument(path: string) {
      if (!this.vault?.filetree) {
        return;
      }

      if (path.length === 0) {
        return;
      }

      if (!path.endsWith(".tsk")) {
        path += ".tsk";
      }

      const fileExisted = await this.fileExists(this.vault.rootHandle, path);

      const filehandle = await this.getOrCreateFile(
        this.vault.rootHandle,
        path,
      );
      const handle: FSFileEntry = {
        handle: filehandle,
        filename: path.split("/").pop()!,
        type: "file",
        fullPath: path,
      };

      if (fileExisted) {
        this.loadAndOpenDocument(handle);
        return;
      }

      const doc: Document = {
        gridColor: DEFAULT_GRID_COLOR,
        gridType: "lines",
        offset: DEFAULT_DOCUMENT_OFFSET,
        pageColor: DEFAULT_PAGE_COLOR,
        pages: [
          {
            pageIndex: 0,
            previewLine: undefined,
            shapes: [],
          },
        ],
        zoom_px_per_mm: DEFAULT_ZOOM_PX_PER_MM,
        size_mm: DEFAULT_PAGE_SIZE,
        currentPageIndex: 0,
      };
      doc.fileHandle = handle;

      await this.saveDocument(doc);
      await this.loadVault();
      await this.loadAndOpenDocument(handle);
    },
    getPath(penSize: number, points: Point[], mode: "fast" | "accurate") {
      const scaledPoints = points.map((p) => ({
        pressure: p.pressure,
        x: p.x * this.perfectFreehandAccuracyScaling,
        y: p.y * this.perfectFreehandAccuracyScaling,
      }));
      const result = getStroke(scaledPoints, {
        size: penSize * this.perfectFreehandAccuracyScaling,
        smoothing: 0,
        streamline: mode === "fast" ? 0.6 : 0.6,
        thinning: 0.1,
      });
      const scaledResult = result.map((p) => [
        p[0] / this.perfectFreehandAccuracyScaling,
        p[1] / this.perfectFreehandAccuracyScaling,
      ]);
      return scaledResult;
    },
    async getImageBytesFromElement(img: HTMLImageElement): Promise<Uint8Array> {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(new Uint8Array(reader.result as ArrayBuffer));
          };
          reader.readAsArrayBuffer(blob!);
        }, "image/png");
      });
    },
    async exportDocumentAsPdf(doc: Document) {
      function getSvgPathFromStroke(points: number[][]): string {
        if (!points.length) return "";

        const d = [];
        d.push(`M${points[0][0]} ${points[0][1]}`);

        for (let i = 1; i < points.length - 1; i++) {
          const [x0, y0] = points[i];
          const [x1, y1] = points[i + 1];
          const mx = (x0 + x1) / 2;
          const my = (y0 + y1) / 2;
          d.push(`Q${x0} ${y0} ${mx} ${my}`);
        }

        d.push("Z");
        return d.join(" ");
      }

      const pdfDoc = await PDFDocument.create();
      assert(this.paperTexture);
      const imgBytes = await this.getImageBytesFromElement(this.paperTexture);
      const pdfImage = await pdfDoc.embedPng(imgBytes);

      for (const page of doc.pages) {
        if (page.shapes.length === 0) {
          continue;
        }

        const pdfPage = pdfDoc.addPage([doc.size_mm.x, doc.size_mm.y]);

        if (this.includePaperTextureInPdf) {
          pdfPage.drawImage(pdfImage, {
            x: 0,
            y: pdfPage.getHeight(),
            width: pdfPage.getWidth(),
            height: -pdfPage.getHeight(),
          });
        }

        this.drawGridPdf(pdfPage, doc);
        pdfPage.moveTo(0, pdfPage.getHeight());

        for (const shape of page.shapes) {
          if (shape.variant === "Line") {
            const stroke = this.getPath(
              shape.penThickness,
              shape.points,
              "accurate",
            );
            const d = getSvgPathFromStroke(stroke);
            const { r, g, b, a } = this.parseColor(shape.penColor);
            pdfPage.drawSvgPath(d, {
              color: rgb(r / 255, g / 255, b / 255),
              opacity: a,
            });
          } else if (shape.variant === "Textblock") {
          } else {
            const base64 = shape.base64ImageData.replace(
              /^data:image\/\w+;base64,/,
              "",
            );
            const byteArray = Uint8Array.from(atob(base64), (c) =>
              c.charCodeAt(0),
            );
            const image = await pdfDoc.embedPng(byteArray);
            console.log(shape)
            pdfPage.drawImage(image, {
              x: shape.position.x,
              y: pdfPage.getHeight() - shape.size.y - shape.position.y,
              width: shape.size.x,
              height: shape.size.y,
            });
          }
        }
      }

      if (!doc.fileHandle) {
        console.error("Export missing filehandle");
        return;
      }
      if (!this.vault) {
        console.error("Vault missing");
        return;
      }

      const replaceExt = (path: string, newExt: string) =>
        path.replace(/\.[^/.]+$/, "") + newExt;

      const pdfPath = replaceExt(doc.fileHandle.fullPath, ".pdf");
      const handle = await this.getOrCreateFile(this.vault.rootHandle, pdfPath);
      const pdfBytes = await pdfDoc.save();
      const writable = await handle.createWritable();
      await writable.write(pdfBytes.slice(0));
      await writable.close();
    },
    parseColor(colorStr: string) {
      colorStr = colorStr.trim();

      // If color is in rgba(r,g,b,a) format
      if (colorStr.startsWith("rgba")) {
        // Match rgba numbers
        const match = colorStr.match(
          /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)/i,
        );
        if (match) {
          return {
            r: parseInt(match[1], 10),
            g: parseInt(match[2], 10),
            b: parseInt(match[3], 10),
            a: parseFloat(match[4]),
          };
        }
      }

      // If color is in hex format (#RGB or #RRGGBB)
      if (colorStr.startsWith("#")) {
        let r, g, b, a;
        if (colorStr.length === 4) {
          // #RGB shorthand
          r = parseInt(colorStr[1] + colorStr[1], 16);
          g = parseInt(colorStr[2] + colorStr[2], 16);
          b = parseInt(colorStr[3] + colorStr[3], 16);
          a = 255;
        } else if (colorStr.length === 7) {
          // #RRGGBB
          r = parseInt(colorStr.slice(1, 3), 16);
          g = parseInt(colorStr.slice(3, 5), 16);
          b = parseInt(colorStr.slice(5, 7), 16);
          a = 255;
        } else if (colorStr.length === 9) {
          // #RRGGBBAA
          r = parseInt(colorStr.slice(1, 3), 16);
          g = parseInt(colorStr.slice(3, 5), 16);
          b = parseInt(colorStr.slice(5, 7), 16);
          a = parseInt(colorStr.slice(7, 9), 16);
        } else {
          throw new Error("Invalid hex color length");
        }
        return { r, g, b, a: a / 255 };
      }

      throw new Error("Unsupported color format");
    },
    async drawGridPdf(pdfPage: PDFPage, doc: Document) {
      for (let y = 0; y < doc.size_mm.y; y += this.gridLineDistanceMm) {
        const { r, g, b, a } = this.parseColor(doc.gridColor);
        pdfPage.drawLine({
          start: { x: 0, y: pdfPage.getHeight() - y },
          end: { x: doc.size_mm.x, y: pdfPage.getHeight() - y },
          thickness: this.gridLineThicknessMm,
          color: rgb(r / 255, g / 255, b / 255),
          opacity: a,
        });
      }
    },
    async init() {
      // this.paperTexture = await this.loadImage(PaperTexture);
      // this.paperTexture = await this.loadImage(PaperTextureWhite);
      this.paperTexture = await this.loadImage(PaperTextureTiling);
    },
    loadImage(src: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = reject;
      });
    },
    pxToMm<T extends number | Vec2>(px: T): T {
      assert(this.currentlyOpenDocument);
      if (px instanceof Vec2) {
        return px.div(this.currentlyOpenDocument.zoom_px_per_mm) as T;
      } else if (typeof px === "number") {
        return (px / this.currentlyOpenDocument.zoom_px_per_mm) as T;
      }
      throw new Error();
    },
    mmToPx<T extends number | Vec2>(mm: T): T {
      assert(this.currentlyOpenDocument);
      if (mm instanceof Vec2) {
        return mm.mul(this.currentlyOpenDocument.zoom_px_per_mm) as T;
      } else if (typeof mm === "number") {
        return (mm * this.currentlyOpenDocument.zoom_px_per_mm) as T;
      }
      throw new Error();
    },
  },
});
