import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { BrowserWindow, Dialog } from "electron";

export interface ExportTextRequest {
  content: string;
  defaultName?: string;
}
function safeDefaultName(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "truyen-da-dich.txt";
  const withoutInvalid = candidate.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_").slice(0, 180);
  const nonEmpty = withoutInvalid || "truyen-da-dich.txt";
  return nonEmpty.toLocaleLowerCase().endsWith(".txt") ? nonEmpty : `${nonEmpty}.txt`;
}
async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content.normalize("NFC"), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function exportTextFile(
  dialog: Pick<Dialog, "showSaveDialog">,
  owner: BrowserWindow | undefined,
  request: ExportTextRequest,
): Promise<{ canceled: boolean; filePath?: string }> {
  if (typeof request?.content !== "string") throw new TypeError("Nội dung xuất file không hợp lệ.");
  if (Buffer.byteLength(request.content, "utf8") > 128 * 1024 * 1024) {
    throw new RangeError("Nội dung xuất file vượt quá 128 MB.");
  }

  const options = {
    title: "Lưu truyện đã dịch",
    defaultPath: safeDefaultName(request.defaultName),
    filters: [{ name: "Văn bản UTF-8", extensions: ["txt"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"] as Array<
      "createDirectory" | "showOverwriteConfirmation"
    >,
  };
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { canceled: true };

  const finalPath = result.filePath.toLocaleLowerCase().endsWith(".txt")
    ? result.filePath
    : `${result.filePath}.txt`;
  await atomicWriteText(finalPath, request.content);
  return { canceled: false, filePath: finalPath };
}

