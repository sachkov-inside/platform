import { factAnnouncement } from "@/shared/api/fact-announcement";

const enrollmentChanged = factAnnouncement("inside.enrollments.changed");

export const announceEnrollmentChange = enrollmentChanged.announce;
export const subscribeEnrollmentChange = enrollmentChanged.subscribe;
