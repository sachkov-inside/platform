// @ts-check
// A function in a module const and a class read values declared after the code that runs them.
const describeStatus = () => statusLabel;
describeStatus();
new HealthReport().print();

const statusLabel = "ready";

class HealthReport {
  print() {
    process.stdout.write(`${reportPrefix}\n`);
  }
}

const reportPrefix = "health";
