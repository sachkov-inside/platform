import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { Enrollment } from "../model/enrollment";
import { EnrollmentList } from "./enrollment-list";
const course: Enrollment = { id: "62000000-0000-4000-8000-000000000001", accountId: "62000000-0000-4000-8000-000000000002", origin: "course", startsAt: "2026-09-14T10:00:00Z", endsAt: null, endPolicy: "fixed", revision: 1, state: "active", renewal: "not_applicable", nextChargeAt: null,
 tier: { id: "62000000-0000-4000-8000-000000000003", revision: 1, name: "Материалы + сообщество", benefits: ["materials", "community"], contentScope: { guideIds: ["62000000-0000-4000-8000-000000000004"], materialIds: [] } },
 content: [{ kind: "guide", id: "62000000-0000-4000-8000-000000000004", title: "Инженерная практика", slug: "engineering-practice", available: true }] };
const meta = { title: "Components/Billing/Enrollment list", component: EnrollmentList, args: { items: [course] }, parameters: { layout: "padded" } } satisfies Meta<typeof EnrollmentList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Course: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(canvas.getByText("Без даты окончания")).toBeInTheDocument(); await expect(canvas.getByText("Следующего списания нет")).toBeInTheDocument(); } };
export const IndependentSources: Story = { args: { items: [course, { ...course, id: "62000000-0000-4000-8000-000000000005", origin: "tribute", endPolicy: "confirmed_external", endsAt: "2026-10-14T10:00:00Z" }] }, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("Одинаковый состав · 2 основания")).toBeInTheDocument(); } };
export const Revoked: Story = { args: { items: [{ ...course, state: "revoked" }] } };
export const Expired: Story = { args: { items: [{ ...course, origin: "tribute", endPolicy: "temporary_membership", endsAt: "2026-08-14T10:00:00Z", state: "expired" }] } };
export const Empty: Story = { args: { items: [] } };
