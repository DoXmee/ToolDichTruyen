import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";

export interface AtomicJsonStoreOptions {
  maxBytes?: number;
}

const OFF_THREAD_PARSE_THRESHOLD = 1024 * 1024;

function readAndParseOffThread(filePath: string, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const fs = require('node:fs');
      try {
        const raw = fs.readFileSync(workerData.filePath, 'utf8');
        if (Buffer.byteLength(raw, 'utf8') > workerData.maxBytes) {
          throw new RangeError('File dữ liệu vượt giới hạn.');
        }
        parentPort.postMessage({ ok: true, value: JSON.parse(raw) });
      } catch (error) {
        parentPort.postMessage({
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          code: error && typeof error === 'object' ? error.code : undefined,
        });
      }
    `, { eval: true, workerData: { filePath, maxBytes } });
    worker.once("message", (message: { ok: boolean; value?: unknown; message?: string; code?: string }) => {
      void worker.terminate();
      if (message.ok) {
        resolve(message.value);
        return;
      }
      const error = new Error(message.message || "Không thể đọc JSON.") as NodeJS.ErrnoException;
      if (message.code) error.code = message.code;
      reject(error);
    });
    worker.once("error", reject);
  });
}
/**
 * A tiny, dependency-free JSON store. Writes are serialized and committed by
 * renaming a fully flushed temporary file in the same directory.
 */
export class AtomicJsonStore<T> {
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly maxBytes: number;

  public constructor(
    public readonly filePath: string,
    options: AtomicJsonStoreOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  }

  public async read(fallback: T): Promise<T> {
    try {
      const metadata = await stat(this.filePath);
      if (metadata.size > this.maxBytes) {
        throw new RangeError(`File dữ liệu vượt giới hạn: ${this.filePath}`);
      }
      if (metadata.size >= OFF_THREAD_PARSE_THRESHOLD) {
        return await readAndParseOffThread(this.filePath, this.maxBytes) as T;
      }
      const raw = await readFile(this.filePath, "utf8");
      if (Buffer.byteLength(raw, "utf8") > this.maxBytes) {
        throw new RangeError(`File dữ liệu vượt giới hạn: ${this.filePath}`);
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return fallback;
      }
      throw new Error(`Không thể đọc dữ liệu ${path.basename(this.filePath)}.`, { cause: error });
    }
  }

  public write(value: T): Promise<void> {
    let json: string;
    try {
      json = JSON.stringify(value, null, 2);
    } catch (error) {
      return Promise.reject(new TypeError("Dữ liệu không thể chuyển thành JSON.", { cause: error }));
    }
    if (typeof json !== "string") {
      return Promise.reject(new TypeError("Dữ liệu JSON không hợp lệ."));
    }
    if (Buffer.byteLength(json, "utf8") > this.maxBytes) {
      return Promise.reject(new RangeError("Dữ liệu lưu vượt quá giới hạn cho phép."));
    }

    const operation = this.writeQueue.then(() => this.atomicWrite(json));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  public async remove(): Promise<void> {
    await this.writeQueue;
    await rm(this.filePath, { force: true });
  }

  public async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async atomicWrite(json: string): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(json, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
