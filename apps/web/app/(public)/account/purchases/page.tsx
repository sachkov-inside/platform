import { redirect } from "next/navigation";

export const instant = false;

export default function PreviousAccountSection() {
  redirect("/account#purchases");
}
