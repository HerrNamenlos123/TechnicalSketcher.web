import type { FSDirEntry, FSFileEntry, TskFileFormat, VaultFS } from "@/types";
import { defineStore } from "pinia";
import { type Point, DEFAULT_PAGE_COLOR, DEFAULT_PAGE_SIZE, DEFAULT_GRID_COLOR, DEFAULT_ZOOM_PX_PER_MM, type Document, type Page, getDocumentSizePx, DEFAULT_DOCUMENT_OFFSET } from "./Document";
import { Vec2 } from "./Vector";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import getStroke from "perfect-freehand";
import PaperTexture from "@/assets/paper-texture.jpg";
import PaperTextureWhite from "@/assets/paper-texture-white.avif";
import PaperTextureTiling from "@/assets/paper-texture-tiling.jpg";

export function assert<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (!value) throw new Error(message ?? "Assertion failed");
}

export const useStore = defineStore("main", {
  state: () => ({
    vault: undefined as VaultFS | undefined,
    openDocuments: [] as Document[],
    currentlyOpenDocument: undefined as Document | undefined,
    penSizeMm: 0.3,
    penColor: "#000000",
    perfectFreehandAccuracyScaling: 10,
    pageGap: 1.03,
    gridLineThicknessMm: 0.2,
    gridLineDistanceMm: 10,
    lagCompensation: false,
    forceRender: false,
    flushCanvas: false,
    currentPageCanvas: undefined as HTMLCanvasElement | undefined,
    paperTexture: undefined as HTMLImageElement | undefined,
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
            entries.push({
              type: "directory",
              dirname: name,
              handle: handle,
              fullPath: parentPath + name + "/",
              children: await processEntries(handle, parentPath + name + "/"),
            });
          }
        }
        return entries;
      };

      const fs: VaultFS = {
        filetree: await processEntries(rootHandle, ""),
        rootHandle: rootHandle,
      };
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
          pages: input.data.pages.map(
            (p, i): Page =>
            ({
              pageIndex: i,
              shapes: p.shapes.map((s) => ({
                points: s.points.map((point) => ({
                  x: point.x * this.perfectFreehandAccuracyScaling,
                  y: point.y * this.perfectFreehandAccuracyScaling,
                  pressure: point.pressure,
                })),
                penColor: s.penColor,
                penThickness: s.penThickness,
              })),
              previewShape: undefined,
            }),
          ),
          size_mm:
            new Vec2(input.data.pageWidthMm ?? DEFAULT_PAGE_SIZE.x, input.data.pageHeightMm ?? DEFAULT_PAGE_SIZE.y),
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
          this.currentlyOpenDocument = newDoc;
          this.forceRender = true;
          this.flushCanvas = true;
          return;
        }
      }

      // No match
      this.openDocuments.push(newDoc);
      this.currentlyOpenDocument = newDoc;
      this.forceRender = true;
      this.flushCanvas = true;
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
            shapes: p.shapes.map((s) => ({
              points: s.points.map((point) => ({
                x: point.x / this.perfectFreehandAccuracyScaling,
                y: point.y / this.perfectFreehandAccuracyScaling,
                pressure: point.pressure,
              })),
              penThickness: s.penThickness,
              penColor: s.penColor,
            })),
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

      const filehandle = await this.getOrCreateFile(
        this.vault.rootHandle,
        path,
      );

      const doc: Document = {
        gridColor: DEFAULT_GRID_COLOR,
        gridType: "lines",
        offset: new Vec2(300, 100),
        pageColor: DEFAULT_PAGE_COLOR,
        pages: [{
          pageIndex: 0, previewShape: undefined, shapes: [],
        }],
        zoom_px_per_mm: DEFAULT_ZOOM_PX_PER_MM,
        size_mm: DEFAULT_PAGE_SIZE,
        currentPageIndex: 0,
      };
      doc.fileHandle = {
        handle: filehandle,
        filename: path.split("/").pop()!,
        type: "file",
        fullPath: path,
      };

      this.saveDocument(doc);
      this.loadVault();
    },
    getPath(penSize: number, points: Point[], mode: "fast" | "accurate") {
      return getStroke(points, {
        size: penSize * this.perfectFreehandAccuracyScaling,
        smoothing: 1,
        streamline: mode === "fast" ? 0.6 : 0.6,
        thinning: 0.1,
      });
    },
    async exportDocumentAsPdf(doc: Document) {
      const freehandScaling = this.perfectFreehandAccuracyScaling;

      function getSvgPathFromStroke(points: number[][]): string {
        if (!points.length) return "";

        const d = [];
        d.push(
          `M${points[0][0] / freehandScaling} ${points[0][1] / freehandScaling}`,
        );

        for (let i = 1; i < points.length - 1; i++) {
          const [x0, y0] = points[i];
          const [x1, y1] = points[i + 1];
          const mx = (x0 + x1) / 2;
          const my = (y0 + y1) / 2;
          d.push(
            `Q${x0 / freehandScaling} ${y0 / freehandScaling} ${mx / freehandScaling} ${my / freehandScaling}`,
          );
        }

        d.push("Z");
        return d.join(" ");
      }

      const pdfDoc = await PDFDocument.create();
      for (const page of doc.pages) {
        const pdfPage = pdfDoc.addPage([doc.size_mm.x, doc.size_mm.y]);
        this.drawGridPdf(pdfPage, doc);
        pdfPage.moveTo(0, pdfPage.getHeight());

        for (const shape of page.shapes) {
          const stroke = this.getPath(
            shape.penThickness,
            shape.points,
            "accurate",
          );
          const d = getSvgPathFromStroke(stroke);
          const { r, g, b } = this.hexToRgb(shape.penColor);
          pdfPage.drawSvgPath(d, { color: rgb(r, g, b) });
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
      await writable.write(pdfBytes);
      await writable.close();
    },
    async drawGridCanvas(
      ctx: CanvasRenderingContext2D,
      doc: Document,
    ) {
      ctx.lineWidth = this.gridLineThicknessMm * doc.zoom_px_per_mm;
      ctx.lineCap = "butt";
      ctx.strokeStyle = doc.gridColor;
      for (let y = 0; y < doc.size_mm.y; y += this.gridLineDistanceMm) {
        ctx.beginPath();
        ctx.moveTo(0, y * doc.zoom_px_per_mm);
        ctx.lineTo(getDocumentSizePx(doc).x, y * doc.zoom_px_per_mm);
        ctx.stroke();
      }
    },
    hexToRgb(hex: string) {
      const bigint = parseInt(hex.replace("#", ""), 16);
      return {
        r: ((bigint >> 16) & 255) / 255,
        g: ((bigint >> 8) & 255) / 255,
        b: (bigint & 255) / 255,
      };
    },
    async drawGridPdf(pdfPage: PDFPage, doc: Document) {
      for (let y = 0; y < doc.size_mm.y; y += this.gridLineDistanceMm) {
        const { r, g, b } = this.hexToRgb(doc.gridColor);
        const color = rgb(r, g, b);
        pdfPage.drawLine({
          start: { x: 0, y: pdfPage.getHeight() - y },
          end: { x: doc.size_mm.x, y: pdfPage.getHeight() - y },
          thickness: this.gridLineThicknessMm,
          color: color,
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
        const img = new Image()
        img.src = src
        img.onload = () => resolve(img)
        img.onerror = reject
      })
    }
  },
});
