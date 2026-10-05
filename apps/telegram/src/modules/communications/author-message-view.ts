import { hasText } from "../../shared/text.js";
import type { TemplateContent } from "./communications-contract.js";
const labels = {
  text: "📝 Текст",
  photo: "🖼 Фото",
  video: "🎬 Видео",
  video_note: "🔵 Кружок",
  voice: "🎙 Голосовое",
  document: "📎 Документ",
};
export function messageLabel(content: TemplateContent, length = 45) {
  return `${labels[content.type]}${hasText(content.text) ? ` · ${content.text.replace(/\s+/g, " ").slice(0, length)}` : " без подписи"}`;
}
