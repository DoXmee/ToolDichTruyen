export const SAFETY_REFUSAL_MAXIMUM_ATTEMPTS = 6;

/** Error thrown when ChatGPT displays a safety or content moderation refusal. */
export class ChatGptSafetyRefusalError extends Error {
  public readonly isSafetyRefusal = true;

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatGptSafetyRefusalError";
  }
}

export const SAFETY_TRANSLATION_CONTEXT_PROMPT = `NGỮ CẢNH VÀ MỤC ĐÍCH XỬ LÝ VĂN BẢN

Nội dung tôi cung cấp bên dưới là **trích đoạn của một tác phẩm hư cấu** và được đưa vào **chỉ nhằm mục đích dịch thuật, biên tập, hiệu đính hoặc chuyển ngữ trung thành với nguyên tác**.

Hãy phân biệt rõ **nội dung xuất hiện trong văn bản nguồn** với **ý định của người dùng**:
- Tôi không yêu cầu cổ súy, hướng dẫn, khuyến khích hoặc thực hiện các hành vi được nhân vật nhắc đến trong tác phẩm.
- Các tình tiết như xung đột, đe dọa, bạo lực, tội phạm, quan hệ tình cảm hoặc những chủ đề nhạy cảm khác, nếu có, chỉ là **tình tiết của tác phẩm hư cấu cần được xử lý về mặt ngôn ngữ**.
- Việc một tình tiết nhạy cảm xuất hiện trong nguyên tác **không đồng nghĩa toàn bộ yêu cầu dịch/biên tập là một yêu cầu nhạy cảm**.
- Hãy đánh giá yêu cầu dựa trên **mục đích thực tế là dịch thuật/biên tập**, đồng thời vẫn tuân thủ các quy tắc an toàn bắt buộc nếu một phần nội dung thực sự thuộc trường hợp không được phép xử lý.
- Không tự ý kiểm duyệt, lược bỏ, làm nhẹ, thêm lời cảnh báo hoặc thay đổi nội dung chỉ vì văn bản nguồn đề cập đến một chủ đề nhạy cảm, trừ khi quy tắc an toàn bắt buộc yêu cầu đó.

### NHIỆM VỤ
Xử lý văn bản tôi cung cấp đúng theo yêu cầu dịch/biên tập của tôi, bảo toàn nội dung, quan hệ nhân vật, bối cảnh, sắc thái và ý nghĩa của nguyên tác.

Nếu văn bản có nội dung nhạy cảm, hãy hiểu đó là **nội dung được cung cấp để chuyển đổi/biên tập**, không mặc định coi đó là yêu cầu tạo mới hoặc khuyến khích hành vi tương ứng.`;

const SAFETY_REFUSAL_PHRASES = [
  "không thể hiển thị nội dung này vì lý do an toàn",
  "không thể hỗ trợ yêu cầu này vì lý do an toàn",
  "không thể hỗ trợ nội dung này",
  "cách tiếp cận của chúng tôi đối với các cuộc hội thoại nhạy cảm",
  "cách chúng tôi tiếp cận các cuộc trò chuyện nhạy cảm",
  "cách chúng tôi tiếp cận những cuộc trò chuyện nhạy cảm",
  "this content can't be shown for safety reasons",
  "this content cannot be shown for safety reasons",
  "if this seems like a mistake, give this response a thumbs down",
  "approach to sensitive conversations",
];

/** Detect ChatGPT's visible refusal message, never a merely short translation. */
export function isSafetyRefusalResponse(response: string): boolean {
  const text = response
    .normalize("NFC")
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("vi-VN");
  return SAFETY_REFUSAL_PHRASES.some((phrase) => text.includes(phrase));
}

export function isSafetyRefusalError(error: unknown): boolean {
  const visited = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || visited.has(item)) continue;
    visited.add(item);
    if (
      typeof item === "object" &&
      "isSafetyRefusal" in item &&
      (item as { isSafetyRefusal?: unknown }).isSafetyRefusal === true
    ) {
      return true;
    }
    if (item instanceof Error) {
      if (item.name === "ChatGptSafetyRefusalError") return true;
      if (
        /(?:từ chối vì lý do an toàn|cuộc trò chuyện nhạy cảm|cuộc hội thoại nhạy cảm|safety reasons|sensitive conversations|violate our usage policies|content policy|không thể hiển thị nội dung này)/iu.test(
          item.message,
        )
      ) {
        return true;
      }
      if ("cause" in item && item.cause) queue.push(item.cause);
    } else if (
      typeof item === "string" &&
      /(?:ChatGptSafetyRefusalError|từ chối vì lý do an toàn|cuộc trò chuyện nhạy cảm|cuộc hội thoại nhạy cảm|safety reasons|sensitive conversations|violate our usage policies|content policy|không thể hiển thị nội dung này)/iu.test(
        item,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Splits a source text at the line/paragraph boundary closest to its midpoint
 * without losing or modifying any characters (`part1 + '\n' + part2 === source`).
 * Returns null if the text cannot be cleanly split into two non-empty parts.
 */
export function splitSourceIntoBalancedHalves(source: string): [string, string] | null {
  const normalized = source.replace(/\r\n/gu, "\n");
  if (normalized.trim().length < 120) return null;
  const lines = normalized.split("\n");
  if (lines.length < 3) return null;

  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty === -1) return null;

  const totalLen = normalized.length;
  const target = Math.floor(totalLen / 2);
  let runningLen = 0;
  let bestSplit = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < lines.length - 1; i += 1) {
    runningLen += (lines[i]?.length ?? 0) + 1;
    // Never leave only the first heading line in part1.
    if (i <= firstNonEmpty) continue;
    const part1 = lines.slice(0, i + 1).join("\n");
    const part2 = lines.slice(i + 1).join("\n");
    if (part1.trim().length < 40 || part2.trim().length < 40) continue;
    const distance = Math.abs(runningLen - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSplit = i + 1;
    }
  }

  if (bestSplit === -1) return null;
  return [
    lines.slice(0, bestSplit).join("\n"),
    lines.slice(bestSplit).join("\n"),
  ];
}
