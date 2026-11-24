import { hasText, truncateText } from "../../shared/text.js";
import type { TemplateContent } from "./communications-contract.js";
const labels = {
  text: "📝 Текст",
  photo: "🖼 Фото",
  video: "🎬 Видео",
  video_note: "🔵 Кружок",
  voice: "🎙 Голосовое",
  document: "📎 Документ",
  native: "Сообщение Telegram",
};
export function messageLabel(content: TemplateContent, length = 45) {
  return `${labels[content.type]}${hasText(content.text) ? ` · ${truncateText(content.text.replace(/\s+/g, " "), length)}` : " без подписи"}`;
}
