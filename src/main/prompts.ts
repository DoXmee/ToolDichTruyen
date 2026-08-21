import { access, readFile } from "node:fs/promises";
import path from "node:path";

export type SupportedPromptMode = "period" | "modern" | "ancient" | "cultivation" | "custom";

export interface PromptCatalog {
  period: string;
  modern: string;
  ancient: string;
  cultivation: string;
}
const FILE_CANDIDATES: Record<Exclude<SupportedPromptMode, "custom">, readonly string[]> = {
  period: ["nien-dai.txt", "niên đại.txt", "historical.txt"],
  modern: ["hien-dai.txt", "hiện đại.txt", "modern.txt"],
  ancient: ["co-trang.txt", "cổ trang.txt", "ancient.txt"],
  cultivation: ["tu-tien.txt", "tu tiên.txt", "cultivation.txt"],
};

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/u, "").trim();
}
export function normalizePromptMode(value: unknown): SupportedPromptMode {
  if (typeof value !== "string") {
    throw new TypeError("Chế độ prompt không hợp lệ.");
  }

  const normalized = value.trim().toLocaleLowerCase("vi-VN");
  if (["historical", "period", "era", "nien-dai", "niên đại"].includes(normalized)) {
    return "period";
  }
  if (["modern", "hien-dai", "hiện đại"].includes(normalized)) {
    return "modern";
  }
  if (["ancient", "co-trang", "cổ trang", "cổ đại"].includes(normalized)) {
    return "ancient";
  }
  if (["cultivation", "tu-tien", "tu tiên", "tiên hiệp", "tu chân"].includes(normalized)) {
    return "cultivation";
  }
  if (["custom", "other", "khac", "khác"].includes(normalized)) {
    return "custom";
  }
  throw new TypeError(`Không hỗ trợ chế độ prompt: ${value}`);
}

export class PromptLoader {
  private readonly roots: readonly string[];

  public constructor(roots: readonly string[]) {
    this.roots = [...new Set(roots.map((root) => path.resolve(root)))];
  }

  public async loadCatalog(): Promise<PromptCatalog> {
    const [period, modern, ancient, cultivation] = await Promise.all([
      this.loadBuiltIn("period"),
      this.loadBuiltIn("modern"),
      this.loadBuiltIn("ancient"),
      this.loadBuiltIn("cultivation"),
    ]);
    return { period, modern, ancient, cultivation };
  }

  public async resolve(modeValue: unknown, customPrompt?: unknown): Promise<string> {
    const mode = normalizePromptMode(modeValue);
    if (mode === "custom") {
      if (typeof customPrompt !== "string" || customPrompt.trim().length === 0) {
        throw new TypeError("Vui lòng nhập prompt tùy chỉnh.");
      }
      if (customPrompt.length > 100_000) {
        throw new RangeError("Prompt tùy chỉnh quá dài (tối đa 100.000 ký tự).");
      }
      return stripBom(customPrompt);
    }
    return this.loadBuiltIn(mode);
  }

  private async loadBuiltIn(mode: Exclude<SupportedPromptMode, "custom">): Promise<string> {
    const attempted: string[] = [];
    for (const root of this.roots) {
      for (const fileName of FILE_CANDIDATES[mode]) {
        const filePath = path.join(root, fileName);
        attempted.push(filePath);
        try {
          await access(filePath);
          const content = stripBom(await readFile(filePath, "utf8"));
          if (content.length === 0) {
            throw new Error(`File prompt trống: ${filePath}`);
          }
          return content;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "ENOTDIR") {
            throw error;
          }
        }
      }
    }

    throw new Error(
      `Không tìm thấy prompt ${({ period: "truyện niên đại", modern: "truyện hiện đại", ancient: "truyện cổ trang", cultivation: "truyện tu tiên" } as const)[mode]}. ` +
        `Đã kiểm tra: ${attempted.join(", ")}`,
    );
  }
}
