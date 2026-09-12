// Вторая копия словаря прав: именно она разводила витрину и выдачу, поэтому проверка обязана её
// увидеть — и по объявлению имени, и по строке права, собранной руками.
export const globalAccessCapabilities = ["materials", "community"] as const;

export function isGuideCapability(capability: string): boolean {
  return capability.startsWith("guide:");
}

export const sampleGuideCapability = `guide:${"5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001"}`;
