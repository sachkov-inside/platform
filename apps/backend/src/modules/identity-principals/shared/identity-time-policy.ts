const millisecondsPerSecond = 1_000;
const secondsPerMinute = 60;
const minutesPerHour = 60;
const hoursPerDay = 24;

export const platformSessionLifetimeMs = days(7);
export const humanReauthenticationLifetimeMs = minutes(5);
export const maximumFutureReauthenticationSkewMs = seconds(30);

function seconds(value: number): number {
  return value * millisecondsPerSecond;
}

function minutes(value: number): number {
  return seconds(value * secondsPerMinute);
}

function days(value: number): number {
  return minutes(value * minutesPerHour * hoursPerDay);
}
